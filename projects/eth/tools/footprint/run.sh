#!/bin/sh
# docs/footprint.md, reproduced: builds every side of each comparison, serves the recorded data, measures in Node and
# in Playwright's Chromium, and writes OUT/results/*.jsonl and OUT/report.md (the tables the doc quotes).
#
#     WAC_SRC=/path/to/wac sh tools/footprint/run.sh OUT [RUNS]
#
# Needs: wac on PATH (the Node host), node 22, deno (wac's browser build), npm, Playwright's Chromium, and WAC_SRC: a
# checkout of wac at the commit wac.lock pins. RUNS (default 5) fresh runs of each cold measurement.
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
sh "$here/js/build-lodestar.sh" "$out/web/lodestar"
sh "$here/js/build-helios.sh" "$out/web/helios"
node "$here/js/mkjson.mjs" "$out/json" > /dev/null
node "$here/js/mkbls.mjs" "$here/data/gen" > /dev/null
wac build --quiet --allow-net --allow-env tools/footprint/wac/blsbench.wac -o "$out/bin/blsbench"

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
  > "$out/results/sizes.jsonl"

echo "== the replay server"
node "$here/serve.mjs" "$port" "$out/web" "$out/json" 2> "$out/serve.log" & srv=$!
trap 'kill $srv 2>/dev/null || true' EXIT
until curl -s -m1 -o /dev/null "$B/"; do sleep 0.2; done

echo "== light client, Node"
R=$out/results/lc-node.jsonl; : > "$R"
node "$here/node.cjs" "wac (Node host)" "$runs" -- wac "$out/bin/lcbench.wasm" "$B" "$CP" fulu "$NOW" >> "$R"
node "$here/node.cjs" "wac (Node host) finalized" "$runs" -- wac "$out/bin/lcbench.wasm" "$B" "$CP" fulu "$NOW" 1 finalized >> "$R"
node "$here/node.cjs" "wac (Node host) x10" 1 -- wac "$out/bin/lcbench.wasm" "$B" "$CP" fulu "$NOW" 10 >> "$R"
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

echo "== BLS, Node"
R=$out/results/bls-node.jsonl; : > "$R"
node "$here/node.cjs" "wac" 1 -- wac "$out/bin/blsbench.wasm" "$B" 3 >> "$R"
for impl in herumi blst noble; do node "$here/node.cjs" "$impl" 1 -- node "$here/js/bls-js.mjs" "$B" "$impl" 3 >> "$R"; done

echo "== report"
node "$here/summarize.cjs" "$out/results" > "$out/report.md"
echo "footprint: $out/report.md"
