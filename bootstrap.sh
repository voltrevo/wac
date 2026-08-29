#!/bin/sh
# Build wac from source, and install it.
#
#     ./bootstrap.sh                          # native, installs into $WAC_HOME
#     ./bootstrap.sh --no-install             # ...leaving it in the tree, which is what a reseed wants
#     ./bootstrap.sh --host wasmtime          # ...on the engine with no JavaScript in it
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

host=v8
out=
profile=1
install=1

usage() {
  cat >&2 <<'USAGE'
usage: bootstrap.sh [--host v8|wasmtime|deno|nodejs] [-o PATH] [--no-profile]

  --host v8       a native binary on V8; needs cargo and a C++ toolchain  (default)
  --host wasmtime the same command on wasmtime — the host with no JavaScript in it,
                  which is what design/system/0001 D9 calls the portability proof.
                  Slower on compiler-shaped work: about 1.9x, measured 2026-08-28.
  --host deno     a single JavaScript file with a shebang; needs deno
  --host nodejs   the same, run by node
  -o PATH         write the command to PATH and install nothing
  --no-install    build it in the tree and stop — this is a reseed, and is what
                  `wac task seed` runs after a change to `packages/wacc/src`
  --no-profile    install, but leave every shell profile alone

Every host produces the same `wac`, because the command is `packages/wac/src/wac.wac` —
a wac program the host carries. What differs is the engine underneath it.

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
    --no-install) install=0; shift ;;
    -h|--help) usage ;;
    *) echo "bootstrap.sh: unknown argument '$1'" >&2; usage ;;
  esac
done

case "$host" in
  v8|wasmtime|deno|nodejs) ;;
  # **`rust` named the wrong thing and is refused rather than aliased.** Both native hosts are
  # Rust; what tells them apart is the engine, which is what a reader is choosing between.
  rust) echo "bootstrap.sh: --host rust is now --host v8 (both native hosts are Rust; the engine is what differs)" >&2; exit 2 ;;
  *) echo "bootstrap.sh: --host must be v8, wasmtime, deno or nodejs, not '$host'" >&2; exit 2 ;;
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
    v8)
      have cargo || die "--host v8 needs cargo.
    Install Rust from https://rustup.rs, or use --host deno / --host nodejs, which need neither
    cargo nor a C++ toolchain."
      have cc || have gcc || have clang || die "--host v8 needs a C++ toolchain to build V8.
    On Debian or Ubuntu: sudo apt install build-essential
    Or use --host deno / --host nodejs, which need neither."
      ;;
    wasmtime)
      # No C++ toolchain: wasmtime is Rust the whole way down, which is the one thing this host is
      # cheaper to build than the V8 one.
      have cargo || die "--host wasmtime needs cargo.
    Install Rust from https://rustup.rs, or use --host deno / --host nodejs, which need neither."
      ;;
    deno)
      have deno || die "--host deno needs deno.
    Install it from https://deno.land, or use --host v8 / --host nodejs."
      ;;
    nodejs)
      have node || die "--host nodejs needs node.
    Node 22 or newer, for wasm GC. Install it from https://nodejs.org, or use --host v8."
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
# The profile only matters when something is going to be installed into it.
if [ -z "$out" ] && [ "$install" -eq 1 ]; then need_profile; fi

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
GRANTS="--allow-read --allow-write --allow-env --allow-net"

# **One seed, both native hosts.** The payload is `packages/wac/src/wac.wac` compiled by wacc — a
# wac program — so the engine underneath it is the only difference between the two binaries. Each
# crate embeds the module from its own `seed/` at build time, and they are handed the same bytes.
build_native() {
  crate=$1                                   # native/v8 or native
  seed="$crate/seed/wacc.wasm"

  say "building the ladder"
  ( cd bootstrap/rust-ladder && cargo build --release --quiet )

  say "building the wac command with it"
  mkdir -p "$(dirname "$seed")"
  # One invocation: the ladder builds wacc from source, then drives that wacc to compile the
  # command, and writes the manifest section the native host reads back out.
  "$LADDER" packages/wacc/src/api.wac --with-wacc packages/wac/src/wac.wac $GRANTS -o "$seed"

  say "building the binary that carries it"
  ( cd "$crate" && cargo build --release --quiet )
  built="$crate/target/release/wac"
}

# **How a moved seed becomes a new command**, which differs by host and is the only thing the
# fixed-point loop below needs to know about one. A native host relinks the crate that carries the
# module; a JavaScript host has no crate and assembles the single file again.
relink() {
  ( cd "$crate" && cargo build --release --quiet )
}

build_js() {
  runner=$1
  if [ "$runner" != deno ]; then
    # The Node target is a different three bundles, not the same three run by `node`: its worker
    # entry is `entryNode.ts`, its launcher is `runLauncherNode`, and it reaches `node:worker_threads`
    # and `node:fs/promises` where this one reaches `Deno.*` directly. `packages/platform/build.ts`
    # has all of it. Writing it here without running it would be worse than saying so.
    die "--host nodejs cannot finish yet: the Deno target is done and this one needs its own
    launcher, worker and child entries. See design/system/0009. Use --host deno or --host v8."
  fi

  work="$(mktemp -d)"
  cleanup="$work"

  # **The bundler, built by the ladder from source.** This is what the whole design turns on:
  # `packages/ts` is written in wac, so the thing that turns TypeScript into JavaScript is built by
  # the same five rungs that build the compiler, and nothing here needs npm or a network.
  say "building the bundler with the ladder"
  deno run -A --no-check bootstrap/hosts/deno.js packages/wacc/src/api.wac \
    --with-wacc packages/ts/src/transform.wac -o "$work/transform.wasm" \
    || die "the ladder could not build packages/ts"

  # The command, and — since `drv_bindgen` — the binding layer that makes the module callable.
  # `build.ts` gets the second from `waccArtifacts`; this path had no way to ask for it, which is
  # why `--host deno` could build a module and not a command.
  say "building the wac command with deno"
  deno run -A --no-check bootstrap/hosts/deno.js packages/wacc/src/api.wac \
    --with-wacc packages/wac/src/wac.wac $GRANTS -o "$work/wacc.wasm" --glue "$work/app.gen.js" \
    || die "the ladder could not build the wac command"

  seed="$work/wacc.wasm"
  transform="$work/transform.wasm"
  built="$work/wac"
  assemble_js || die "the command would not assemble"
}

# The grants `$GRANTS` names, as the record the launcher is handed. One list spelled twice — the
# shebang wants flags and `runLauncher` wants an object — so this derives the second from the first
# rather than letting them drift.
grantsJson() {
  r=false; w=false; n=false; e=false; u=false
  case "$GRANTS" in *--allow-read*)  r=true ;; esac
  case "$GRANTS" in *--allow-write*) w=true ;; esac
  case "$GRANTS" in *--allow-net*)   n=true ;; esac
  case "$GRANTS" in *--allow-env*)   e=true ;; esac
  case "$GRANTS" in *--allow-run*)   u=true ;; esac
  printf '{"read":%s,"write":%s,"net":%s,"env":%s,"run":%s}' "$r" "$w" "$n" "$e" "$u"
}

assemble_js() {
  rm -rf "$work/asm"
  deno run -A --no-check bootstrap/js/assembleCommand.js \
    "$work/asm" "$transform" "$work/app.gen.js" "$built" "$(grantsJson)"
}

case "$host" in
  v8)       build_native native/v8 ;;
  wasmtime) build_native native ;;
  deno)
    build_js deno
    # **No crate to relink, so a moved seed becomes a command by being assembled again** — and the
    # glue is regenerated first, because it describes the module's exports and the module has just
    # moved. `bindgen --js` is the command's own: from here the fixed point is checked with the
    # thing being checked, exactly as the native path does.
    relink() {
      "$built" bindgen --js packages/wac/src/wac.wac "$work/app.gen.js" >/dev/null \
        && assemble_js
    }
    ;;
  nodejs) build_js node ;;
esac

# ---------------------------------------------------------------- check, then install
#
# **Not optional, and there is no flag to skip it.** Installing a compiler that is subtly wrong is
# the worst outcome available here; the check costs about a second and this is the one moment when
# both rounds are in hand.

# **The fixed point, iterated — not one round.** The command this binary carries was compiled by a
# wacc the ladder built. Using it to compile the command again should give the same bytes, and when
# it does not the honest response is another round rather than a failure: a change to what the
# *emitter emits* is not in round 1 at all, because round 1 was built by a compiler that did not
# have it. It appears in round 2, which a compiler that does have it produced. Demanding agreement
# after one round refuses every legitimate emitter change.
#
# What is still refused is a compiler that never settles. That is a compiler whose output depends on
# which compiler built it, and every artefact after it would be built by something nobody checked.
#
# **This used to be the weaker claim** — "the compiler it built can read wacc's own source" — with a
# comment saying the real check needed a mode the Rust ladder did not have. It does not need one:
# the binary just built is a compiler, and asking it to rebuild its own payload is the whole test.
MAX_ROUNDS=4
rounds="$(mktemp -d)"
trap 'test -n "$cleanup" && rm -rf "$cleanup"; rm -rf "$rounds"' EXIT INT TERM

# **Every round writes `wacc.wasm`, and the directory is what differs.** The manifest section
# records the name the module was built as, so two builds of one source to two names are never
# byte-identical — comparing `r1.wasm` against `seed/wacc.wasm` reports "never settles" for a
# compiler that settled on the first round. The artefact has to be spelled the same each time for
# the comparison to be about the compiler.
converged=0
n=1
prev="$seed"
while [ "$n" -le "$MAX_ROUNDS" ]; do
  say "fixed point, round $n of at most $MAX_ROUNDS"
  mkdir -p "$rounds/$n"
  # The cache is off: two rounds ask the same question, and a hit would compare an artefact with a
  # copy of itself and agree every time.
  WAC_BUILD_CACHE_KEEP=0 "$built" build packages/wac/src/wac.wac $GRANTS -o "$rounds/$n/wacc" >/dev/null \
    || die "the compiler it built cannot rebuild its own command — refusing to install it"
  if cmp -s "$prev" "$rounds/$n/wacc.wasm"; then converged=$n; break; fi
  cp "$rounds/$n/wacc.wasm" "$seed"
  relink || die "the seed moved but the command would not rebuild — refusing to install it"
  prev="$rounds/$n/wacc.wasm"
  n=$((n + 1))
done

if [ "$converged" -eq 0 ]; then
  echo "bootstrap: the compiler never settles — $MAX_ROUNDS rounds from the same sources and no two" >&2
  echo "    consecutive ones agree, so every artefact after it would be built by something nobody" >&2
  echo "    has checked. Nothing is installed." >&2
  exit 1
fi
say "it is a fixed point after $converged round(s), $(wc -c < "$seed") bytes"

if [ "$install" -eq 0 ]; then
  say "built $built — not installed"
  exit 0
fi

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
