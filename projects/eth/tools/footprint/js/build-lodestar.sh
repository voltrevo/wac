#!/bin/sh
# The Lodestar light-client bundle for the browser: lc-lodestar-web.mjs, minified and tree-shaken by esbuild. BLS is
# @chainsafe/bls's herumi build (bls-eth-wasm, inlined), as Lodestar's own browser bundle has it: the package's
# "import" entry would try native blst first, so it is aliased to the herumi entry. Node built-ins that unused code
# imports are aliased to an empty module, and Buffer is the buffer package, injected.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:?OUTDIR}
mkdir -p "$out"
cd "$here"
empty="$here/empty.mjs"
npx esbuild lc-lodestar-web.mjs --bundle --minify --format=esm --platform=browser --target=es2022 --log-level=warning \
  --alias:@chainsafe/bls="$here/node_modules/@chainsafe/bls/lib/herumi/index.js" \
  --alias:node:fs="$empty" --alias:url="$empty" --alias:events="$empty" --alias:https="$empty" --alias:http="$empty" \
  --alias:util="$empty" --alias:crypto="$empty" \
  --inject:"$here/buffer-shim.mjs" --metafile="$out/meta.json" --outfile="$out/app.js"
cat > "$out/index.html" <<'HTML'
<!doctype html><meta charset="utf-8"><title>lodestar light client</title><pre id="out"></pre><script type="module" src="app.js"></script>
HTML
