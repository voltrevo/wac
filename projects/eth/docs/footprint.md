# Footprint: small WasmGC verifiers against the standard ones

**What this is for.** Evidence about what verifiers built as small WebAssembly-GC modules can cost, against the
libraries people use today, for the Reads 2027 proposal. wac is experimental: read this as "this footprint is
possible", not as a recommendation of wac. Where wac loses, it says so, and where the comparison is not like for like,
it says how.

**How to reproduce.** One command, from a wac-eth checkout on branch `measure/footprint`:

    WAC_SRC=/path/to/wac WAC_NATIVE=/path/to/wac/native/v8/target/release/wac sh tools/footprint/run.sh OUT [RUNS]

It builds every side of every comparison, serves the recorded data from one local server, measures each in Node (and
wac on its native host) and in Playwright's Chromium, and writes `OUT/results/*.jsonl` and `OUT/report.md`, the
tables below. The numbers here are from two runs of it, 5 fresh runs per cold measurement, medians:
`docs/footprint/before.md` (the light client as it was, commit `33298f9`) and `docs/footprint/after.md` (everything
else, and the light client after the fix in §1).

| | |
| --- | --- |
| machine | 4 vCPU Intel Xeon @ 2.10 GHz, Linux 6.18, in a cloud container (noisy neighbours possible: read single-digit-ms differences as noise) |
| browser | Chromium 153.0.8010.12 (V8 15.3), headless, through Playwright 1.63.0 |
| Node | 22.23.4 (V8 12.4): every JavaScript comparator runs here |
| wac outside a browser | **primary: wac's native host on V8** (`native/v8` in wac: rusty_v8 152, V8 15.2; a 66 MB binary with V8 in it). Second, labelled "wac wasm, Node host": the same kind of module under wac's Node host, to show the host's effect apart from the module's |
| wac | `aaef775ca` (the pin in `wac.lock`); browser builds are wac's `--target browser --layout files` |
| JS libraries | exact versions in `tools/footprint/js/package.json` and its lock, named with each comparison |
| bundling | esbuild 0.25.12: `--bundle --minify --format=esm --platform=browser --target=es2022`; any alias or shim is named where used |
| compression | each file alone, gzip level 9 and brotli quality 11 (Node's zlib), summed |
| memory | Node and the native host: peak RSS (VmHWM). Chromium: peak RSS of the renderer processes (page, workers, JS heap, wasm memory, compiled code) sampled every 20 ms, less a blank page's (75 MB). `performance.measureUserAgentSpecificMemory` is not exposed in this headless build |

**Browser requirements.** wac's modules need WebAssembly GC (with typed function references and exception
handling): Chrome/Edge 119+, Firefox 120+, Safari 18.2+. wac's browser host also uses `SharedArrayBuffer` and
`Atomics.wait` in a worker for synchronous waits, so the page must be cross-origin isolated (COOP/COEP headers).
Every comparator here needs only WebAssembly MVP or plain JavaScript.

## Read this first: what a wac module carries

| what | raw | gzip -9 | brotli -q 11 |
| --- | ---: | ---: | ---: |
| wac floor: hello world (runtime, printing) | 24 KB | 7.9 KB | 6.4 KB |
| wac floor: fetch only (runtime + **wac's own HTTP/TLS client**) | 207 KB | 73 KB | 59 KB |
| wac's browser host JS (`launcher.js` + `worker.js`), as emitted | 206 KB | 58 KB | 50 KB |
| the same, minified by esbuild | 102 KB | 34 KB | 30 KB |

Every wac bench here fetches its input itself, and wac brings its own HTTP client and TLS stack to do it, about
53 KB brotli above the bare runtime, where a JavaScript library uses the browser's `fetch` for nothing. On a page,
wac's host JS is another 30–50 KB. **So the verifier code itself is small, but today's packaging is not**: for the
small tasks (§2–§4) the JavaScript bundles are smaller over the wire than wac's. A wac verifier that took its bytes
from the page instead of fetching would shed the 53 KB. Nothing here measures that build, because wac has no such
target yet.

## 1. Light client

**The task.** From mainnet checkpoint `0xa835…e937` (slot 15621760, Fulu), recorded on 2026-11-10
(`packages/lightclient/test/mainnet`): fetch the bootstrap, the period's sync-committee update, and the finality and
optimistic updates from a beacon node's REST API (a local replay server, `tools/footprint/serve.mjs`). Verify them,
and print the execution state root the optimistic header proves. Every client prints the same roots:
`0x64d8…9870` (optimistic) and `0x25de…e04e` (finalized).

| client | version | what it verifies here | BLS |
| --- | --- | --- | --- |
| wac (`tools/footprint/wac/lcbench.wac` over `packages/lightclient`) | this branch, wac `aaef775ca` | bootstrap (header root, committee branch), 3 sync aggregates (update, finality, optimistic), finality and committee branches, execution branch | wac's own BLS12-381 (wac's `packages/bls`), in the same module |
| Lodestar (`@lodestar/light-client`, `js/lc-lodestar.mjs`) | 1.43.0 (`@lodestar/config`/`types` 1.51.0, `@chainsafe/bls` 8.2.0) | the same, through its own `validateLightClientBootstrap` and `LightclientSpec` | herumi's wasm (`bls-eth-wasm` 1.7.0), **in Node too**: see below |
| Helios (`@a16z/helios`, its wasm build, `js/lc-helios.mjs`) | 0.12.0 | bootstrap, update and finality (2 sync aggregates: it does not take the optimistic update before calling itself synced), **plus** fetching and re-hashing the finalized and latest execution blocks with all their transactions | its own (Rust, in its wasm) |

What differs, said plainly:

- **Transport.** wac and Lodestar fetch all four answers first, and the fetch is timed apart (a few ms locally).
  Helios fetches as it goes, so its "verify" includes its fetching. It also insists on fetching two full execution
  blocks (300 transactions) from an execution RPC, which the replay server answers from `data/blocks` (mainnet's
  own, fetched once). So its task is larger in that respect and smaller by one sync aggregate.
- **Lodestar's BLS in Node is herumi's wasm, not native blst.** `@chainsafe/bls` 8.2.0 takes native blst only from
  `@chainsafe/blst` 1.x, a peer dependency. The light client depends on 2.x, and 1.x's install script fails today. So
  Lodestar runs the same wasm BLS in Node as in the browser. Native blst appears in the BLS table.
- **Lodestar's browser bundle** is this task bundled by esbuild (`js/build-lodestar.sh`):
  - `@chainsafe/bls` is aliased to its herumi entry (its package `exports` would otherwise try native blst first);
  - Node built-ins that unused code imports are aliased to an empty module;
  - `Buffer` is injected from the `buffer` package, as Lodestar's own browser bundle polyfills it.

  Lodestar's published `dist/lightclient.min.mjs` (the whole client, with its transport) is sized too.
- **Helios's bundle** is its own `dist/lib.mjs` (its wasm inlined as base64) with a few lines of ours. Nothing in it
  was changed. Its clock is pinned to the recording's time (`Date` only), since it refuses data older than the wall
  clock allows.
- **Colibri was not run.** `@corpus-core/colibri-stateless` verifies proofs that its prover builds for each RPC
  answer, starting from a cached sync committee or a ZK proof of one. It does not process the beacon API's
  light-client updates, so there is no offline equivalent of this task. Its wasm's size is listed.

### Sizes

| what | raw | gzip -9 | brotli -q 11 |
| --- | ---: | ---: | ---: |
| wac, browser: `lcbench` wasm + wac's host JS as emitted | 481 KB | 154 KB | 126 KB |
| wac, browser: the same with the host JS minified | 376 KB | 130 KB | 106 KB |
| wac, `lcbench.wasm` alone (light client, BLS, SSZ, wac's HTTP/TLS fetch) | 274 KB | 96 KB | 76 KB |
| wac, `lc.wasm` (light client, BLS, SSZ, ENS and proof path; reads files, no HTTP) | 177 KB | 61 KB | 50 KB |
| Lodestar: this task, esbuild bundle (herumi BLS wasm inlined) | 1057 KB | 305 KB | 235 KB |
| Lodestar's published browser bundle (`dist/lightclient.min.mjs`) | 1219 KB | 347 KB | 258 KB |
| Helios: its `dist/lib.mjs` bundled (wasm inlined as base64) | 4350 KB | 1665 KB | 1205 KB |
| Helios's wasm alone (`pkg/index_bg.wasm`) | 3236 KB | 1184 KB | 845 KB |
| Colibri's wasm alone (`@corpus-core/colibri-stateless` 3.1.1, `c4w.wasm`) | 1367 KB | 482 KB | 383 KB |

### Before the fix, and after it

The first measurements showed wac verifying the sequence 3× slower than Lodestar, and paying about 200 ms for each
further update where Lodestar paid a few. The BLS table below says why, and most of it was not WasmGC:

- **The algorithm.** wac's light client decompressed and subgroup-checked all 512 committee keys for every update,
  about 245 ms. Lodestar does that once per committee, keeps the points, and aggregates the participants by
  subtracting the few who did not sign.
- **The fix** (`packages/lightclient/src/keys.wac`, on this branch) does the same. The store keeps each committee's
  keys, decompressed and checked once, with their sum. A signature is checked against the sum less the members who
  did not sign: a few point additions, one key compressed and checked, and one pairing check. It refuses exactly where
  `FastAggregateVerify` over the participants would. All 19 light-client tests pass: Ethereum's vectors (Altair
  through Fulu, the fork transitions) and the planted negatives, including an update signed by another committee and
  one nobody signed.

*First result*: from starting the process, or from navigation start, to the result printed. That covers runtime
start, loading and compiling the code, init, fetch and verification. *Verify*: the whole sequence (bootstrap, three
sync aggregates). *One update*: the full sequence less the same without the optimistic update, i.e. the marginal
cost of one more signed update; it is a difference of two medians, so small values are within noise.

**Chromium**

| client | first result, cold | first result, warm | verify, first (warm) | one update | peak renderer RSS above blank |
| --- | ---: | ---: | ---: | ---: | ---: |
| wac, before the fix | 765 ms | 735 ms | 678 ms (648 ms) | 221 ms | 57 MB |
| **wac, after the fix** | **356 ms** | **314 ms** | **270 ms (232 ms)** | **~12 ms** | **66 MB** |
| Lodestar | 374 ms | 283 ms | 216 ms (201 ms) | ~3 ms | 64 MB |
| Helios | 711 ms | 383 ms | 433 ms (sync, with its fetching) | – | 274 MB |

*Cold*: a first visit in a fresh browser context (empty HTTP cache, nothing compiled cached). *Warm*: a second visit
in the same context (code from the HTTP cache, V8's code cache).

**Outside a browser**

| client | first result (fresh process) | verify, first (warm) | one update | peak RSS |
| --- | ---: | ---: | ---: | ---: |
| **wac, native V8 host, after the fix** | **271 ms** | **252 ms (239 ms)** | within noise | **32 MB** |
| wac wasm, Node host, after the fix | 614 ms | 302 ms (295 ms) | within noise | 182 MB |
| wac wasm, Node host, before the fix | 1142 ms | 789 ms (764 ms) | 269 ms | 183 MB |
| Lodestar (Node) | 511 ms | 226 ms (191 ms) | ~7 ms | 124 MB |
| Helios (Node) | 543 ms | 315 ms (sync, with its fetching) | – | 138 MB |

### BLS: where the time goes

The same bytes for each library (`js/mkbls.mjs`): mainnet's 512 sync-committee keys from the bootstrap and a real
aggregate signature, median of 3, each library's own key validation (curve and subgroup).

| BLS12-381 | 512 keys decompressed and checked | aggregate of 512 keys (from bytes) | one verify (hash to G2, pairing) |
| --- | ---: | ---: | ---: |
| wac (`packages/bls`, WasmGC), native V8 host | 212 ms | 206 ms | 12 ms |
| wac, Node host | 228 ms | 227 ms | 14 ms |
| herumi (`bls-eth-wasm` 1.7.0, wasm, via `@chainsafe/bls` 8.2.0), Node | 166 ms | 161 ms | 8.0 ms |
| blst (`@chainsafe/blst` 2.2.0, native), Node | 35 ms | 34 ms | 1.1 ms |
| noble (`@noble/curves` 2.4.0, pure JS), Node | 605 ms | 590 ms | 34 ms |

### What §1 shows

- **Size: wac is about a third of Lodestar and a tenth of Helios over the wire.**
  - The verifier, its BLS and its SSZ are 50 KB brotli without HTTP, or 76 KB with wac's own HTTP/TLS client.
  - A page ships 106–126 KB brotli, against Lodestar's 235 KB and Helios's 1205 KB.
- **Memory.**
  - In a page, wac matches Lodestar (66 MB against 64 MB) and uses a quarter of what Helios uses (274 MB).
  - Outside a browser, wac on its native host peaks at 32 MB, against 124 MB for Lodestar and 138 MB for Helios on
    Node, and 182 MB for the same wasm under wac's Node host.
- **Startup.**
  - In a page, wac's start before verification (first result less fetch and verification) is about 75 ms cold,
    against about 135 ms for Lodestar and about 275 ms for Helios (its init alone is 218 ms).
  - On its native host, wac's first verified result comes at 271 ms, against Lodestar's 511 ms on Node.
- **Speed.**
  - After the fix, wac is level with Lodestar to first result in a page (356 against 374 ms cold) and faster on its
    native host.
  - Verification alone is still slower: 270 against 216 ms. One more update costs wac about 12 ms against
    Lodestar's few.
  - The remaining gap is the arithmetic. wac's BLS12-381 is 1.3–1.5× slower than herumi's (both wasm), 6–11×
    slower than native blst, and 3× faster than pure JavaScript. wac's field arithmetic uses 32-bit limbs in GC
    arrays; herumi's is hand-tuned C++ compiled to linear-memory wasm with 64-bit multiplies.
  - The fix was a change to wac-eth's light client, not to wac. Before it, wac lost by 3× on verification and 12–22×
    per update (in a page, on Node), and that gap was the algorithm's, not WasmGC's.

## 2. eth_getProof verification

**The task.** The recorded `eth_getProof` answer for the ENS registry at mainnet block 26382137 (`proof.json`: the
account proof, 9 nodes, and two storage proofs, 7 and 8 nodes), verified against that block's state root
(`block.json`) from its JSON text each time:
1. the account proof against the state root;
2. the account's RLP;
3. its storage root against `storageHash`;
4. each storage proof against that root;
5. each value against the one stated.

Both sides print the same storage root, and both refuse a wrong root and a changed node
(`@ethereumjs/mpt`'s refusals checked by hand). Per operation: the mean over 200 more.

| side | version | code |
| --- | --- | --- |
| wac | `packages/mpt` (`accountAt`, `storageAt`), `packages/ethrpc`'s JSON readers | `tools/footprint/wac/mptbench.wac` |
| JS | `@ethereumjs/mpt` 10.1.3 (`verifyMerkleProof`, root given, key hashing on), `@ethereumjs/rlp` and `util` 10.1.3 | `tools/footprint/js/mpt-ethereumjs.mjs` |

| what | raw | gzip -9 | brotli -q 11 |
| --- | ---: | ---: | ---: |
| wac `mptbench.wasm` (MPT, RLP, keccak, JSON **+ the 59 KB fetch floor**) | 242 KB | 85 KB | 69 KB |
| `@ethereumjs/mpt` bundle (this task, minified) | 103 KB | 36 KB | 30 KB |

| | first result, cold | first result, warm | per proof | peak memory |
| --- | ---: | ---: | ---: | ---: |
| wac, Chromium | 81 ms | 49 ms | 0.32 ms | 58 MB above blank |
| `@ethereumjs/mpt`, Chromium | 75 ms | 34 ms | 0.75 ms | 63 MB above blank |
| **wac, native V8 host** | **17 ms** | – | **0.30 ms** | **31 MB** |
| wac wasm, Node host | 297 ms | – | 0.36 ms | 179 MB |
| `@ethereumjs/mpt`, Node | 150 ms | – | 1.2 ms | 93 MB |

wac verifies a proof 2.3× faster in a page and 4× faster than `@ethereumjs/mpt` on Node. Its page is bigger: the
verifier is about 10 KB brotli above the fetch floor, but the floor is 59 KB.

## 3. IPFS content verification

**The task.** A 5.4 MB UnixFS tree (5 files, 4 MiB down to 6 KB, in two directories), made by the reference importer
(`ipfs-unixfs-importer` 17.1.1 under IPIP-0499's `unixfs-v1-2025` profile, `js/mkcar.mjs`), as a CAR, with its
root CID. Both sides do the same work:
1. read the CAR;
2. hash every block against its CID into a memory store;
3. check the root;
4. read the whole tree back, every file reassembled, with every block hashed again as it is read (as wac's store
   does).

Both print the same root and 5,664,935 bytes. wac's own importer accepts the reference CAR.

| side | version | code |
| --- | --- | --- |
| wac | `packages/ipfs` (`importCar`, `readTree`), wac's `crypto.sha256` | `tools/footprint/wac/ipfsbench.wac` |
| JS | `@ipld/car` 5.4.7, `ipfs-unixfs-exporter` 16.2.3, `blockstore-core` 7.0.1, `multiformats` 14.0.6; SHA-256 two ways, below | `tools/footprint/js/ipfs-js.mjs` |

The JS side's SHA-256 is either the platform's (multiformats' `sha256`: WebCrypto in a browser, `node:crypto` in
Node, both native code using the CPU's SHA extensions) or `@noble/hashes` 1.8.0 in pure JavaScript. The second
separates the language from the hardware.

| what | raw | gzip -9 | brotli -q 11 |
| --- | ---: | ---: | ---: |
| wac `ipfsbench.wasm` (CAR, UnixFS, CID, SHA-256 + the fetch floor) | 233 KB | 82 KB | 66 KB |
| `@ipld/car` + `ipfs-unixfs-exporter` + `multiformats` bundle (this task) | 137 KB | 42 KB | 37 KB |
| `@helia/verified-fetch` 8.1.2 alone, bundled and minified (not run: it needs a gateway and routing; size only) | 1342 KB | – | – |

| | first result, cold | first result, warm | per 5.4 MB pass | peak memory |
| --- | ---: | ---: | ---: | ---: |
| wac, Chromium | 321 ms | 285 ms | 163 ms | 117 MB above blank |
| JS, WebCrypto SHA-256, Chromium | 106 ms | 65 ms | 19 ms | 69 MB above blank |
| JS, pure-JS SHA-256, Chromium | 297 ms | 253 ms | 199 ms | 71 MB above blank |
| **wac, native V8 host** | **231 ms** | – | **157 ms** | **99 MB** |
| wac wasm, Node host | 776 ms | – | 396 ms | 262 MB |
| JS, `node:crypto` SHA-256, Node | 167 ms | – | 13 ms | 116 MB |
| JS, pure-JS SHA-256, Node | 238 ms | – | 74 ms | 112 MB |

| SHA-256 alone, ms per MiB | ms/MiB | MB/s |
| --- | ---: | ---: |
| wac `crypto.sha256`, native V8 host | 5.4 | 194 |
| wac `crypto.sha256`, Node host | 15.3 | 69 |
| `node:crypto` (native) | 0.72 | 1462 |
| `@noble/hashes` (pure JS), Node | 5.7 | 183 |

**wac loses this one.**
- Bulk hashing in WebAssembly cannot match the platform's native SHA-256, which the JavaScript libraries get for
  free: a pass takes 8× longer in a page and 12× longer on the native host.
- Against pure-JS hashing, wac's SHA-256 is level (194 against 183 MB/s on a current V8) and the whole pass a
  little faster (163 against 199 ms in a page).
- The rest of wac's pass, about 60 % of it, is its CAR and store code copying bytes one at a time. That is fixable
  in `packages/ipfs`, and the same kind of finding as §1's.
- A verifier meant for content should take the platform's hash where there is one. WebAssembly has no SHA
  instructions.

## 4. Statement verification

**The task.** 100 reckon derivation statements signed by four keys **with ethers** (`js/mkstmt.mjs`), as reckon's
signed blocks: DAG-CBOR `{ statement, signer, signature }`, EIP-712 typed data in domain
`{ name: "reckon", version: "2" }`, `Derivation(bytes recipe,bytes output,string runner)`. For each statement:
1. decode the block;
2. recompute the statement's CID and compare;
3. recover the signer (keccak, secp256k1) and compare with the one named.

Both sides verify 100 of 100, so wac checks statements an independent library signed. Per statement: the mean over
1,000.

| side | version | code |
| --- | --- | --- |
| wac | `packages/reckon/src/claims.wac` (`signedFrom`, `statementId`, `verifySigned`), wacuum's secp256k1 | `tools/footprint/wac/stmtbench.wac` |
| viem | viem 2.58.0 (`hashTypedData`, `recoverAddress`), `@ipld/dag-cbor` 10.0.2, `multiformats` 14.0.6 | `js/stmt-js.mjs` + `js/stmt-viem.mjs` |
| ethers | ethers 6.17.0 (`TypedDataEncoder.hash`, `recoverAddress`), the same CBOR and CID | `js/stmt-js.mjs` + `js/stmt-ethers.mjs` |

viem and ethers both recover with `@noble/curves`' secp256k1, in pure JavaScript.

| what | raw | gzip -9 | brotli -q 11 |
| --- | ---: | ---: | ---: |
| wac `stmtbench.wasm` (DAG-CBOR, CID, keccak, secp256k1, EIP-712 + the fetch floor) | 272 KB | 95 KB | 76 KB |
| viem + `@ipld/dag-cbor` bundle (this task) | 104 KB | 37 KB | 32 KB |
| ethers + `@ipld/dag-cbor` bundle (this task) | 93 KB | 32 KB | 28 KB |

| | first result, cold | first result, warm | per statement | peak memory |
| --- | ---: | ---: | ---: | ---: |
| wac, Chromium | 119 ms | 95 ms | 0.24 ms | 66 MB above blank |
| viem, Chromium | 173 ms | 126 ms | 0.75 ms | 56 MB above blank |
| ethers, Chromium | 195 ms | 142 ms | 0.86 ms | 57 MB above blank |
| **wac, native V8 host** | **51 ms** | – | **0.23 ms** | **33 MB** |
| wac wasm, Node host | 340 ms | – | 0.23 ms | 185 MB |
| viem, Node | 471 ms | – | 2.1 ms | 105 MB |
| ethers, Node | 413 ms | – | 2.2 ms | 92 MB |

wac checks a statement 3–4× faster than viem or ethers in a page, and about 9× faster on Node. The JS libraries are
slower on Node 22 than in Chromium, which is the older V8 again. wac's page is bigger, for the same reason as §2.

## Across all four

- **Where WasmGC verifiers are small.** The verifier code is tens of KB brotli. A whole light client with BLS and
  SSZ is 50 KB, against 235 KB (Lodestar) and 1.2 MB (Helios). The overhead is wac's packaging: its own HTTP/TLS
  client (53 KB) and, in a page, its host JS (30–50 KB). On small tasks that makes wac's pages bigger than the JS
  bundles.
- **Where they start fast and stay small.** wac's native host gives first results in 17–271 ms at 31–99 MB peak RSS,
  where Node with a JavaScript library takes 150–543 ms at 92–138 MB. In a page, memory is level with the JS
  libraries except for content verification, and far below Helios.
- **Where they are fast, and where not.**
  - wac wins on integer-heavy verification: MPT proofs (2–4×) and EIP-712 recovery (3–9×).
  - It loses on bulk SHA-256 to native code (8–12×).
  - It loses on BLS arithmetic to herumi's and blst's (1.3–11×).
  - Both §1's 12–22× and part of §3's gap were wac-eth code doing more work than it needed, not the platform.
- **The host matters as much as the module.** The same wac module runs up to about 3× faster under a current V8
  (Chromium 153, or wac's native host on V8 15.2) than under Node 22's V8 12.4: SHA-256 2.8×, content 2.5×,
  the light client and proofs 1.2×. And wac's Node host adds about 150 MB of memory. Read "wac wasm, Node host" rows as what an older engine costs, not as the module's.
- **Not measured.** Firefox and Safari; a phone; WASI-style hosts; wac with its input handed in by the page rather
  than fetched (no such build yet); `@helia/verified-fetch` running (size only); Colibri.
