#!/bin/sh
# A harness page for one of the JS entries (ENTRY-web.mjs): bundled by esbuild, minified and tree-shaken, with no
# aliases or shims (sh build-web.sh ENTRY OUTDIR). The light clients have their own scripts (build-lodestar.sh,
# build-helios.sh), because they need them.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
entry=${1:?ENTRY}; out=${2:?OUTDIR}
mkdir -p "$out"
cd "$here"
npx esbuild "$entry-web.mjs" --bundle --minify --format=esm --platform=browser --target=es2022 --log-level=warning \
  --metafile="$out/meta.json" --outfile="$out/app.js"
printf '<!doctype html><meta charset="utf-8"><title>%s</title><pre id="out"></pre><script type="module" src="app.js"></script>\n' "$entry" > "$out/index.html"
