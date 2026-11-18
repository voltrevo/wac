# Footprint run: the light client before the fix (commit 33298f9), and the rest as first measured

`tools/footprint/run.sh` output, as written. docs/footprint.md quotes its light-client rows as "before the fix"; every other table there is from after.md.

### Sizes

| what | raw | gzip -9 | brotli -q 11 |
| --- | ---: | ---: | ---: |
| wac lcbench (browser: wasm + wac's launcher/worker JS as built) | 480 KB | 154 KB | 126 KB |
| wac lcbench (browser: wasm + that JS minified by esbuild) | 375 KB | 129 KB | 106 KB |
| wac lcbench.wasm alone (light client + wac's HTTP/TLS fetch) | 273 KB | 95 KB | 76 KB |
| wac lc.wasm (light client, files, ENS and proof path; no HTTP) | 175 KB | 61 KB | 50 KB |
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
| wac (Node host) | 1142 ms | 26 ms | 789 ms (warm 764 ms) | 269 ms | 183 MB | `0x64d8a6b3…` |
| Lodestar | 502 ms | 20 ms | 218 ms (warm 185 ms) | 12 ms | 122 MB | `0x64d8a6b3…` |
| Helios | 568 ms | – | 324 ms | – | 139 MB | `0x25de6165…` |

### BLS12-381, Node (median of 3, mainnet keys)

| library | 512 keys decompressed and checked | aggregate of 512 | one verify |
| --- | ---: | ---: | ---: |
| wac | 243 ms | 242 ms | 18 ms |
| herumi | 163 ms | 160 ms | 9.6 ms |
| blst | 36 ms | 36 ms | 1.2 ms |
| noble | 691 ms | 630 ms | 34 ms |

### Light client, Chromium

Chromium (Playwright); a blank page's renderer peaks at 75 MB, subtracted below.

| client | first result, cold | first result, warm | fetch | verify (first) | one update | peak renderer RSS above blank | result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| wac | 765 ms | 735 ms | 14 ms | 678 ms (warm 648 ms) | 221 ms | 57 MB | `0x64d8a6b3…` |
| Lodestar | 384 ms | 294 ms | 22 ms | 232 ms (warm 201 ms) | 18 ms | 63 MB | `0x64d8a6b3…` |
| Helios | 698 ms | 388 ms | – | 414 ms | – | 276 MB | `0x25de6165…` |

### IPFS content (5.4 MB CAR), Chromium

| client | first result, cold | first result, warm | per operation | peak renderer RSS above blank | result |
| --- | ---: | ---: | ---: | ---: | --- |
| wac | 329 ms | 304 ms | 160.7 ms | 116 MB | `bafybeic3xk2pskp` |
| JS, platform SHA-256 (WebCrypto) | 99 ms | 66 ms | 20.3 ms | 68 MB | `bafybeic3xk2pskp` |
| JS, pure-JS SHA-256 (@noble/hashes) | 302 ms | 247 ms | 199.7 ms | 71 MB | `bafybeic3xk2pskp` |

### IPFS content (5.4 MB CAR), Node

| client | first result (fresh process) | per operation | peak RSS | result |
| --- | ---: | ---: | ---: | --- |
| wac (Node host) | 793 ms | 404.8 ms | 262 MB | `bafybeic3xk2pskp` |
| JS, platform SHA-256 | 178 ms | 13.7 ms | 119 MB | `bafybeic3xk2pskp` |
| JS, pure-JS SHA-256 (@noble/hashes) | 264 ms | 81.9 ms | 111 MB | `bafybeic3xk2pskp` |

### eth_getProof, Chromium

| client | first result, cold | first result, warm | per operation | peak renderer RSS above blank | result |
| --- | ---: | ---: | ---: | ---: | --- |
| wac | 97 ms | 52 ms | 0.344 ms | 57 MB | `ok` |
| @ethereumjs/mpt | 74 ms | 35 ms | 0.740 ms | 58 MB | `ok` |

### eth_getProof, Node

| client | first result (fresh process) | per operation | peak RSS | result |
| --- | ---: | ---: | ---: | --- |
| wac (Node host) | 308 ms | 0.369 ms | 179 MB | `ok` |
| @ethereumjs/mpt | 140 ms | 1.1 ms | 97 MB | `ok` |

### SHA-256 (ms per MiB), Node

| implementation | ms per MiB | MB/s |
| --- | ---: | ---: |
| wac crypto.sha256 | 15.93 | 66 |
| node:crypto (native) | 0.76 | 1378 |
| @noble/hashes (pure JS) | 5.42 | 193 |

### Statements (100, per statement), Chromium

| client | first result, cold | first result, warm | per operation | peak renderer RSS above blank | result |
| --- | ---: | ---: | ---: | ---: | --- |
| wac | 122 ms | 88 ms | 0.230 ms | 56 MB | `100/100` |
| viem + @ipld/dag-cbor | 209 ms | 154 ms | 0.736 ms | 43 MB | `100/100` |
| ethers + @ipld/dag-cbor | 227 ms | 138 ms | 0.904 ms | 60 MB | `100/100` |

### Statements (100, per statement), Node

| client | first result (fresh process) | per operation | peak RSS | result |
| --- | ---: | ---: | ---: | --- |
| wac (Node host) | 379 ms | 0.247 ms | 185 MB | `100/100` |
| viem + @ipld/dag-cbor | 500 ms | 2.1 ms | 106 MB | `100/100` |
| ethers + @ipld/dag-cbor | 454 ms | 2.4 ms | 92 MB | `100/100` |

