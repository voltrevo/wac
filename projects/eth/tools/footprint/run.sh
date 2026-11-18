#!/bin/sh
# docs/footprint.md, reproduced: builds every side of each comparison, serves the recorded data, measures in Node and
# in Playwright's Chromium, and writes OUT/results/*.jsonl and OUT/report.md (the tables the doc quotes).
#
#     WAC_SRC=/path/to/wac WAC_NATIVE=/path/to/native/wac sh tools/footprint/run.sh OUT [RUNS]
#
# Needs: wac on PATH (its Node host), node 22, deno (wac's browser and native builds), npm, Playwright's Chromium, and
# WAC_SRC: a checkout of wac at the commit wac.lock pins. WAC_NATIVE is wac's native host on V8 (WAC_SRC/native/v8,
# `cargo build --release`): the primary wac runtime outside a browser; without it those rows are left out and only
# the Node host's are measured. RUNS (default 5) fresh runs of each cold measurement.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
out=${1:?OUT}; runs=${2:-5}
src=${WAC_SRC:?set WAC_SRC to a wac checkout at the pinned commit}
mkdir -p "$out"; out=$(cd "$out" && pwd)
rm -rf "$out/web" "$out/results"; mkdir -p "$out/web" "$out/results" "$out/bin"
port=${PORT:-8940}
CP=0xa8356934e2fba13cb82917ea04203c75ca84bb735cefe3cf2f35976628e1e937     # the recording's checkpoint (slot 15621760)
NOW=15621900                                                               # a clock slot just after the recording
CLOCK=1794286103000                                                        # the same, in ms, for clients that read Date
B=http://127.0.0.1:$port

echo "== builds"
(cd "$here/js" && npm ci --no-audit --no-fund --silent)
cd "$root"
wac build --quiet --allow-net --allow-env tools/footprint/wac/lcbench.wac -o "$out/bin/lcbench"
wac build --quiet --allow-read packages/lightclient/cmd/lc.wac -o "$out/bin/lc"
deno run -A "$src/packages/platform/build.ts" tools/footprint/wac/lcbench.wac -o "$out/web/wac" --target browser \
  --layout files --allow-net --allow-env > /dev/null
mkdir -p "$out/web/wac-min"                                    # wac's own JS, minified by esbuild: for the size only
for f in launcher.js worker.js; do (cd "$here/js" && npx esbuild "$out/web/wac/$f" --minify --log-level=warning --outfile="$out/web/wac-min/$f"); done
nat=${WAC_NATIVE:-}
if [ -n "$nat" ]; then
  for b in lcbench mptbench ipfsbench stmtbench blsbench shabench; do
    deno run -A "$src/packages/platform/native.ts" "tools/footprint/wac/$b.wac" -o "$out/nat/$b" --allow-net --allow-env > /dev/null
  done
fi
sh "$here/js/build-lodestar.sh" "$out/web/lodestar"
sh "$here/js/build-helios.sh" "$out/web/helios"
node "$here/js/mkjson.mjs" "$out/json" > /dev/null
node "$here/js/mkbls.mjs" "$here/data/gen" > /dev/null
node "$here/js/mkcar.mjs" "$here/data/gen" > /dev/null
node "$here/js/mkstmt.mjs" "$here/data/gen" > /dev/null
wac build --quiet --allow-net --allow-env tools/footprint/wac/blsbench.wac -o "$out/bin/blsbench"
wac build --quiet tools/footprint/wac/hello.wac -o "$out/bin/hello"
wac build --quiet tools/footprint/wac/shabench.wac -o "$out/bin/shabench"
for b in floor mptbench ipfsbench stmtbench; do
  wac build --quiet --allow-net --allow-env "tools/footprint/wac/$b.wac" -o "$out/bin/$b"
  deno run -A "$src/packages/platform/build.ts" "tools/footprint/wac/$b.wac" -o "$out/web/$b" --target browser \
    --layout files --allow-net --allow-env > /dev/null
done
for e in mpt-ethereumjs ipfs-js stmt-viem stmt-ethers; do sh "$here/js/build-web.sh" "$e" "$out/web/$e"; done

echo "== sizes"
J=$here/js/node_modules
node "$here/sizes.cjs" \
  "wac lcbench (browser: wasm + wac's launcher/worker JS as built)=$out/web/wac/app.wasm,$out/web/wac/launcher.js,$out/web/wac/worker.js" \
  "wac lcbench (browser: wasm + that JS minified by esbuild)=$out/web/wac/app.wasm,$out/web/wac-min/launcher.js,$out/web/wac-min/worker.js" \
  "wac lcbench.wasm alone (light client + wac's HTTP/TLS fetch)=$out/web/wac/app.wasm" \
  "wac lc.wasm (light client, files, ENS and proof path; no HTTP)=$out/bin/lc.wasm" \
  "Lodestar (esbuild bundle of this task, minified, herumi BLS inlined)=$out/web/lodestar/app.js" \
  "Lodestar's published browser bundle (dist/lightclient.min.mjs)=$J/@lodestar/light-client/dist/lightclient.min.mjs" \
  "Helios (esbuild bundle: its dist/lib.mjs, wasm inlined as base64)=$out/web/helios/app.js" \
  "Helios's wasm alone (pkg/index_bg.wasm)=$J/@a16z/helios/pkg/index_bg.wasm" \
  "Colibri's wasm alone (c4w.wasm; not run, see the doc)=$J/@corpus-core/colibri-stateless/c4w.wasm" \
  "wac floor: hello world (runtime, printing)=$out/bin/hello.wasm" \
  "wac floor: fetch only (runtime + wac's HTTP/TLS client)=$out/web/floor/app.wasm" \
  "wac's host JS, as emitted (launcher.js + worker.js)=$out/web/wac/launcher.js,$out/web/wac/worker.js" \
  "wac's host JS, minified by esbuild=$out/web/wac-min/launcher.js,$out/web/wac-min/worker.js" \
  "proofs: wac mptbench.wasm (MPT, RLP, keccak, JSON + the fetch floor)=$out/web/mptbench/app.wasm" \
  "proofs: @ethereumjs/mpt bundle (this task, minified)=$out/web/mpt-ethereumjs/app.js" \
  "IPFS: wac ipfsbench.wasm (CAR, UnixFS, CID, SHA-256 + the fetch floor)=$out/web/ipfsbench/app.wasm" \
  "IPFS: @ipld/car + ipfs-unixfs-exporter + multiformats bundle (this task)=$out/web/ipfs-js/app.js" \
  "statements: wac stmtbench.wasm (DAG-CBOR, CID, keccak, secp256k1, EIP-712 + the fetch floor)=$out/web/stmtbench/app.wasm" \
  "statements: viem + @ipld/dag-cbor bundle (this task)=$out/web/stmt-viem/app.js" \
  "statements: ethers + @ipld/dag-cbor bundle (this task)=$out/web/stmt-ethers/app.js" \
  > "$out/results/sizes.jsonl"

echo "== the replay server"
node "$here/serve.mjs" "$port" "$out/web" "$out/json" 2> "$out/serve.log" & srv=$!
trap 'kill $srv 2>/dev/null || true' EXIT
until curl -s -m1 -o /dev/null "$B/"; do sleep 0.2; done

echo "== light client, Node"
R=$out/results/lc-node.jsonl; : > "$R"
if [ -n "$nat" ]; then
  node "$here/node.cjs" "wac (native V8 host)" "$runs" -- "$nat" "$out/nat/lcbench.wasm" "$B" "$CP" fulu "$NOW" >> "$R"
  node "$here/node.cjs" "wac (native V8 host) finalized" "$runs" -- "$nat" "$out/nat/lcbench.wasm" "$B" "$CP" fulu "$NOW" 1 finalized >> "$R"
  node "$here/node.cjs" "wac (native V8 host) x10" 1 -- "$nat" "$out/nat/lcbench.wasm" "$B" "$CP" fulu "$NOW" 10 >> "$R"
fi
node "$here/node.cjs" "wac wasm, Node host" "$runs" -- wac "$out/bin/lcbench.wasm" "$B" "$CP" fulu "$NOW" >> "$R"
node "$here/node.cjs" "wac wasm, Node host finalized" "$runs" -- wac "$out/bin/lcbench.wasm" "$B" "$CP" fulu "$NOW" 1 finalized >> "$R"
node "$here/node.cjs" "wac wasm, Node host x10" 1 -- wac "$out/bin/lcbench.wasm" "$B" "$CP" fulu "$NOW" 10 >> "$R"
node "$here/node.cjs" "Lodestar" "$runs" -- node "$here/js/lc-lodestar-node.mjs" "$B" "$CP" "$NOW" >> "$R"
node "$here/node.cjs" "Lodestar finalized" "$runs" -- node "$here/js/lc-lodestar-node.mjs" "$B" "$CP" "$NOW" 1 finalized >> "$R"
node "$here/node.cjs" "Lodestar x10" 1 -- node "$here/js/lc-lodestar-node.mjs" "$B" "$CP" "$NOW" 10 >> "$R"
node "$here/node.cjs" "Helios" "$runs" -- node "$here/js/lc-helios-node.mjs" "$B" "$CP" "$CLOCK" >> "$R"

echo "== light client, Chromium"
R=$out/results/lc-browser.jsonl; : > "$R"
q="a=$B&a=$CP&a=fulu&a=$NOW"
node "$here/browser.cjs" "$B/wac/index.html?$q&a=1" "$runs" | sed 's/^{/{"client":"wac",/' >> "$R"
node "$here/browser.cjs" "$B/wac/index.html?$q&a=1&a=finalized" "$runs" | sed 's/^{/{"client":"wac finalized",/' >> "$R"
node "$here/browser.cjs" "$B/wac/index.html?$q&a=10" 1 | sed 's/^{/{"client":"wac x10",/' >> "$R"
node "$here/browser.cjs" "$B/lodestar/index.html?checkpoint=$CP&now=$NOW" "$runs" | sed 's/^{/{"client":"Lodestar",/' >> "$R"
node "$here/browser.cjs" "$B/lodestar/index.html?checkpoint=$CP&now=$NOW&mode=finalized" "$runs" | sed 's/^{/{"client":"Lodestar finalized",/' >> "$R"
node "$here/browser.cjs" "$B/lodestar/index.html?checkpoint=$CP&now=$NOW&repeat=10" 1 | sed 's/^{/{"client":"Lodestar x10",/' >> "$R"
node "$here/browser.cjs" "$B/helios/index.html?checkpoint=$CP" "$runs" --clock "$CLOCK" | sed 's/^{/{"client":"Helios",/' >> "$R"

echo "== eth_getProof"
R=$out/results/mpt-node.jsonl; : > "$R"
[ -n "$nat" ] && node "$here/node.cjs" "wac (native V8 host)" "$runs" -- "$nat" "$out/nat/mptbench.wasm" "$B" 200 >> "$R"
node "$here/node.cjs" "wac wasm, Node host" "$runs" -- wac "$out/bin/mptbench.wasm" "$B" 200 >> "$R"
node "$here/node.cjs" "@ethereumjs/mpt" "$runs" -- node "$here/js/mpt-ethereumjs-node.mjs" "$B" 200 >> "$R"
R=$out/results/mpt-browser.jsonl; : > "$R"
node "$here/browser.cjs" "$B/mptbench/index.html?a=$B&a=200" "$runs" | sed 's/^{/{"client":"wac",/' >> "$R"
node "$here/browser.cjs" "$B/mpt-ethereumjs/index.html?repeat=200" "$runs" | sed 's/^{/{"client":"@ethereumjs\/mpt",/' >> "$R"

echo "== IPFS"
R=$out/results/ipfs-node.jsonl; : > "$R"
[ -n "$nat" ] && node "$here/node.cjs" "wac (native V8 host)" "$runs" -- "$nat" "$out/nat/ipfsbench.wasm" "$B" 5 >> "$R"
node "$here/node.cjs" "wac wasm, Node host" "$runs" -- wac "$out/bin/ipfsbench.wasm" "$B" 5 >> "$R"
node "$here/node.cjs" "JS, platform SHA-256" "$runs" -- node "$here/js/ipfs-js-node.mjs" "$B" 5 platform >> "$R"
node "$here/node.cjs" "JS, pure-JS SHA-256 (@noble/hashes)" "$runs" -- node "$here/js/ipfs-js-node.mjs" "$B" 5 noble >> "$R"
R=$out/results/ipfs-browser.jsonl; : > "$R"
node "$here/browser.cjs" "$B/ipfsbench/index.html?a=$B&a=5" "$runs" | sed 's/^{/{"client":"wac",/' >> "$R"
node "$here/browser.cjs" "$B/ipfs-js/index.html?repeat=5&hash=platform" "$runs" | sed 's/^{/{"client":"JS, platform SHA-256 (WebCrypto)",/' >> "$R"
node "$here/browser.cjs" "$B/ipfs-js/index.html?repeat=5&hash=noble" "$runs" | sed 's/^{/{"client":"JS, pure-JS SHA-256 (@noble\/hashes)",/' >> "$R"
R=$out/results/sha-node.jsonl; : > "$R"
[ -n "$nat" ] && node "$here/node.cjs" "wac crypto.sha256 (native V8 host)" 3 -- "$nat" "$out/nat/shabench.wasm" >> "$R"
node "$here/node.cjs" "wac crypto.sha256 (Node host)" 3 -- wac "$out/bin/shabench.wasm" >> "$R"
node "$here/node.cjs" "node:crypto (native)" 3 -- node "$here/js/sha-js.mjs" platform >> "$R"
node "$here/node.cjs" "@noble/hashes (pure JS)" 3 -- node "$here/js/sha-js.mjs" noble >> "$R"

echo "== statements"
R=$out/results/stmt-node.jsonl; : > "$R"
[ -n "$nat" ] && node "$here/node.cjs" "wac (native V8 host)" "$runs" -- "$nat" "$out/nat/stmtbench.wasm" "$B" 10 >> "$R"
node "$here/node.cjs" "wac wasm, Node host" "$runs" -- wac "$out/bin/stmtbench.wasm" "$B" 10 >> "$R"
node "$here/node.cjs" "viem + @ipld/dag-cbor" "$runs" -- node "$here/js/stmt-js-node.mjs" "$B" viem 10 >> "$R"
node "$here/node.cjs" "ethers + @ipld/dag-cbor" "$runs" -- node "$here/js/stmt-js-node.mjs" "$B" ethers 10 >> "$R"
R=$out/results/stmt-browser.jsonl; : > "$R"
node "$here/browser.cjs" "$B/stmtbench/index.html?a=$B&a=10" "$runs" | sed 's/^{/{"client":"wac",/' >> "$R"
node "$here/browser.cjs" "$B/stmt-viem/index.html?repeat=10" "$runs" | sed 's/^{/{"client":"viem + @ipld\/dag-cbor",/' >> "$R"
node "$here/browser.cjs" "$B/stmt-ethers/index.html?repeat=10" "$runs" | sed 's/^{/{"client":"ethers + @ipld\/dag-cbor",/' >> "$R"

echo "== BLS, Node"
R=$out/results/bls-node.jsonl; : > "$R"
[ -n "$nat" ] && node "$here/node.cjs" "wac (native V8 host)" 1 -- "$nat" "$out/nat/blsbench.wasm" "$B" 3 >> "$R"
node "$here/node.cjs" "wac wasm, Node host" 1 -- wac "$out/bin/blsbench.wasm" "$B" 3 >> "$R"
for impl in herumi blst noble; do node "$here/node.cjs" "$impl" 1 -- node "$here/js/bls-js.mjs" "$B" "$impl" 3 >> "$R"; done

echo "== report"
node "$here/summarize.cjs" "$out/results" > "$out/report.md"
echo "footprint: $out/report.md"
