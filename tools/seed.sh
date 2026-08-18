#!/usr/bin/env bash
#
# Rebuild the compiler inside the `wac` binary, and refuse to keep one that is not a fixed point.
#
#   tools/seed.sh              # build with the binary we have
#   tools/seed.sh --bootstrap  # build with Deno first, for a clone that has no binary yet
#
# `design/lang/0009` D2: a compiler that merely compiled once must not be published. CLAUDE.md has
# claimed this is a fixed point for a while; until now nothing checked it at the moment the artefact
# was written, so the claim held only as far as somebody had run the suite.
#
#   X1   wacc, compiled by the binary
#   X2   wacc, compiled by a binary containing X1
#
# X1 and X2 must be identical. A difference means the compiler changes its own output when it
# compiles itself, so every later artefact is built by something nobody checked and the difference
# surfaces later as something else entirely. `packages/wacc/test/wac/selfhostemit_test.wac` asserts the
# same thing and is a test; this is the claim made by the command that produces the thing.
#
# ## Two ways to get this comparison wrong, both of which I did first
#
# **The output name is in the module.** Building the same sources to `-o B` and to `-o C` with one
# compiler gives two files of equal length differing in exactly one byte. So the two stages are
# written to the same basename in different directories; comparing across different names always
# fails and says nothing.
#
# **The Deno path and the binary path are different pipelines.** `packages/platform/native.ts` and
# `wac build` do not emit byte-identical artefacts from identical sources — 18 bytes apart when I
# measured it — so comparing one against the other measures the two toolchains rather than the
# compiler's fixpoint. Both stages here come from the binary; `--bootstrap` only supplies the *first*
# seed and is then out of the comparison.
#
# ## Why the old seed is put back on a mismatch
#
# X2 is by definition what a binary *containing X1* produces, so X1 has to be installed and
# `cargo build` run before X2 exists at all. By the time we know, the working seed is already
# replaced. Leaving a rejected compiler in place would mean the next `wac build` in this checkout
# silently uses it.
set -euo pipefail

cd "$(dirname "$0")/.."

BIN=./native/v8/target/release/wac
ENTRY=packages/wacc/example/wacc.wac
SEED=native/v8/seed

bootstrap=0
[ "${1:-}" = "--bootstrap" ] && bootstrap=1

if [ "$bootstrap" -eq 0 ] && [ ! -x "$BIN" ]; then
  echo "no \`wac\` binary at $BIN, so there is nothing to build the compiler with." >&2
  echo "  A fresh clone has none — the seed is gitignored. Use the Deno path once:" >&2
  echo "    deno task seed:bootstrap" >&2
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/1" "$SEED"

# Keep whatever was working, so a mismatch does not leave this checkout worse than it found it.
had_seed=0
if [ -f "$SEED/wacc.wasm" ]; then
  had_seed=1
  mkdir -p "$tmp/prev"
  cp "$SEED/wacc.wasm" "$tmp/prev/wacc.wasm"
  cp "$SEED/wacc.json" "$tmp/prev/wacc.json"
fi

install_seed() {   # $1 is a directory holding wacc.wasm and wacc.json
  cp "$1/wacc.wasm" "$SEED/wacc.wasm"
  cp "$1/wacc.json" "$SEED/wacc.json"
  (cd native/v8 && cargo build --release >/dev/null 2>&1)
}

# **The first seed, when there is no binary to make one.** Deno's output is not compared with
# anything: it exists so the binary can be built at all, and the fixpoint below is between two
# artefacts the binary produced.
if [ "$bootstrap" -eq 1 ]; then
  mkdir -p "$tmp/0"
  deno run --allow-read --allow-write --allow-env --allow-run \
    packages/platform/native.ts "$ENTRY" --allow-read --allow-write -o "$tmp/0/wacc" >/dev/null
  install_seed "$tmp/0"
fi

# **Iterated to a fixed point, not checked after one round.** X1 is built by the binary we have; a
# binary containing X1 builds X2; and so on until two rounds agree.
#
# One round is not enough and demanding it was wrong. A change to what the *emitter emits* — say,
# trap messages — is not in X1 at all, because X1 was built by a compiler that did not have it; it
# appears in X2, which a compiler that does have it produced. So X1 != X2 is the ordinary state
# after any emitter change, and the fixed point is X2. Requiring X1 == X2 refused every reseed
# after `825bdb24` added trap messages, restoring the old seed each time, which left the tree
# unable to pick up its own compiler — the check blocking the thing it exists to protect.
#
# What is still refused is a compiler that never settles: if `MAX_ROUNDS` passes without two in a
# row agreeing, that is wacc changing its own output indefinitely and the previous seed goes back.
# The rule, as sequences of successive artefacts — checked against the loop below:
#
#     a a a a   converged after 1 round    nothing changed
#     a b b b   converged after 2 rounds   one emitter change, which is this commit's case
#     a b c c   converged after 3 rounds   two chained emitter changes
#     a b c d   never settles              refused
#     a b a b   never settles              refused, and an oscillation is the worst case there is
#
# Four is enough for two chained changes and still catches an oscillation. Raising it would admit
# a compiler that takes longer to settle than anyone can reason about, which is not a compiler
# anybody should publish.
MAX_ROUNDS=4

"$BIN" build "$ENTRY" --allow-read --allow-write -o "$tmp/1/wacc" >/dev/null
install_seed "$tmp/1"

converged=0
for n in $(seq 2 "$MAX_ROUNDS"); do
  mkdir -p "$tmp/$n"
  "$BIN" build "$ENTRY" --allow-read --allow-write -o "$tmp/$n/wacc" >/dev/null
  if cmp -s "$tmp/$((n - 1))/wacc.wasm" "$tmp/$n/wacc.wasm"; then
    converged=$n
    break
  fi
  install_seed "$tmp/$n"
done

if [ "$converged" -ne 0 ]; then
  rounds=$((converged - 1))
  echo "seed: $(stat -c %s "$SEED/wacc.wasm") bytes, and it is a fixed point after $rounds round(s)"
  exit 0
fi

echo "== the compiler never settles: not keeping it ==" >&2
echo "   $MAX_ROUNDS rounds of compiling wacc with a binary containing the previous round's wacc, from" >&2
echo "   the same sources and the same command, and no two consecutive rounds agree:" >&2
for n in $(seq 1 "$MAX_ROUNDS"); do
  [ -f "$tmp/$n/wacc.wasm" ] && echo "     X$n  $(stat -c %s "$tmp/$n/wacc.wasm") bytes" >&2
done
echo "   So every later artefact is built by something nobody has checked." >&2
echo "   \`wac test --allow-read --allow-write --allow-run packages/wacc/test/wac/selfhostemit_test.wac\` is the same claim with the stages named." >&2

if [ "$had_seed" -eq 1 ]; then
  echo "   Putting the previous seed back, because the rejected ones are already installed by now." >&2
  install_seed "$tmp/prev"
else
  echo "   There was no previous seed to restore; the rejected one is still in $SEED." >&2
fi
exit 1
