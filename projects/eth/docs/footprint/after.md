# Footprint run: after the light-client fix, with wac's native V8 host

`tools/footprint/run.sh` output, as written: the numbers docs/footprint.md quotes.

### Sizes

| what | raw | gzip -9 | brotli -q 11 |
| --- | ---: | ---: | ---: |
| wac lcbench (browser: wasm + wac's launcher/worker JS as built) | 481 KB | 154 KB | 126 KB |
| wac lcbench (browser: wasm + that JS minified by esbuild) | 376 KB | 130 KB | 106 KB |
| wac lcbench.wasm alone (light client + wac's HTTP/TLS fetch) | 274 KB | 96 KB | 76 KB |
| wac lc.wasm (light client, files, ENS and proof path; no HTTP) | 177 KB | 61 KB | 50 KB |
| Lodestar (esbuild bundle of this task, minified, herumi BLS inlined) | 1057 KB | 305 KB | 235 KB |
| Lodestar's published browser bundle (dist/lightclient.min.mjs) | 1219 KB | 347 KB | 258 KB |
| Helios (esbuild bundle: its dist/lib.mjs, wasm inlined as base64) | 4350 KB | 1665 KB | 1205 KB |
| Helios's wasm alone (pkg/index_bg.wasm) | 3236 KB | 1184 KB | 845 KB |
| Colibri's wasm alone (c4w.wasm; not run, see the doc) | 1367 KB | 482 KB | 383 KB |
| wac floor: hello world (runtime, printing) | 24 KB | 7.9 KB | 6.4 KB |
| wac floor: fetch only (runtime + wac's HTTP/TLS client) | 207 KB | 73 KB | 59 KB |
| wac's host JS, as emitted (launcher.js + worker.js) | 206 KB | 58 KB | 50 KB |
| wac's host JS, minified by esbuild | 102 KB | 34 KB | 30 KB |
| proofs: wac mptbench.wasm (MPT, RLP, keccak, JSON + the fetch floor) | 242 KB | 85 KB | 69 KB |
| proofs: @ethereumjs/mpt bundle (this task, minified) | 103 KB | 36 KB | 30 KB |
| IPFS: wac ipfsbench.wasm (CAR, UnixFS, CID, SHA-256 + the fetch floor) | 233 KB | 82 KB | 66 KB |
| IPFS: @ipld/car + ipfs-unixfs-exporter + multiformats bundle (this task) | 137 KB | 42 KB | 37 KB |
| statements: wac stmtbench.wasm (DAG-CBOR, CID, keccak, secp256k1, EIP-712 + the fetch floor) | 272 KB | 95 KB | 76 KB |
| statements: viem + @ipld/dag-cbor bundle (this task) | 104 KB | 37 KB | 32 KB |
| statements: ethers + @ipld/dag-cbor bundle (this task) | 93 KB | 32 KB | 28 KB |

### Light client, Node

| client | first result (fresh process) | fetch | verify (first) | one update | peak RSS | result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| wac (native V8 host) | 271 ms | 6.5 ms | 252 ms (warm 239 ms) | -5.0 ms | 32 MB | `0x64d8a6b3…` |
| wac wasm, Node host | 614 ms | 14 ms | 302 ms (warm 295 ms) | 0.3 ms | 182 MB | `0x64d8a6b3…` |
| Lodestar | 511 ms | 21 ms | 226 ms (warm 191 ms) | 6.9 ms | 124 MB | `0x64d8a6b3…` |
| Helios | 543 ms | – | 315 ms | – | 138 MB | `0x25de6165…` |

### BLS12-381, Node (median of 3, mainnet keys)

| library | 512 keys decompressed and checked | aggregate of 512 | one verify |
| --- | ---: | ---: | ---: |
| wac (native V8 host) | 212 ms | 206 ms | 12 ms |
| wac wasm, Node host | 228 ms | 227 ms | 14 ms |
| herumi | 166 ms | 161 ms | 8.0 ms |
| blst | 35 ms | 34 ms | 1.1 ms |
| noble | 605 ms | 590 ms | 34 ms |

### Light client, Chromium

Chromium (Playwright); a blank page's renderer peaks at 75 MB, subtracted below.

| client | first result, cold | first result, warm | fetch | verify (first) | one update | peak renderer RSS above blank | result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| wac | 356 ms | 314 ms | 13 ms | 270 ms (warm 232 ms) | 12 ms | 66 MB | `0x64d8a6b3…` |
| Lodestar | 374 ms | 283 ms | 22 ms | 216 ms (warm 201 ms) | 2.9 ms | 64 MB | `0x64d8a6b3…` |
| Helios | 711 ms | 383 ms | – | 433 ms | – | 274 MB | `0x25de6165…` |

### IPFS content (5.4 MB CAR), Chromium

| client | first result, cold | first result, warm | per operation | peak renderer RSS above blank | result |
| --- | ---: | ---: | ---: | ---: | --- |
| wac | 321 ms | 285 ms | 163.2 ms | 117 MB | `bafybeic3xk2pskp` |
| JS, platform SHA-256 (WebCrypto) | 106 ms | 65 ms | 19.4 ms | 69 MB | `bafybeic3xk2pskp` |
| JS, pure-JS SHA-256 (@noble/hashes) | 297 ms | 253 ms | 198.7 ms | 71 MB | `bafybeic3xk2pskp` |

### IPFS content (5.4 MB CAR), Node

| client | first result (fresh process) | per operation | peak RSS | result |
| --- | ---: | ---: | ---: | --- |
| wac (native V8 host) | 231 ms | 157.4 ms | 99 MB | `bafybeic3xk2pskp` |
| wac wasm, Node host | 776 ms | 396.2 ms | 262 MB | `bafybeic3xk2pskp` |
| JS, platform SHA-256 | 167 ms | 13.3 ms | 116 MB | `bafybeic3xk2pskp` |
| JS, pure-JS SHA-256 (@noble/hashes) | 238 ms | 74.3 ms | 112 MB | `bafybeic3xk2pskp` |

### eth_getProof, Chromium

| client | first result, cold | first result, warm | per operation | peak renderer RSS above blank | result |
| --- | ---: | ---: | ---: | ---: | --- |
| wac | 81 ms | 49 ms | 0.323 ms | 58 MB | `ok` |
| @ethereumjs/mpt | 75 ms | 34 ms | 0.747 ms | 63 MB | `ok` |

### eth_getProof, Node

| client | first result (fresh process) | per operation | peak RSS | result |
| --- | ---: | ---: | ---: | --- |
| wac (native V8 host) | 17 ms | 0.301 ms | 31 MB | `ok` |
| wac wasm, Node host | 297 ms | 0.356 ms | 179 MB | `ok` |
| @ethereumjs/mpt | 150 ms | 1.2 ms | 93 MB | `ok` |

### SHA-256 (ms per MiB), Node

| implementation | ms per MiB | MB/s |
| --- | ---: | ---: |
| wac crypto.sha256 (native V8 host) | 5.39 | 194 |
| wac crypto.sha256 (Node host) | 15.30 | 69 |
| node:crypto (native) | 0.72 | 1462 |
| @noble/hashes (pure JS) | 5.73 | 183 |

### Statements (100, per statement), Chromium

| client | first result, cold | first result, warm | per operation | peak renderer RSS above blank | result |
| --- | ---: | ---: | ---: | ---: | --- |
| wac | 119 ms | 95 ms | 0.238 ms | 66 MB | `100/100` |
| viem + @ipld/dag-cbor | 173 ms | 126 ms | 0.747 ms | 56 MB | `100/100` |
| ethers + @ipld/dag-cbor | 195 ms | 142 ms | 0.863 ms | 57 MB | `100/100` |

### Statements (100, per statement), Node

| client | first result (fresh process) | per operation | peak RSS | result |
| --- | ---: | ---: | ---: | --- |
| wac (native V8 host) | 51 ms | 0.233 ms | 33 MB | `100/100` |
| wac wasm, Node host | 340 ms | 0.234 ms | 185 MB | `100/100` |
| viem + @ipld/dag-cbor | 471 ms | 2.1 ms | 105 MB | `100/100` |
| ethers + @ipld/dag-cbor | 413 ms | 2.2 ms | 92 MB | `100/100` |

