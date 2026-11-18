# The footprint of wacuum's execution side, against the standard alternatives

Measured 2026-11-18 on wac-eth branch `measure/footprint-exec` (based on 8fd86f4), wac pinned at `aaef775`. The
one-command harness is `wac task footprint` (`tools/footprint/`); every table here comes from its
`dist/results.md`.

**What this is evidence of, and what not.** wac is an experimental language with no users, and wacuum is one
project in it. These numbers do not argue for wac. They argue that an Ethereum execution engine can be much
smaller and quicker to start than the usual choices *without* giving up conformance, because one exists that is.
Where wacuum is slower, the tables say so. The largest loss is a verified eth_call against revm built for speed.

## The short version

All engines below pass the same 4,660 execution-spec-tests cases (v5.4.0, Cancun, Prague and Osaka state tests).
They agree on every root and every answer in the workloads.

| | wacuum (wac) | revm 43, opt-s | revm 43, opt-3 | @ethereumjs/vm 10.1 |
|---|---:|---:|---:|---:|
| download, brotli | **59 KiB** | 308 KiB | 417 KiB | 315 KiB (112 without the KZG setup) |
| Chromium: cold start to first verified eth_call | **16 ms** | 25 ms | 27 ms | 64 ms |
| Chromium: renderer peak over an empty page, throughput runs | **+16 MiB** | +19 MiB | +27 MiB | +109 MiB |
| arith loop, Mgas/s (Chromium) | **242** | 211 | 234 | 17 |
| keccak loop, Mgas/s (Chromium) | **93** | 33 | 67 | 6.4 |
| ecrecover loop, Mgas/s (Chromium) | **18.7** | 6.5 | 7.3 | 5.2 |
| verified eth_call, 3-hop Uniswap quote, warm (Chromium) | 2.44 ms | 1.74 ms | **1.05 ms** | 9.3 ms |
| verified eth_call, WETH balanceOf, warm (Chromium) | 0.47 ms | 0.32 ms | **0.20 ms** | 1.64 ms |

- **Size.** wacuum's whole EVM, every precompile through Osaka included, is about 5× smaller than revm compiled
  for size, and 5× smaller than @ethereumjs, or 2× smaller with the trusted setup removed (brotli).
  The same holds raw and gzipped.
- **Start.** wacuum gives its first answer sooner. Compiling 1–1.6 MB of wasm, or evaluating 850 KB of JavaScript,
  costs the others 9–48 ms more.
- **Memory.** wacuum's is the smallest, but its lead over revm is small. revm's linear memory peaks at 2.8 MiB;
  @ethereumjs is the outlier.
- **Interpreter and hashing.** The arithmetic loop is level with revm-3, to within the run-to-run spread.
  KECCAK256 and ecrecover are faster in wacuum. For ecrecover the reason is that revm in wasm uses k256 (see
  "Fairness" below).
- **Where wacuum loses.** On a verified eth_call, revm-3 is 2.3× faster and revm-s 1.4× faster. The time goes
  into wacuum's input handling, not its EVM: on the quote, JSON parsing takes 0.6 ms, hex decoding 0.5 ms and
  account proofs 0.12 ms ("Where wacuum loses", below).

## What was compared

Each engine is built behind one interface (`tools/footprint/INTERFACE.md`): `runStateTests(json, fork)`,
`verifiedCall(json)`, `keccak(bytes)` and `ecrecoverBytes(input)`. The same drivers call all of them.

| engine | what it is | build |
|---|---|---|
| **wac** | `tools/footprint/evmlib.wac`: wacuum's `processTransaction`, `World`, `stateRoot` and precompiles, plus `mpt.accountAt`/`storageAt` for proofs | `wac bindgen --js`. The module is taken out of the glue's base64 and shipped as a `.wasm` beside it |
| **wac-opt** | the same module | after `wasm-opt -O3` (binaryen 132, GC enabled) |
| **revm-s** | revm 43.0.3, adapted from revm's own `revme statetest` runner (`revm-statetest-types`), alloy-trie 0.9.9 for roots and proofs | Rust 1.97, `opt-level = "s"`, LTO, 1 codegen unit, `panic = "abort"`, wasm-bindgen 0.2.100, `wasm-opt -Oz` |
| **revm-3** | the same | `opt-level = 3`, `wasm-opt -O3` |
| **ejs** | @ethereumjs/vm, evm, statemanager, mpt, tx, block, common 10.1.3. Each case is set up the way the EthereumJS monorepo's own state-test runner does it | esbuild 0.28.2, minified ESM for the browser. KZG is micro-eth-signer 0.20.1 with `@paulmillr/trusted-setups` small-kzg, as the EthereumJS docs show |
| **ejs-nokzg** | the same bundle with the trusted setup stubbed out | sizes only: blob transactions cannot run in it |

**Crypto backends.** wacuum's are its own (`src/crypto/`). revm is built `default-features = false`, so every
precompile uses its pure-Rust fallback: k256, arkworks (bn254, BLS12-381, KZG), aurora modexp and p256. KZG
verification embeds only the τ·G2 point, as wacuum's does. @ethereumjs uses @noble/curves and @noble/hashes.

**Runtimes.**
- Chromium 157.0.8103.78, Playwright's headless build. Each measurement launches a fresh browser with a fresh
  profile, so there is no HTTP cache and no V8 code cache. Files are served from localhost.
- Outside a browser, wac runs on its own host: the `wac` command, V8, built by `./bootstrap.sh` at the pin.
  `evmlib.wac` is called directly by `tools/footprint/native.wac`, with no JavaScript in between. This is the
  primary wac row.
- The comparators run under Node 22.23.5, where they normally run. A labelled row shows wac's module under Node
  too, so that the host's effect can be told apart from the module's.

The machine is a 4-vCPU Intel Xeon at 2.1 GHz with 15 GB, in a Linux 6.18 cloud container. Every figure is the
median of three runs, each in a fresh process or browser.

**Browser requirements.** wac's module is WasmGC: Chrome 119+, Firefox 120+, Safari 18.2+. revm's module needs
only MVP wasm plus bulk memory, sign-extension, non-trapping float-to-int, multi-value and reference types,
which every current browser has. @ethereumjs needs ES2022 and BigInt.

## The tasks

1. **Conformance.** The fork directories of execution-spec-tests v5.4.0 (cancun/, prague/ and osaka/: 218
   files, 4,660 cases) run at their own fork. Every engine passes all of them: run by hand in Node, and in
   revm's case by its own test (`revm-wasm/test/check.mjs`).
   - The timed subset is `subset.txt`: every other file under 256 KiB, 85 files and 297 cases, small enough to
     fetch into a page.
   - The sender is the fixture's `transaction.sender`, given rather than recovered, in every engine. @ethereumjs
     runs an unsigned transaction whose `getSenderAddress` answers it. So no signature is in any figure, except
     the EIP-7702 authorizations an EVM must recover.
2. **Throughput** (`fixtures/bench/`, from `gen-bench.mjs`). Four state tests of about 25M gas each:
   - an arithmetic loop;
   - KECCAK256 of a word;
   - SSTORE to fresh slots (1,100 of them, so the root at the end hashes them);
   - STATICCALL to the ecrecover precompile with a valid signature.

   Mgas/s is the gas used divided by the time of the whole `runStateTests` call: parsing, pre-state, execution
   and the state root.
3. **Verified eth_call** (`fixtures/call/`, from `gen-call.mjs`). This is what Helios does:
   - the state arrives as EIP-1186 proofs;
   - every account proof is checked against the state root, the code against its proved hash, and every slot
     against the proved storage root;
   - then the call runs on exactly what was proved.

   There are two calls:
   - `quote`: UniswapV2Router02 `getAmountsOut(1e18, [A, WETH, B, C])`. It touches three pairs, 5 accounts,
     3 slots and 42 proof nodes, has 144 KB of fixture, and uses 23,432 gas.
   - `balance`: WETH9 `balanceOf`. It touches 2 accounts, 1 slot and 19 proof nodes, and uses 2,457 gas.

   Each figure is the median of 50 warm calls, each from the fixture's bytes, so parsing is included. All five
   builds return the same output and the same gas.
4. **Primitives.** keccak256 of 32 bytes and of 1 KiB, and ecrecover (the precompile's 128-byte input to a padded
   address), as operations a second.
   - wacuum's primitives are built alone (`prims.wac`: keccak only, and keccak plus ecrecover), so their sizes
     are what a page needing only them would ship.
   - The comparators are @noble/hashes 2.4.0 and @noble/curves 2.4.0, and ethereum-cryptography 3.2.0 (which
     wraps noble), each bundled the same way.

**The eth_call state is synthetic, and the report says so wherever it matters.** This container cannot reach an
Ethereum RPC; the agent proxy refuses the public endpoints. So the state is built rather than fetched:
- real mainnet bytecode from the published npm artifacts (WETH9, UniswapV2Factory, Router02 and Pair; the pair's
  init code hash is mainnet's 0x96e8ac42…);
- three ERC-20 tokens;
- 1,000,000 other accounts and 100,000 other WETH balances, so that proofs are deep. Account proofs are 6–7 nodes
  here and about 8–9 on mainnet; WETH storage proofs are 5–6 here and 6–8 on mainnet. Proof work is a little
  understated.

The proofs come from @ethereumjs's `getMerkleStateProof`. wacuum and revm verify them with their own tries
(wacuum's `mpt` package, and alloy-trie), so the fixture is checked independently twice.

## Results: EVM outside a browser

The native host runs wac. Everything else runs under Node 22. With nothing loaded, the wac host's process peaks at
33.4 MiB and Node's at 43.3 MiB, with 38 ms and 35 ms of process wall time.

| engine | cold → first result | process wall, exec to exit | peak RSS: cold | conformance | bench | calls | 85-file subset |
|---|---:|---:|---:|---:|---:|---:|---:|
| **wac, native `wac` host** | **5.2 ms** | 52 ms | **44.5 MiB** | **69.6** | **66.1** | **56.2** | **201 ms** |
| wac's module under Node | 13.8 ms | 50 ms | 49.6 | 74.3 | 67.2 | 69.0 | 251 ms |
| wac-opt under Node | 15.9 ms | 54 ms | 51.4 | 88.8 | 81.5 | 81.2 | 215 ms |
| revm-s, Node | 14.8 ms | 60 ms | 50.4 | 80.1 | 69.8 | 62.8 | 340 ms |
| revm-3, Node | 15.3 ms | **47 ms** | 49.8 | 106.1 | 90.6 | 67.9 | 271 ms |
| ejs, Node | 64.8 ms | 97 ms | 61.8 | 146.8 | 180.7 | 104.5 | 7,657 ms |

| engine | arith Mgas/s | keccak Mgas/s | sstore Mgas/s | ecrecover Mgas/s | balance call | quote call |
|---|---:|---:|---:|---:|---:|---:|
| **wac, native `wac` host** | 271 | **101** | 3,985 | **18.4** | 0.415 ms | 2.19 ms |
| wac's module under Node | 214 | 97 | 3,692 | 17.4 | 0.441 ms | 2.27 ms |
| wac-opt under Node | 160 | 89 | 3,736 | 18.4 | 0.423 ms | 2.22 ms |
| revm-s, Node | 212 | 21 | 1,996 | 6.3 | 0.414 ms | 2.48 ms |
| revm-3, Node | **295** | 72 | **5,409** | 7.2 | **0.169 ms** | **0.95 ms** |
| ejs, Node | 14 | 5.4 | 42 | 2.2 | 2.36 ms | 13.5 ms |

- **The native host versus Node.** For the same module, the native host's process peaks 1–13 MiB lower than
  Node's (13 on the calls, 1 on the throughput runs), its arithmetic is 27% faster, and its calls are a little
  quicker.
- **Starting the process** takes about the same on both. The native process's wall time is 52 ms against 50 ms
  for the same module under Node. The `wac` binary carries a compiler and is 68 MB, and an empty wac program is
  not faster to start than an empty Node script (38 ms against 35 ms).
- **Inside the process,** the first answer comes in 5 ms on the native host and 14 ms under Node. Most of that
  difference is Node's ES-module and glue loading.
- **revm-3 under Node** is the fastest at arithmetic (295 Mgas/s, against wac's 271 on its own host) and at
  sstore, where the state root's hashing of 1,100 slots dominates. It is fastest by a wide margin on the verified
  calls.

## Results: EVM in Chromium

An empty page's renderer peaks at 90.9 MiB.

| engine | cold → first result | renderer peak: cold | conformance | bench | calls | 85-file subset |
|---|---:|---:|---:|---:|---:|---:|
| **wac** | **16.1 ms** | **96.8 MiB** | 128.7 | **107.0** | 114.0 | **218 ms** |
| wac-opt | 19.2 ms | 96.9 | 137.6 | 116.8 | 119.9 | 234 ms |
| revm-s | 25.4 ms | 98.6 | **124.3** | 110.1 | **103.5** | 350 ms |
| revm-3 | 27.0 ms | 98.9 | 138.7 | 118.2 | 110.5 | 342 ms |
| ejs | 63.6 ms | 110.0 | 223.1 | 199.8 | 151.0 | 4,475 ms |

| engine | arith Mgas/s | keccak Mgas/s | sstore Mgas/s | ecrecover Mgas/s | balance call | quote call |
|---|---:|---:|---:|---:|---:|---:|
| **wac** | **242** | 93 | 4,708 | **18.7** | 0.470 ms | 2.44 ms |
| wac-opt | 197 | **97** | 4,014 | **18.7** | 0.390 ms | 2.23 ms |
| revm-s | 211 | 33 | 2,509 | 6.5 | 0.320 ms | 1.74 ms |
| revm-3 | 234 | 67 | **4,806** | 7.3 | **0.200 ms** | **1.05 ms** |
| ejs | 17 | 6.4 | 69 | 5.2 | 1.64 ms | 9.3 ms |

The run-to-run spread is within about ±6% on everything except sstore, which varies ±25% in every engine because its
root is GC- and allocation-heavy. revm-3's sstore ranged from 3,025 to 5,092. So wac and revm-3 are level on
arith and on sstore in Chromium.

Memory in the page:
- After the throughput runs, CDP's JS heap holds 1.2 MiB for wac, whose objects are WasmGC objects in that heap.
  It holds 1.2 MiB for revm, plus 2.8 MiB of linear memory that never shrinks, and 5.7 MiB for ejs.
- Renderer RSS peaks are dominated by V8's own heap reservations, so differences of a few MiB between wac and revm
  are within noise. The difference against ejs, about 90 MiB, is not.

## Results: hashing and signatures

| engine | download, brotli | Chromium keccak 32 B /s | 1 KiB /s | ecrecover /s | Node keccak 32 B /s | 1 KiB /s | ecrecover /s |
|---|---:|---:|---:|---:|---:|---:|---:|
| **wac, keccak only** | 2 KiB | **628k** | **161k** | – | **635k** | **180k** | – |
| **wac, keccak + ecrecover** | 9 KiB | 633k | 163k | **6,061** | 613k | 182k | **5,560** |
| @noble/hashes (keccak) | 2 KiB | 192k | 28k | – | 155k | 23k | – |
| @noble/curves + hashes | 15 KiB | 185k | 27k | 2,391 | 143k | 20k | 833 |
| ethereum-cryptography (keccak) | 2 KiB | 132k | 18k | – | 118k | 16k | – |
| ethereum-cryptography (secp + keccak) | 12 KiB | 139k | 19k | 2,058 | 109k | 14k | 736 |
| revm-3's precompiles, for reference | 417 KiB | 885k | 128k | 2,272 | 909k | 137k | 2,322 |

On wac's native host, with no JavaScript boundary, keccak runs at 1.59M/s for 32 B and 229k/s for 1 KiB, and
ecrecover at 5,869/s.

- Every figure includes the cost of crossing from JavaScript into the module. wac's glue copies bytes element by
  element into a GC array, which is why its 32-byte keccak is 2.5× slower from JavaScript than on its own host.
  revm's `Uint8Array` crossing is a `memcpy`, so revm wins on small inputs and loses on large ones.
- Cold start to the first hash is 3–9 ms for every one of these, in both runtimes. That is not a differentiator.
- noble's ecrecover is 2.9× faster in Chromium 157 than in Node 22. The same code under an older V8 is the most
  likely reason, though it was not investigated. The Chromium column is the fairer comparison.

## Where wacuum loses, and why

- **Verified eth_call.** On the quote, revm-3 is 2.3× faster and revm-s 1.4× faster. Timing the pieces inside wac
  on its own host shows where the time goes (`zz-prof`, not kept). Of the 2.33 ms:
  - JSON parsing (`json.parse` over 144 KB) takes 0.59 ms;
  - hex decoding of the code and proofs takes 0.52 ms;
  - verifying the five account proofs takes 0.12 ms;
  - the remaining ~1.1 ms is hashing ~60 KB of code against its proved hash, building the `World` (jump-table
    analysis of the code), and the 23k gas of execution.

  revm does the same work with serde_json and `hex`. So the gap is wac's JSON and byte handling, and a
  code-hash pass, not its interpreter, which the throughput rows show to be on par. This is fixable in wacuum,
  but it has not been fixed for this report.
- **Arithmetic under Node.** revm-3 runs at 295 Mgas/s against 214 for wac's module under Node and 271 on wac's
  own host. In Chromium the two are level.
- **sstore and roots outside the browser.** revm-3 manages 5,409 Mgas/s against 3,985 on wac's host. Its
  trie-root path is faster.
- **wasm-opt makes wac's module smaller but not reliably faster.** -O3 cost 25% on Node's arithmetic loop. The
  plain `wac` output is the primary row for that reason.
- **Process start on the native host** is not faster than Node's. The host binary is large.

## Fairness notes

- **ecrecover in revm.** The revm build uses k256, because the C library is not part of a default wasm build.
  Natively, revm links libsecp256k1 and is much faster. "wac beats revm at ecrecover" is true of revm in a browser,
  not of revm.
- **@ethereumjs's conformance time is mostly setup.** A fresh `MerkleStateManager` and VM per case is what its own
  runner does, so the 85-file figure measures the library as used. It does not measure its interpreter alone,
  which the throughput rows do.
- **@ethereumjs's size includes 410 KB of KZG trusted setup.** That is the setup its docs pair it with; the
  `ejs-nokzg` row shows the size without it. wacuum and revm embed only the one point they verify with.
- **Every engine computes a state root** with a real Merkle Patricia trie in every state test: wacuum's own,
  alloy-trie's `HashBuilder`, and @ethereumjs/mpt. None skips it.
- **The verified-call semantics differ slightly.** revm runs the call as a transaction with intrinsic gas
  subtracted, with the coinbase and precompiles warm; wacuum warms only `from` and `to`. Neither call here touches
  the coinbase or a precompile, which is why all five builds report the same gas.

## Part 3: an execution-client memory comparison, not done

The ask was to compare memory on the same task, for example replaying the same N mainnet blocks against fetched
prestate, against reth's or geth's library-level replay tools, and only if that comparison can be fair. It could
not be made fair here:

- **No mainnet data.** There is no Ethereum RPC from this container. wacuum's own replay data was fetched with
  an Alchemy key that stays in another session. Without the same blocks and prestate, there is no same task.
- **geth's replay tool could not be built.** This session's permission policy denied
  `go install github.com/ethereum/go-ethereum/cmd/evm`. A weaker proxy was considered: geth `evm blocktest`
  against wacuum's `tools/blocktest.wac` on the same execution-spec-tests blockchain fixtures, both in memory.
  Even if built, it would compare per-test setup on tiny chains, where the process baseline dominates. Mainnet
  replay memory is dominated by state caches, which those fixtures never fill.

A fair version needs:
1. one fetched range, for example wacuum's own 32-block capture (26,432,348–379) with its prestate;
2. geth's `evm t8n` or reth's `reth-stateless`/`ExEx`-style replay fed the same prestate as a witness;
3. maxrss and wall time per block for all three.

That is a day's work given an RPC endpoint, and a request for one is the next step.

## Reproducing

From `packages/wacuum`, with `wac` built from the pin (`./bootstrap.sh` in wac at the commit `wac.lock` names):

    wac task fixtures      # execution-spec-tests v5.4.0, once
    wac task footprint     # npm ci, build all engines, run everything 3×, write tools/footprint/dist/results.md

`node tools/footprint/run.mjs` takes flags to narrow a run: `--skip-build`, `--node-only` (the native host and
Node), `--browser-only`, `--engines a,b`, `--tasks a,b`, `--repeat n` and `--merge`.

Building revm needs Rust with `wasm32-unknown-unknown` and `wasm-bindgen-cli` 0.2.100
(`cargo install wasm-bindgen-cli --version 0.2.100 --locked`).

The fixtures are deterministic and committed. Regenerate them with `node gen-bench.mjs` (seconds) and
`node gen-call.mjs` (about 9 minutes, most of it the padding).

The wac at master (`a1814151a`) produced a byte-identical `evmlib.wasm` to the pinned one, so the figures do not
depend on which of the two built them.
