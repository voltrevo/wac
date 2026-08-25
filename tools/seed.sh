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
# **The Deno path and the binary path agree — re-measured 2026-08-19.** This said they did not: that
# `packages/platform/native.ts` and `wac build` were "18 bytes apart when I measured it". They are
# byte-identical now, on `example/wc.wac` (233,661 bytes) and on `example/wacc.wac` (960,311), for both
# the module and the manifest beside it.
#
# The paragraph above is why the old number is not evidence of a pipeline difference: **the grants are
# in the module too**, exactly as the name is. Building `wc.wac` with two grants and with four, one
# compiler, gives files two bytes apart. So a comparison has to hold the name *and* the grants equal,
# and the 18 was either that or a state since fixed: the two derivations have drifted before, once
# over a trailing comma on the `net` line, and the test that caught it is retired now that only one
# of them produces anything.
#
# Both stages here still come from the binary; `--bootstrap` only supplies the *first* seed and is then
# out of the comparison. That is about the fixpoint, not about the other pipeline.
#
# ## Why the old seed is put back on a mismatch
#
# X2 is by definition what a binary *containing X1* produces, so X1 has to be installed and
# `cargo build` run before X2 exists at all. By the time we know, the working seed is already
# replaced. Leaving a rejected compiler in place would mean the next `wac build` in this checkout
# silently uses it.
set -euo pipefail

# **Cargo, checked first and named as what it is.** The seed is a wasm module the `wac` binary carries,
# so building it means building the binary — and `native/v8` is Rust. Without cargo the build below
# failed with status 127 after about six seconds, with its stderr sent to /dev/null and `set -e`
# aborting the script, so what an outsider saw was a command that stopped for no stated reason and
# looked like a hang. Reported from a fresh checkout by somebody following `docs/your-own-project.md`,
# which did not list cargo either. GitHub issue 21.
if ! command -v cargo >/dev/null 2>&1; then
  echo 'seed: cargo is not on PATH, and this needs it.' >&2
  echo '   The seed is a wasm module the wac binary carries, so building it means building the' >&2
  echo '   binary, and native/v8 is Rust. Install Rust — https://rustup.rs — and run this again.' >&2
  echo '   Nothing has been changed.' >&2
  exit 1
fi

# **And its failures are shown.** Both call sites were `cargo build --release >/dev/null 2>&1`, whose
# status `set -e` acted on and whose message nobody ever saw. A compiler toolchain that stops without
# saying why is worse than one that fails loudly: the seed is installed by this point, so the state to
# report is "the module is in place and the binary is not rebuilt from it".
# **Says which stage it is in, to stderr.** This printed one line at the end and nothing while it
# worked, so a bootstrap that takes minutes looked like a hang — which is exactly how a missing cargo
# was read. Their own suggestion 4. stderr, so stdout stays the one parseable line it was.
stage() { echo "seed: $*" >&2; }

# **Takes the crate**, because there are two and only one of them had an owner. `native/v8` is the
# `wac` binary and `native/` is `wacland`, the wasmtime host — separate crates sharing a path
# dependency on `native/manifest`. `issues/system/0208`.
cargoBuild() {
  local dir="${1:-native/v8}" what="${2:-the wac binary}" out
  if out=$(cd "$dir" && cargo build --release 2>&1); then
    return 0
  fi
  echo "seed: cargo build failed in $dir, so $what was not rebuilt." >&2
  if [ "$dir" = "native/v8" ]; then
    echo '   The seed module is installed; the binary beside it is older than it. Fix the build below' >&2
    echo '   and run this again — every `wac` command until then compiles with the previous compiler.' >&2
  else
    echo '   Nine test files run this binary and four more assume it is there; they skip with a' >&2
    echo '   reason until it builds. Nothing else is affected.' >&2
  fi
  printf '%s\n' "$out" | tail -25 >&2
  exit 1
}

# **The wasmtime host, built here because nothing else owned it.** Five test files each ran their own
# `cd native && cargo build --release`, in two languages, with five skip messages and two different
# freshness checks — `issues/system/0208`. They ask whether the binary is there and fresh now; this is
# what makes it so.
buildNativeHost() {
  stage "the wasmtime host (cargo build --release in native/)"
  cargoBuild native "the wasmtime host"
  echo "      wacland $(stat -c %s native/target/release/wacland) bytes"
}

cd "$(dirname "$0")/.."

BIN=./native/v8/target/release/wac
ENTRY=packages/wac/src/wac.wac
SH_ENTRY=packages/box/example/boxsh.wac
UPDATE_ENTRY=packages/wacpkg/src/fetch.wac
SEED=native/v8/seed

bootstrap=0
[ "${1:-}" = "--bootstrap" ] && bootstrap=1

# **`--native-only` for when you touched `native/` and nothing else.** The seed work below is about
# `native/v8` and takes about 34s; the host is a separate crate and rebuilding it needs none of that.
if [ "${1:-}" = "--native-only" ]; then
  buildNativeHost
  exit 0
fi

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
fi

# **One file per payload.** A `wacc.json` went beside the module until 2026-08-20 and `build.rs` never
# read it — `embed` takes `{dir}/{stem}.wasm` and nothing else — so the seed carried a copy of a
# manifest that is already a section inside the module next to it.
#
# Only `wacc.wasm` here, because this runs inside the fixpoint loop; `sh.wasm` and `update.wasm` are
# written once after it converges and are left alone by these builds.
install_seed() {   # $1 is a directory holding wacc.wasm
  cp "$1/wacc.wasm" "$SEED/wacc.wasm"
  cargoBuild
}

# **The other two payloads, and they are not optional here.**
#
# `native/v8/build.rs` embeds three, "each optional": the compiler answers `check`/`compile`/`build`,
# the shell answers `sh`, the fetcher answers `update`. Optional to the *build* is not optional to the
# command — `spec/cli/wac.md` lists all three without qualification — and this script wrote only the
# first until 2026-08-20. So the binary from the supported route (`deno task wac:install`) answered
# `unknown command 'sh'`, and `wac update` fell past the host into the compiler's usage line, which is
# what `packages/wacpkg`'s own mapped-import test then failed on. `issues/system/0216a`.
#
# Built *after* the fixpoint rather than inside it: these are ordinary programs, not the compiler, so
# they say nothing about whether wacc reproduces itself, and putting them in the loop would pay for
# two extra compiles a round. One `cargo build` follows them, because the loop's builds ran before
# these files existed.
#
# **The shell is built with everything.** `wac sh` narrows to what its own command line asks for and
# can never exceed what the payload carries, so the payload is the ceiling rather than the default —
# `tools/wac/sh_test.wac` is the pair of tests that says so. The fetcher gets the four its own header
# names; it clones over the network into `$WAC_HOME`.
payload() {   # $1 entry, $2 stem
  if ! "$BIN" build "$1" --allow-read --allow-write --allow-env --allow-net \
       -o "$tmp/p/$2" --quiet; then
    echo "seed: $1 did not build, so this \`wac\` would have no \`$2\` command." >&2
    echo "   The compiler is installed and is a fixed point, so \`wac build\`, \`run\`, \`test\` and" >&2
    echo "   \`check\` all work; what is missing is \`wac $2\`. Fix that entry and run this again." >&2
    return 1
  fi
  cp "$tmp/p/$2.wasm" "$SEED/$2.wasm"
}

# **The first seed, when there is no binary to make one.** Deno's output is not compared with
# anything: it exists so the binary can be built at all, and the fixpoint below is between two
# artefacts the binary produced.
if [ "$bootstrap" -eq 1 ]; then
  mkdir -p "$tmp/0"
  stage "bootstrapping: compiling wacc with the reference compiler (Deno, the slow one, once)"
  deno run --allow-read --allow-write --allow-env --allow-run \
    packages/platform/native.ts "$ENTRY" --allow-read --allow-write --allow-env -o "$tmp/0/wacc" >/dev/null
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

# **Put the previous seed back when a round's build fails, not only when the fixpoint is rejected.**
#
# Round 1's output is *installed* before round 2 runs — that is what makes the loop a fixpoint over
# artefacts the binary produced. So a compiler that builds once and then cannot build its own successor
# leaves itself installed, and `set -e` aborted here without undoing it: every later `wac build`,
# `run` and `test` in the checkout compiles with the broken compiler, and `deno task seed` cannot
# recover because it needs the seed to build the seed. The way out is `seed:bootstrap`, from the
# reference, which is minutes.
#
# Twice on 2026-08-20, both times from a probe that made wacc refuse a program it should not: an
# instrumented emitter that reported by failing the build, and two attempted fixes for
# `issues/lang/0173a` that emitted a module the engine rejects. Neither is an unusual thing to be
# doing — the fixpoint loop is exactly where a compiler change is meant to fail — so the recovery
# belongs here rather than in the next person's afternoon.
# **The rounds are built with the cache off, and the loop is why.**
#
# `wac build` remembers what it built (`issues/system/0204`), keyed on the compiler, the sources, the
# grants and the output's base name — and every round here shares all four, because each writes `wacc`
# into a directory of its own. In the steady state that is a hit: the seed is already the fixed point,
# so round 1 reproduces it, `install_seed` puts the same bytes back, `cargoBuild` produces a binary with
# the same embedded seed, and round 2's key is round 1's. The `cmp` below then compares round 1's
# artefact with a copy of itself and reports a fixed point it did not compute. Measured: `deno task
# seed` fell from 27.2 s to 12.2 s when the cache landed, and that fifteen seconds was this check.
#
# A *changed* compiler is still caught either way — round 1's output differs from the seed, so round 2
# runs a different compiler and misses — but "the compiler reproduces its own output" is exactly the
# claim a cache can answer without checking, so it is turned off rather than reasoned about.
#
# **The environment variable rather than `--no-cache`.** Round 1 runs the binary that is already
# installed, which may predate the flag; an unknown flag is refused and there would be no way to build
# the compiler that understands it. An unknown variable is ignored, so this spelling has no flag day.
buildRound() {   # $1 output dir
  if WAC_BUILD_CACHE_KEEP=0 "$BIN" build "$ENTRY" --allow-read --allow-write --allow-env -o "$1/wacc" >/dev/null; then
    return 0
  fi
  echo "== wacc cannot build itself with the seed just installed ==" >&2
  echo "   The build above failed, and the compiler that ran it is the one this script installed a" >&2
  echo "   round ago — so leaving it in place would make every later \`wac\` command in this checkout" >&2
  echo "   compile with it, and this script could not rebuild from it either." >&2
  if [ "$had_seed" -eq 1 ]; then
    echo "   Putting the previous seed back. Fix the failure above and run this again." >&2
    install_seed "$tmp/prev"
  else
    echo "   There was no previous seed to restore, so \`deno task seed:bootstrap\` is the way out:" >&2
    echo "   it builds wacc with the reference, which takes the broken one out of the loop." >&2
  fi
  exit 1
}

stage "round 1: compiling wacc with the seed we have"
buildRound "$tmp/1"
install_seed "$tmp/1"

converged=0
for n in $(seq 2 "$MAX_ROUNDS"); do
  mkdir -p "$tmp/$n"
  stage "round $n of at most $MAX_ROUNDS: compiling wacc with the previous round's wacc"
  buildRound "$tmp/$n"
  if cmp -s "$tmp/$((n - 1))/wacc.wasm" "$tmp/$n/wacc.wasm"; then
    converged=$n
    break
  fi
  install_seed "$tmp/$n"
done

if [ "$converged" -ne 0 ]; then
  rounds=$((converged - 1))
  mkdir -p "$tmp/p"
  stage "fixed point reached; building the other two payloads (wac sh, wac update)"
  payload "$SH_ENTRY" sh
  payload "$UPDATE_ENTRY" update
  stage "linking the binary (cargo build --release)"
  cargoBuild
  echo "seed: $(stat -c %s "$SEED/wacc.wasm") bytes, and it is a fixed point after $rounds round(s)"
  echo "      sh $(stat -c %s "$SEED/sh.wasm") bytes, update $(stat -c %s "$SEED/update.wasm") bytes"
  # **And the other binary — but only if it is already there.** Measured: `cargo build --release` in
  # `native/` is 7s of CPU and about 10s of wall with *nothing to do*, and this task runs after every
  # `packages/wacc` edit, for three agents. Paying that on every seed to keep a binary fresh that this
  # checkout may never run is the same waste `issues/system/0208` was filed about, one level up.
  #
  # So: refresh what exists, and let `deno task seed:native` be how it comes to exist. A checkout with
  # no `wacland` is not silently short of coverage — the six callers warn with the reason and name the
  # task, and `tools/seedFresh.test.ts` fails if the binary is present and stale.
  if [ -f native/target/release/wacland ]; then
    buildNativeHost
  else
    stage "no wasmtime host to refresh (\`deno task seed:native\` builds one)"
  fi
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
