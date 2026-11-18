//! revm as a library a JavaScript host loads, for the footprint comparison (docs/footprint.md).
//!
//! It exports exactly the four calls of ../INTERFACE.md (runStateTests, verifiedCall, keccak,
//! ecrecoverBytes), with the semantics of ../evmlib.wac, so one JS driver can swap engines.
//!
//! Fairness notes (why the code is shaped the way it is):
//! - The state-test path is revm's own `revme statetest` runner (bins/revme/src/cmd/statetest/
//!   runner.rs + merkle_trie.rs, v43.0.3) with the CLI, threading, tracing and printing removed.
//!   Fixture parsing, pre-state, block env, tx env (tx types, blob gas, access lists, EIP-7702
//!   authorization lists) all come from revm's published `revm-statetest-types` crate, exactly as
//!   revme uses them, so nothing about Ethereum semantics is re-implemented here.
//! - The sender is the fixture's `transaction.sender`: statetest-types' `Test::tx_env` takes it as
//!   given and only derives it from `secretKey` when absent (never the case in these fixtures).
//! - State root and logs hash are computed exactly as revme does: alloy-trie's `HashBuilder` over
//!   keccak(address)-sorted `TrieAccount`s, `storage_root_unhashed` per account, and keccak of the
//!   RLP list of logs.
//! - Every crypto backend is revm's pure-Rust choice (`default-features = false`, see Cargo.toml):
//!   k256 (ecrecover), arkworks (bn254, bls12-381, KZG), aurora-engine-modexp, p256, sha2, ripemd.
use alloy_trie::{
    nodes::TrieNode,
    proof::{verify_proof, ProofVerificationError},
    root::storage_root_unhashed,
    HashBuilder, Nibbles, TrieAccount,
};
use revm::{
    bytecode::Bytecode,
    context::{block::BlockEnv, cfg::CfgEnv, tx::TxEnv},
    context_interface::{
        block::BlobExcessGasAndPrice,
        cfg::gas::calculate_initial_tx_gas,
        result::ExecutionResult,
    },
    database::{CacheDB, EmptyDB, PlainAccount, State},
    precompile::secp256k1::ec_recover_run,
    primitives::{hardfork::SpecId, keccak256, Address, Bytes, Log, TxKind, B256, U256},
    state::AccountInfo,
    statetest_types::{SpecName, TestSuite},
    Context, ExecuteCommitEvm, ExecuteEvm, MainBuilder, MainContext,
};
use serde_json::Value;
use wasm_bindgen::prelude::*;

// ───────────────────────────── runStateTests ─────────────────────────────

/// "Cancun" | "Prague" | "Osaka" → revm's `SpecName` (the key of a fixture's `post`).
fn spec_name(fork: &str) -> Option<SpecName> {
    match fork {
        "Cancun" => Some(SpecName::Cancun),
        "Prague" => Some(SpecName::Prague),
        "Osaka" => Some(SpecName::Osaka),
        _ => None,
    }
}

/// revme's `log_rlp_hash`: keccak256 of the RLP list of logs.
fn log_rlp_hash(logs: &[Log]) -> B256 {
    let mut out = Vec::with_capacity(alloy_rlp::list_length(logs));
    alloy_rlp::encode_list(logs, &mut out);
    keccak256(&out)
}

/// revme's `state_merkle_trie_root`, unchanged: a real MPT root over the whole post-state.
fn state_merkle_trie_root<'a>(accounts: impl IntoIterator<Item = (Address, &'a PlainAccount)>) -> B256 {
    let mut vec: Vec<_> = accounts
        .into_iter()
        .map(|(address, acc)| {
            let storage_root = storage_root_unhashed(
                acc.storage
                    .iter()
                    .filter(|(_k, &v)| !v.is_zero())
                    .map(|(k, v)| (B256::from(*k), *v)),
            );
            (
                keccak256(address),
                TrieAccount {
                    nonce: acc.info.nonce,
                    balance: acc.info.balance,
                    storage_root,
                    code_hash: acc.info.code_hash,
                },
            )
        })
        .collect();
    vec.sort_unstable_by_key(|(key, _)| *key);

    let mut hb = HashBuilder::default();
    let mut account_rlp_buf = Vec::new();
    for (hashed_key, account) in vec {
        account_rlp_buf.clear();
        alloy_rlp::Encodable::encode(&account, &mut account_rlp_buf);
        hb.add_leaf(Nibbles::unpack(hashed_key), &account_rlp_buf);
    }
    hb.root()
}

/// Runs every case of one state-test file for `fork`. Answers "<passed> <failed> <total gas used>",
/// where gas is revm's `tx_gas_used()` (after the EIP-3529 refund cap and the EIP-7623 floor, the
/// figure a receipt carries) summed over the cases; a refused transaction contributes 0.
#[wasm_bindgen(js_name = runStateTests)]
pub fn run_state_tests(json: &[u8], fork: &str) -> String {
    let Some(wanted) = spec_name(fork) else { return "0 1 0".into() };
    // serde_json straight into revm's typed fixture structs, as revme does (from_slice: no UTF-8 copy).
    let suite: TestSuite = match serde_json::from_slice(json) {
        Ok(s) => s,
        Err(_) => return "0 1 0".into(),
    };
    let (mut passed, mut failed, mut gas) = (0u32, 0u32, 0u64);

    for (_name, unit) in &suite.0 {
        let Some(tests) = unit.post.get(&wanted) else { continue };
        // Pre-state, chain id, spec, blob limits and block env exactly as revme's execute_test_suite.
        let cache_state = unit.state();
        let mut cfg = CfgEnv::default();
        cfg.chain_id = unit.env.current_chain_id.unwrap_or(U256::ONE).try_into().unwrap_or(1);
        cfg.set_spec_and_mainnet_gas_params(wanted.to_spec_id());
        if cfg.spec().is_enabled_in(SpecId::OSAKA) {
            cfg.set_max_blobs_per_tx(6);
        } else if cfg.spec().is_enabled_in(SpecId::PRAGUE) {
            cfg.set_max_blobs_per_tx(9);
        } else {
            cfg.set_max_blobs_per_tx(6);
        }
        let block = unit.block_env(&mut cfg);

        for test in tests {
            let expect_invalid = test.expect_exception.is_some();
            let tx = match test.tx_env(unit) {
                Ok(tx) => tx,
                // revme `continue`s here (a tx that cannot even be built is refused). INTERFACE.md
                // also requires the root to be unchanged, so check the untouched pre-state's root
                // against the fixture, as the wacuum runner does for every refused transaction.
                Err(_) => {
                    let ok = expect_invalid
                        && state_merkle_trie_root(cache_state.trie_account()) == test.hash
                        && log_rlp_hash(&[]) == test.logs;
                    if ok { passed += 1 } else { failed += 1 }
                    continue;
                }
            };

            // revme's execute_single_test: State over the cached prestate, transact_commit.
            let mut state = State::builder()
                .with_cached_prestate(cache_state.clone())
                .with_bundle_update()
                .build();
            let mut evm = Context::mainnet()
                .with_block(&block)
                .with_tx(&tx)
                .with_cfg(cfg.clone())
                .with_db(&mut state)
                .build_mainnet();
            let result = evm.transact_commit(&tx);
            let db = evm.ctx.journaled_state.database;

            if let Ok(r) = &result {
                gas += r.tx_gas_used();
            }
            // revme's check_evm_execution, plus (INTERFACE.md) root/logs checks for refused txs too.
            let logs: &[Log] = result.as_ref().map(|r| r.logs()).unwrap_or_default();
            let ok = expect_invalid == result.is_err()
                && log_rlp_hash(logs) == test.logs
                && state_merkle_trie_root(db.cache.trie_account()) == test.hash;
            if ok { passed += 1 } else { failed += 1 }
        }
    }
    format!("{passed} {failed} {gas}")
}

// ────────────────────────────── verifiedCall ──────────────────────────────

fn hex_bytes(v: &Value) -> Result<Vec<u8>, String> {
    let s = v.as_str().ok_or("expected a hex string")?;
    let s = s.strip_prefix("0x").unwrap_or(s);
    // Quantities like "0x1" may have odd length.
    let owned;
    let s = if s.len() % 2 == 1 { owned = format!("0{s}"); &owned } else { s };
    revm::primitives::hex::decode(s).map_err(|e| e.to_string())
}

fn quantity(v: &Value) -> Result<U256, String> {
    let b = hex_bytes(v)?;
    if b.len() > 32 { return Err("quantity over 256 bits".into()); }
    Ok(U256::from_be_slice(&b))
}

fn u64_of(v: &Value) -> Result<u64, String> {
    quantity(v)?.try_into().map_err(|_| "quantity over 64 bits".to_string())
}

fn address(v: &Value) -> Result<Address, String> {
    let b = hex_bytes(v)?;
    if b.len() != 20 { return Err("address is not 20 bytes".into()); }
    Ok(Address::from_slice(&b))
}

fn proof_nodes(v: &Value) -> Result<Vec<Bytes>, String> {
    v.as_array().ok_or("proof is not an array")?.iter().map(|n| hex_bytes(n).map(Bytes::from)).collect()
}

/// Proves the value at `key` (already hashed) under `root` with alloy-trie's `verify_proof` and
/// answers it (RLP), or None when the proof shows the key is absent. The value is taken from the
/// proof itself: the last node's leaf value is the candidate (one verification walk in the common
/// case); otherwise an exclusion is checked, and as a last resort the value the walk reports.
fn proved_value(root: B256, key: B256, proof: &[Bytes]) -> Result<Option<Vec<u8>>, String> {
    let nibbles = Nibbles::unpack(key);
    if let Some(last) = proof.last() {
        if let Ok(TrieNode::Leaf(leaf)) = <TrieNode as alloy_rlp::Decodable>::decode(&mut &last[..]) {
            if verify_proof(root, nibbles, Some(leaf.value.clone()), proof).is_ok() {
                return Ok(Some(leaf.value));
            }
        }
    }
    match verify_proof(root, nibbles, None, proof) {
        Ok(()) => Ok(None),
        Err(ProofVerificationError::ValueMismatch { path, got: Some(got), .. }) if path == nibbles => {
            let got = got.to_vec();
            verify_proof(root, nibbles, Some(got.clone()), proof).map_err(|e| e.to_string())?;
            Ok(Some(got))
        }
        Err(e) => Err(e.to_string()),
    }
}

fn spec_of(fork: &str) -> Option<SpecId> {
    match fork {
        "Cancun" => Some(SpecId::CANCUN),
        "Prague" => Some(SpecId::PRAGUE),
        "Osaka" => Some(SpecId::OSAKA),
        _ => None,
    }
}

fn verified_call_inner(src: &[u8]) -> Result<String, String> {
    let doc: Value = serde_json::from_slice(src).map_err(|_| "not JSON".to_string())?;
    let field = |v: &Value, k: &str| -> Result<Value, String> {
        v.get(k).cloned().ok_or_else(|| format!("missing {k}"))
    };
    let root = B256::from_slice(&hex_bytes(&field(&doc, "stateRoot")?)?);

    // An in-memory DB holding ONLY what the proofs establish: EmptyDB underneath, so any account or
    // slot that was not proved reads as empty, exactly as wacuum's World does.
    let mut db = CacheDB::new(EmptyDB::default());
    for a in field(&doc, "accounts")?.as_array().ok_or("accounts is not an array")? {
        let addr = address(&field(a, "address")?)?;
        let proved = proved_value(root, keccak256(addr), &proof_nodes(&field(a, "accountProof")?)?)
            .map_err(|e| format!("account {addr}: {e}"))?;
        // Absent accounts are left out of the DB (the JSON's code beside an absent account is
        // ignored: it is not proved by anything).
        let Some(rlp) = proved else { continue };
        let acct: TrieAccount = alloy_rlp::Decodable::decode(&mut &rlp[..])
            .map_err(|e| format!("account {addr}: {e}"))?;
        let code = hex_bytes(&field(a, "code")?)?;
        if keccak256(&code) != acct.code_hash {
            return Err(format!("code of {addr}"));
        }
        let bytecode = Bytecode::new_raw_checked(code.clone().into()).unwrap_or(Bytecode::new_legacy(code.into()));
        db.insert_account_info(
            addr,
            AccountInfo { balance: acct.balance, nonce: acct.nonce, code_hash: acct.code_hash, code: Some(bytecode), ..Default::default() },
        );
        for s in field(a, "storageProof")?.as_array().ok_or("storageProof is not an array")? {
            let kb = hex_bytes(&field(s, "key")?)?;
            if kb.len() > 32 { return Err("slot key over 32 bytes".into()); }
            let mut key32 = [0u8; 32];
            key32[32 - kb.len()..].copy_from_slice(&kb);
            let proved = proved_value(acct.storage_root, keccak256(key32), &proof_nodes(&field(s, "proof")?)?)
                .map_err(|e| format!("slot 0x{} of {addr}: {e}", revm::primitives::hex::encode(key32)))?;
            if let Some(rlp) = proved {
                let v: U256 = alloy_rlp::Decodable::decode(&mut &rlp[..]).map_err(|e| e.to_string())?;
                if !v.is_zero() {
                    db.insert_account_storage(addr, U256::from_be_bytes(key32), v).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    let b = field(&doc, "block")?;
    let fork = b.get("fork").and_then(Value::as_str).unwrap_or("Prague");
    let spec = spec_of(fork).ok_or("unknown fork")?;
    let chain_id = u64_of(&field(&b, "chainId")?)?;
    let block = BlockEnv {
        number: quantity(&field(&b, "number")?)?,
        beneficiary: address(&field(&b, "coinbase")?)?,
        timestamp: quantity(&field(&b, "timestamp")?)?,
        gas_limit: u64_of(&field(&b, "gasLimit")?)?,
        basefee: u64_of(&field(&b, "baseFee")?)?,
        difficulty: U256::ZERO,
        prevrandao: Some(B256::from(quantity(&field(&b, "prevRandao")?)?)),
        // wacuum's BlockEnv gets a blob base fee of 1, i.e. excess blob gas 0.
        blob_excess_gas_and_price: Some(BlobExcessGasAndPrice::new(0, 1)),
        ..BlockEnv::default()
    };

    // eth_call style: these switches exist (behind revm's optional_* features) precisely for
    // eth_call, and are what reth/Helios-style callers set. Gas price 0, value 0, no nonce or
    // balance or base-fee checks; no block-gas-limit / tx-gas-cap / EIP-3607 rejections.
    let mut cfg = CfgEnv::new_with_spec(spec);
    cfg.chain_id = chain_id;
    cfg.disable_nonce_check = true;
    cfg.disable_balance_check = true;
    cfg.disable_base_fee = true;
    cfg.disable_block_gas_limit = true;
    cfg.disable_eip3607 = true;
    cfg.tx_gas_limit_cap = Some(u64::MAX);

    let c = field(&doc, "call")?;
    let from = address(&field(&c, "from")?)?;
    let to = address(&field(&c, "to")?)?;
    let data: Bytes = hex_bytes(&field(&c, "data")?)?.into();
    let frame_gas = u64_of(&field(&c, "gas")?)?;
    // revm runs a whole transaction, which first deducts intrinsic gas (21000 + calldata). wacuum's
    // verifiedCall runs a bare message frame with exactly `gas`. To give revm's frame the same gas,
    // add the intrinsic on top, and report frame gas = total spent - intrinsic (before refunds,
    // as wacuum reports `gas - gasLeft` of the frame).
    let intrinsic = calculate_initial_tx_gas(spec, &data, false, 0, 0, 0, None).initial_total_gas();
    let tx = TxEnv {
        caller: from,
        kind: TxKind::Call(to),
        data,
        value: U256::ZERO,
        gas_price: 0,
        gas_limit: frame_gas.saturating_add(intrinsic),
        chain_id: Some(chain_id),
        ..TxEnv::default()
    };

    let mut evm = Context::mainnet().with_block(block).with_cfg(cfg).with_db(db).build_mainnet();
    let res = evm.transact(tx).map_err(|e| e.to_string())?;
    match res.result {
        ExecutionResult::Success { gas, output, .. } => Ok(format!(
            "ok 0x{} {}",
            revm::primitives::hex::encode(output.data()),
            gas.total_gas_spent() - intrinsic
        )),
        ExecutionResult::Revert { .. } | ExecutionResult::Halt { .. } => {
            Err("reverted".into())
        }
    }
}

/// eth_call against state that arrives as EIP-1186 proofs. "ok <0xoutput> <frame gas>" or "error <why>".
#[wasm_bindgen(js_name = verifiedCall)]
pub fn verified_call(json: &[u8]) -> String {
    match verified_call_inner(json) {
        Ok(s) => s,
        Err(e) => format!("error {e}"),
    }
}

// ──────────────────────────────── primitives ────────────────────────────────

/// keccak256 as revm itself hashes (alloy-primitives' `keccak256`, tiny-keccak on wasm32).
#[wasm_bindgen]
pub fn keccak(data: &[u8]) -> Vec<u8> {
    keccak256(data).to_vec()
}

/// revm's ecrecover precompile itself (k256 backend): 128 bytes in, a 32-byte padded address or empty.
#[wasm_bindgen(js_name = ecrecoverBytes)]
pub fn ecrecover_bytes(input: &[u8]) -> Vec<u8> {
    match ec_recover_run(input, u64::MAX) {
        Ok(out) => out.bytes.to_vec(),
        Err(_) => Vec::new(),
    }
}

