# Footprint: small WasmGC verifiers against the standard ones

**What this is for.** Evidence about what verifiers built as small WebAssembly-GC modules can cost, against the
libraries people use today, for the Reads 2027 proposal. wac is experimental: read this as "this footprint is
possible", not as a recommendation of wac. Where wac loses, it says so, and where the comparison is not like for like,
it says how.

**How to reproduce.** One command, from a wac-eth checkout on branch `measure/footprint`:

    WAC_SRC=/path/to/wac sh tools/footprint/run.sh OUT [RUNS]

It builds every side of every comparison, serves the recorded data from one local server, measures each in Node and
in Playwright's Chromium, and writes `OUT/results/*.jsonl` and `OUT/report.md` (the tables below). The numbers here
are from one run of it, 5 fresh runs per cold measurement, medians.

| | |
| --- | --- |
| machine | 4 vCPU Intel Xeon @ 2.10 GHz, Linux 6.18, in a cloud container (noisy neighbours possible) |
| Node | 22.23.4 |
| browser | Chromium 153.0.8010.12, headless, through Playwright 1.63.0 |
| wac | `aaef775ca` (the pin in `wac.lock`); its Node host for Node, its `--target browser --layout files` build for the browser |
| JS libraries | `tools/footprint/js/package.json` and its lock: exact versions, listed with each comparison |
| bundling | esbuild 0.25.12: `--bundle --minify --format=esm --platform=browser --target=es2022`; shims and aliases named below |
| compression | each file alone, gzip level 9 and brotli quality 11 (Node's zlib), summed |

**Browser requirements.** wac's modules need WebAssembly GC (with typed function references and exception
handling): Chrome/Edge 119+, Firefox 120+, Safari 18.2+. wac's browser host also uses `SharedArrayBuffer` and
`Atomics.wait` in a worker for its synchronous waits, so a page must be cross-origin isolated (COOP/COEP headers).
Lodestar's bundle needs WebAssembly (MVP) for its BLS. Helios's needs WebAssembly (MVP).

## 1. Light client

**The task.** From mainnet checkpoint `0xa835…e937` (slot 15621760, Fulu), recorded on 2026-11-10
(`packages/lightclient/test/mainnet`): the bootstrap, the period's sync-committee update, the finality update and the
optimistic update, fetched from a beacon node's REST API (a local replay server, `tools/footprint/serve.mjs`), verified,
and the execution state root the optimistic header proves printed. All three clients print the same roots:
`0x64d8…9870` (optimistic) and `0x25de…e04e` (finalized).

| client | version | what it verifies here | BLS |
| --- | --- | --- | --- |
| wac (`tools/footprint/wac/lcbench.wac` over `packages/lightclient`) | wac-eth `measure/footprint`, wac `aaef775ca` | bootstrap (header root, committee branch), 3 sync aggregates (update, finality, optimistic), finality and committee branches, execution branch | wac's own BLS12-381 (`packages/bls` in wac), in the same module |
| Lodestar (`@lodestar/light-client`, `tools/footprint/js/lc-lodestar.mjs`) | 1.43.0 (`@lodestar/config`/`types` 1.51.0, `@chainsafe/bls` 8.2.0) | the same, through its own `validateLightClientBootstrap` and `LightclientSpec` | herumi's wasm (`bls-eth-wasm` 1.7.0), **in Node too**: see below |
| Helios (`@a16z/helios`, its wasm build, `lc-helios.mjs`) | 0.12.0 | bootstrap, update and finality (2 sync aggregates; it does not take the optimistic update before calling itself synced), **plus** fetching and re-hashing the finalized and latest execution blocks with all their transactions | its own (Rust, compiled into its wasm) |

What differs, said plainly:

- **Transport.** wac and Lodestar fetch all four answers first and the fetch is timed apart (a few ms locally).
  Helios fetches as it goes, so its "verify" includes its fetching, and it also fetches two full execution blocks
  (300 transactions) from the replay server's execution RPC (`data/blocks`, mainnet's own, fetched once), which it
  insists on. Its task is larger in that respect and smaller by one sync aggregate.
- **Lodestar's BLS in Node is herumi's wasm, not native blst.** `@chainsafe/bls` 8.2.0 picks native blst only from
  `@chainsafe/blst` 1.x, a peer dependency: the light client depends on 2.x, and 1.x's install script fails today. So
  Lodestar runs the same wasm BLS in Node as in the browser. A native-blst ceiling is in the BLS table below.
- **Lodestar's browser bundle** is this task bundled by esbuild (`js/build-lodestar.sh`): `@chainsafe/bls` aliased to
  its herumi entry (its package `exports` would otherwise try native blst first), Node built-ins that unused code
  imports aliased to an empty module, and `Buffer` injected from the `buffer` package (as Lodestar's own browser bundle
  polyfills it). Lodestar's published `dist/lightclient.min.mjs` (the whole client, with its transport) is listed
  for size too.
- **Helios's bundle** is its own `dist/lib.mjs` (its wasm inlined as base64) and a few lines of ours. Nothing in it
  was changed. Its clock is pinned to the recording's time (only `Date`), because it refuses data older than the
  wall clock allows.
- **wac's browser size** counts wac's own host JS (`launcher.js`, `worker.js`, about 210 KB as wac emits them, 105 KB
  minified), which every wac program carries. `lcbench.wasm` also contains wac's HTTP client and TLS stack (it
  fetches); `lc.wasm`, the command that reads files, has none, and has the ENS and proof path instead.

### Sizes

| what | raw | gzip -9 | brotli -q 11 |
| --- | ---: | ---: | ---: |
| wac, browser: `lcbench` wasm + wac's launcher/worker JS as emitted | 480 KB | 154 KB | 126 KB |
| wac, browser: the same with that JS minified by esbuild | 375 KB | 129 KB | 106 KB |
| wac, `lcbench.wasm` alone (light client, BLS, SSZ, wac's HTTP/TLS fetch) | 273 KB | 95 KB | 76 KB |
| wac, `lc.wasm` (light client, BLS, SSZ, ENS and proof path; reads files, no HTTP) | 175 KB | 61 KB | 50 KB |
| Lodestar: this task, esbuild bundle (herumi BLS wasm inlined) | 1057 KB | 305 KB | 235 KB |
| Lodestar's published browser bundle (`dist/lightclient.min.mjs`) | 1219 KB | 347 KB | 258 KB |
| Helios: its `dist/lib.mjs` bundled (wasm inlined as base64) | 4350 KB | 1665 KB | 1205 KB |
| Helios's wasm alone (`pkg/index_bg.wasm`) | 3236 KB | 1184 KB | 845 KB |
| Colibri's wasm alone (`@corpus-core/colibri-stateless` 3.1.1, `c4w.wasm`; not run, below) | 1367 KB | 482 KB | 383 KB |

### Node

A fresh process each run. *First result* is from spawning the process to its printing the result: runtime start,
loading and compiling the code, init, fetch and verification. *Peak RSS* is the process's resident high-water mark.

| client | first result | fetch | verify, first (warm) | one update | peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| wac (its Node host) | 1086 ms | 15 ms | 757 ms (767 ms) | 233 ms | 183 MB |
| Lodestar | 506 ms | 20 ms | 224 ms (187 ms) | 20 ms | 122 MB |
| Helios | 563 ms | in sync | 307 ms (sync, with its fetching) | – | 138 MB |

### Chromium

*Cold* is a first visit in a fresh browser context (empty HTTP cache, nothing compiled cached); *warm* is a second
visit in the same context (code from the HTTP cache, V8's code cache). *First result* is from navigation start to the
page printing the result. *Peak renderer RSS* is the renderer processes' resident set (page, workers, JS heap, wasm
memory, compiled code), sampled every 20 ms, less a blank page's (75 MB). (`performance.measureUserAgentSpecificMemory`
is not exposed in this headless build.)

| client | first result, cold | first result, warm | verify, first (warm) | one update | startup (first result − fetch − verify), cold | peak renderer RSS above blank |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| wac | 777 ms | 722 ms | 690 ms (650 ms) | 203 ms | ~70 ms | 65 MB |
| Lodestar | 366 ms | 295 ms | 221 ms (217 ms) | ~0–20 ms | ~120 ms | 64 MB |
| Helios | 702 ms | 389 ms | 428 ms (sync, with its fetching) | – | ~275 ms (its init: 218 ms) | 274 MB |

*Verify* is the whole sequence (bootstrap, three sync aggregates). *One update* is the full sequence less the same
without the optimistic update: the marginal cost of one more signed update.

### BLS: where the time goes

The same bytes for each library (`js/mkbls.mjs`): mainnet's 512 sync-committee keys from the bootstrap and a real
aggregate signature. Node, median of 3. Each library's own key validation (curve and subgroup).

| BLS12-381 | 512 keys decompressed and checked | aggregate of 512 keys (from bytes) | one verify (hash to G2, pairing) |
| --- | ---: | ---: | ---: |
| wac (`packages/bls`, WasmGC) | 245 ms | 243 ms | 13.2 ms |
| herumi (`bls-eth-wasm` 1.7.0, wasm, via `@chainsafe/bls` 8.2.0) | 164 ms | 175 ms | 7.4 ms |
| blst (`@chainsafe/blst` 2.2.0, native) | 36 ms | 44 ms | 1.4 ms |
| noble (`@noble/curves` 2.4.0, pure JS) | 607 ms | 600 ms | 33 ms |

### What it shows

- **Size: wac is about a third of Lodestar and a tenth of Helios over the wire.** The verifier, its BLS and its SSZ
  are 50 KB brotli without HTTP (76 KB with wac's own HTTP/TLS client). With wac's host JS, a page ships 106–126 KB
  brotli against Lodestar's 235 KB and Helios's 1205 KB. The memory in a page is Lodestar's (65 MB against 64 MB),
  and a quarter of Helios's (274 MB).
- **Startup: wac is the quickest to be ready in a page** (about 70 ms cold, against 120 ms and 275 ms). In Node, its
  host is heavier to start than Node loading Lodestar's modules (about 310 ms against 260 ms).
- **Speed: wac loses, and by a lot per update.** The whole sequence takes 3× Lodestar's time (690 ms against 221 ms
  in a page), and one more update costs wac about 200 ms against Lodestar's few ms. The BLS table says why, and
  most of it is not WasmGC:
  - **The algorithm.** wac's light client decompresses and subgroup-checks all 512 committee keys for every update
    (about 245 ms). Lodestar does that once per committee, keeps the points, and aggregates the participants by
    subtracting the few who did not sign. That is a change to `packages/lightclient`, not to the language, and would
    bring wac's per-update cost to about one aggregate and one pairing check (tens of ms).
  - **The arithmetic.** wac's BLS12-381 is 1.5–1.8× slower than herumi's (both wasm), 7–10× slower than native blst,
    and 2.5× faster than pure JavaScript. wac's field arithmetic uses 32-bit limbs in GC arrays. herumi's is
    hand-tuned C++ compiled to linear-memory wasm with 64-bit multiplies.
- **Not run: Colibri.** `@corpus-core/colibri-stateless` verifies proofs that its prover builds for each RPC answer,
  starting from a sync committee it caches (or a ZK proof of one). It does not process the beacon API's light-client
  updates as the others do, so it has no equivalent of this task offline. Its wasm's size is listed.

## 2. eth_getProof verification

*(next: wac `packages/mpt` + `packages/ethrpc` against `@ethereumjs/mpt` 10.1.3)*

## 3. IPFS content verification

*(next)*

## 4. Statement verification

*(next)*
