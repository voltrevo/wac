#!/bin/sh
# The Helios page: lc-helios-web.mjs bundled by esbuild with @a16z/helios's own ES module build (dist/lib.mjs, its
# wasm inlined as base64 by Helios's build), minified. Nothing in Helios is aliased or shimmed.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:?OUTDIR}
mkdir -p "$out"
cd "$here"
npx esbuild lc-helios-web.mjs --bundle --minify --format=esm --platform=browser --target=es2022 --log-level=warning \
  --metafile="$out/meta.json" --outfile="$out/app.js"
cat > "$out/index.html" <<'HTML'
<!doctype html><meta charset="utf-8"><title>helios light client</title><pre id="out"></pre><script type="module" src="app.js"></script>
HTML
