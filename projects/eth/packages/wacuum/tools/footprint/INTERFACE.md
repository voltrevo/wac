# The interface every engine in the footprint comparison exports

Each engine (wacuum's EVM via `wac bindgen`, @ethereumjs/vm, revm via wasm-bindgen) is one module exporting the same
four functions, so a driver can swap them and measure the same work.

    runStateTests(json: Uint8Array, fork: string): string
        Every case of one execution-spec-tests state-test file (the JSON text, UTF-8) for `fork` ("Cancun",
        "Prague" or "Osaka"): build the pre-state, run the transaction built from the case's `indexes`, compute the
        state root and the logs hash (keccak256 of the RLP list of logs), and compare both to the fixture's `hash`
        and `logs`. A case with `expectException` passes when the transaction is refused and the root is still the
        fixture's. Tests whose `post` has no entry for `fork` are skipped.
        The sender is the fixture's `transaction.sender`, taken as given: no engine signs or recovers it, so no
        engine's numbers include a signature. (EIP-7702 authorizations are still recovered, as the EVM must.)
        Answers "<passed> <failed> <total gas used>".

    verifiedCall(json: Uint8Array): string
        eth_call against state that arrives as EIP-1186 proofs, as Helios runs one. The fixture is
          { "stateRoot": "0x…",
            "block": { "fork", "coinbase", "number", "timestamp", "gasLimit", "prevRandao", "baseFee", "chainId" },
            "call": { "from", "to", "data", "gas" },
            "accounts": [ { "address", "balance", "nonce", "codeHash", "storageHash", "accountProof": ["0x…"],
                            "code": "0x…", "storageProof": [ { "key", "value", "proof": ["0x…"] } ] } ] }
        Verify every account proof against `stateRoot` (the account fields come from the proof, not the
        JSON beside it), keccak256(code) against the proved codeHash, and every storage proof against the proved
        storage root; then run the call (value 0, gas price 0, no nonce or balance checks, a CALL from `from` to
        `to`) on exactly the proved state. Answers "ok <output hex> <gas used>" or "error <why>".

    keccak(data: Uint8Array): Uint8Array            keccak256, 32 bytes
    ecrecoverBytes(input: Uint8Array): Uint8Array   the ecrecover precompile on 128 bytes (hash, v, r, s):
                                                    the 32-byte left-padded address, or empty
