#!/bin/sh
# Builds revm for the footprint comparison, from scratch, in one command:
#   sh build.sh
# Two artifacts, identical but for the optimisation goal, so size and speed can each be compared fairly:
#   ../dist/revm-s/  cargo opt-level "s", then wasm-opt -Oz   (the small one)
#   ../dist/revm-3/  cargo opt-level 3,   then wasm-opt -O3   (the fast one)
# Each holds revm_wasm.js (wasm-bindgen --target web: an ES module whose initSync({module: bytes})
# works in Node and browsers alike) and revm_wasm_bg.wasm, plus the pre-wasm-opt .wasm for the record.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
footprint=$(cd "$here/.." && pwd)
dist="$footprint/dist"
WASM_OPT="$footprint/node_modules/.bin/wasm-opt"
WASM_BINDGEN="${WASM_BINDGEN:-$HOME/.cargo/bin/wasm-bindgen}"
[ -x "$WASM_OPT" ] || (cd "$footprint" && npm ci)

# The wasm-bindgen CLI must be the crate's exact version (Cargo.toml pins =0.2.100).
"$WASM_BINDGEN" --version | grep -q ' 0\.2\.100' || { echo "need wasm-bindgen-cli 0.2.100" >&2; exit 1; }

# Features rustc 1.97 emits for wasm32-unknown-unknown by default (its "generic" CPU); wasm-opt must
# accept them as input, and enabling no others keeps the output loadable everywhere those run.
FEATURES="--enable-bulk-memory --enable-sign-ext --enable-nontrapping-float-to-int --enable-mutable-globals --enable-multivalue --enable-reference-types"

cd "$here"
for variant in "s release-s -Oz" "3 release -O3"; do
  set -- $variant
  name=$1 profile=$2 opt=$3
  cargo build --locked --profile "$profile" --target wasm32-unknown-unknown
  out="$dist/revm-$name"
  rm -rf "$out"; mkdir -p "$out"
  "$WASM_BINDGEN" --target web --no-typescript --out-dir "$out" \
    "target/wasm32-unknown-unknown/$profile/revm_wasm.wasm"
  cp "$out/revm_wasm_bg.wasm" "$out/revm_wasm_bg.pre-opt.wasm"
  "$WASM_OPT" $opt $FEATURES "$out/revm_wasm_bg.pre-opt.wasm" -o "$out/revm_wasm_bg.wasm"
  echo "revm-$name: cargo $(wc -c < "target/wasm32-unknown-unknown/$profile/revm_wasm.wasm")" \
       "bindgen $(wc -c < "$out/revm_wasm_bg.pre-opt.wasm") wasm-opt $(wc -c < "$out/revm_wasm_bg.wasm") bytes"
done
