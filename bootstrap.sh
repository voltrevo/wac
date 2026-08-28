#!/bin/sh
# Build wac from source, and install it.
#
#     ./bootstrap.sh                          # native, installs into $WAC_HOME
#     ./bootstrap.sh --host deno              # ...hosted by Deno instead
#     ./bootstrap.sh -o ./wac                 # ...or just build one, installing nothing
#     curl -fsSL <url>/bootstrap.sh | sh      # ...with no clone at all
#
# **There is no seed.** The compiler is built from source by a ladder of five rungs, the lowest of
# which is hand-written wasm assembly text. Nothing here unpacks a wasm binary that somebody
# compiled once and checked in — that is the whole reason this script exists.
#
# **`sh`, not `bash`.** It runs on whatever a fresh machine has.
#
# **It never reads stdin.** Piped from curl, stdin *is* this script, so every decision comes from a
# flag and every failure is an error rather than a prompt.

set -eu

# ---------------------------------------------------------------- arguments

host=rust
out=
profile=1

usage() {
  cat >&2 <<'USAGE'
usage: bootstrap.sh [--host rust|deno|nodejs] [-o PATH] [--no-profile]

  --host rust     a native binary; needs cargo and a C++ toolchain   (default)
  --host deno     a single JavaScript file with a shebang; needs deno
  --host nodejs   the same, run by node
  -o PATH         write the command to PATH and install nothing
  --no-profile    install, but leave every shell profile alone

Piped from curl, pass arguments after `-s --`:

    curl -fsSL <url>/bootstrap.sh | sh -s -- --host deno
USAGE
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --host) [ $# -ge 2 ] || usage; host="$2"; shift 2 ;;
    --host=*) host="${1#--host=}"; shift ;;
    -o) [ $# -ge 2 ] || usage; out="$2"; shift 2 ;;
    -o=*|--output=*) out="${1#*=}"; shift ;;
    --no-profile) profile=0; shift ;;
    -h|--help) usage ;;
    *) echo "bootstrap.sh: unknown argument '$1'" >&2; usage ;;
  esac
done

case "$host" in
  rust|deno|nodejs) ;;
  *) echo "bootstrap.sh: --host must be rust, deno or nodejs, not '$host'" >&2; exit 2 ;;
esac

# **Resolved before anything changes directory.** With no clone this script `cd`s into a temporary
# one, and a relative `-o` would then name a file inside a directory that is about to be deleted.
if [ -n "$out" ]; then
  case "$out" in
    /*) ;;
    *) out="$(pwd)/$out" ;;
  esac
fi

say()  { echo "bootstrap: $*" >&2; }
die()  { echo "bootstrap: $*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------- checks, before any work
#
# Every check that can fail is made here rather than where its answer is first needed. A build that
# takes minutes and then cannot write the profile has wasted the minutes; `wac task wac:install`
# used to abort *after* the binary, the cache and the environment file were in place, and reported
# failure over an installation that in fact worked.

need_host() {
  case "$host" in
    rust)
      have cargo || die "--host rust needs cargo.
    Install Rust from https://rustup.rs, or use --host deno / --host nodejs, which need neither
    cargo nor a C++ toolchain."
      have cc || have gcc || have clang || die "--host rust needs a C++ toolchain to build V8.
    On Debian or Ubuntu: sudo apt install build-essential
    Or use --host deno / --host nodejs, which need neither."
      ;;
    deno)
      have deno || die "--host deno needs deno.
    Install it from https://deno.land, or use --host rust / --host nodejs."
      ;;
    nodejs)
      have node || die "--host nodejs needs node.
    Node 22 or newer, for wasm GC. Install it from https://nodejs.org, or use --host rust."
      ;;
  esac
}

# The profile line is what puts the command on PATH. Checked now, written at the end.
profile_file() {
  if [ -n "${WAC_PROFILE:-}" ]; then echo "$WAC_PROFILE"; return; fi
  for f in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    [ -f "$f" ] && { echo "$f"; return; }
  done
  echo "$HOME/.profile"
}

need_profile() {
  [ "$profile" -eq 1 ] || return 0
  p="$(profile_file)"
  if [ -e "$p" ]; then
    [ -w "$p" ] || die "the shell profile $p is not writable.
    Fix its permissions, or pass --no-profile and put \$WAC_HOME/bin on PATH yourself."
  else
    d="$(dirname "$p")"
    [ -w "$d" ] || die "no shell profile exists and $d is not writable.
    Pass --no-profile and put \$WAC_HOME/bin on PATH yourself."
  fi
}

need_host
[ -n "$out" ] || need_profile

# ---------------------------------------------------------------- the source tree
#
# Run inside a clone, this uses it. Piped from curl there is no clone, so it makes one and removes
# it on the way out — including when the build fails, which is why the trap is set before the clone
# rather than after it.

cleanup=
trap 'test -n "$cleanup" && rm -rf "$cleanup"' EXIT INT TERM

if [ -f "bootstrap/boot/l1.l0" ] && [ -d "packages/wac/src" ]; then
  root="$(pwd)"
elif [ -f "$(dirname "$0")/bootstrap/boot/l1.l0" ]; then
  root="$(cd "$(dirname "$0")" && pwd)"
else
  have git || die "no wac clone here, and no git to make one.
    Install git, or clone https://github.com/voltrevo/wac yourself and run ./bootstrap.sh inside it."
  cleanup="$(mktemp -d)"
  say "no clone here — fetching one into $cleanup"
  git clone -q --depth 1 "${WAC_REPO:-https://github.com/voltrevo/wac.git}" "$cleanup/wac" \
    || die "could not clone the repository"
  root="$cleanup/wac"
fi

cd "$root"
say "building from $(git -C . rev-parse --short HEAD 2>/dev/null || echo 'a tree with no git') on $host"

# ---------------------------------------------------------------- the ladder
#
# Five rungs. The lowest is hand-written wasm assembly text; each compiles the next; the fifth
# compiles wacc, and wacc compiles the wac command. See `bootstrap/README.md`.

LADDER=bootstrap/rust-ladder/target/release/ladder
SEED=native/v8/seed/wacc.wasm
GRANTS="--allow-read --allow-write --allow-env --allow-net"

build_rust() {
  say "building the ladder"
  ( cd bootstrap/rust-ladder && cargo build --release --quiet )

  say "building the wac command with it"
  mkdir -p "$(dirname "$SEED")"
  # One invocation: the ladder builds wacc from source, then drives that wacc to compile the
  # command, and writes the manifest section the native host reads back out.
  "$LADDER" packages/wacc/src/api.wac --with-wacc packages/wac/src/wac.wac $GRANTS -o "$SEED"

  say "building the binary that carries it"
  ( cd native/v8 && cargo build --release --quiet )
  built=native/v8/target/release/wac
}

build_js() {
  runner=$1
  say "building the wac command with $runner"
  # The module is not the problem — `hosts/$runner.js --with-wacc` writes a wac command byte for
  # byte identical to the Rust host's. What is missing is the half that *runs* it: a JavaScript
  # file that instantiates the module and hands it its capabilities. That bridge is
  # `packages/platform/host/`, 8,521 lines of TypeScript, and it has to be plain JavaScript before
  # it can go in a single file without a bundler. See `bootstrap/MIGRATION.md`.
  die "--host $host cannot finish yet: it can build the module, but the platform bridge it needs to
    run is still TypeScript. Use --host rust." 
}

case "$host" in
  rust)   build_rust ;;
  deno)   build_js deno ;;
  nodejs) build_js node ;;
esac

# ---------------------------------------------------------------- check, then install
#
# **Not optional, and there is no flag to skip it.** Installing a compiler that is subtly wrong is
# the worst outcome available here; the check costs about a second and this is the one moment when
# both rounds are in hand.

# **What this checks, and what it does not.** The compiler inside the binary parses and type-checks
# wacc's own source — twenty-four files, the largest input there is — and reports no diagnostics. A
# compiler that cannot read the source it was built from is broken in a way worth catching before it
# goes on PATH, and it costs under a second.
#
# It is *not* the fixed-point check. That is `W1 == X1`: build wacc, use it to build wacc again, and
# compare the bytes. Doing it here needs a mode the Rust ladder does not have — `bootstrap/ts/
# selfhost.ts` does it through a driver, in TypeScript — so for now the suite makes that claim and
# this makes the weaker one. See `bootstrap/MIGRATION.md`.
say "checking the compiler it built can read wacc"
"$built" check packages/wacc/src/api.wac >/dev/null \
  || die "the compiler it built cannot read wacc's own source — refusing to install it"

if [ -n "$out" ]; then
  cp "$built" "$out"
  chmod +x "$out"
  say "wrote $out"
  exit 0
fi

if [ "$profile" -eq 1 ]; then
  "$built" self install --from "$built"
else
  "$built" self install --from "$built" --no-profile
fi
