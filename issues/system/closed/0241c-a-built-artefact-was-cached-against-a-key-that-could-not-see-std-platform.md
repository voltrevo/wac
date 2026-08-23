# 0241c — a built module was cached against a key that could not see `std/platform.wac`

- **Status:** closed
- **Fixed in:** `waccKeyParts` in `harness/buildCache.ts`, added to `compileKey`; and
  `packages/platform/native.ts` taking the boundary from the module's own compile
- **Reported by:** agent-c
- **Date:** 2026-08-23
- **Kind:** bug
- **Symptom:** wrong answer

`packages/platform/host/marshal.test.ts` failed with a module importing **65** host functions and a
manifest describing **63**:

    the manifest's callbacks are not the module's imports
      got:  [… "wac.cb62"]                     63
      want: [… "wac.cb62","wac.cb63","wac.cb64"]  65

A manifest that does not describe its own module is the one thing that test exists to catch, and it
caught it. What it was pointing at was a **stale cache**.

## The key could not see the change

`compileKey` in `harness/waccBuild.ts` keyed a compiled artefact on the entry, the roots, the walked
files' contents, and `compilerKeyParts()` — which hashes **`compiler/*.ts`, the reference compiler**.

Anything built by `wacc` also depends on `packages/wacc/src`, and on more than it looks: `coretext.wac`
there is the *generated embedding* of `std/platform.wac` and `core/*.wac`. Those are builtin specs,
served to a compile from that embedded text rather than from the filesystem — so they are in nobody's
walked-file list.

**So adding three fields to `Cli` changed no file the key could see.** The cache served a module
compiled against the old `Cli` while the manifest was written from the new one. The two extra imports
were from a `Pending<Loaded>`/`Pending<Called>` shape the capability had for about an hour earlier the
same day: each `Pending<T>` adds a resolve and a drop signature, so the stale module carried two
signatures the current source does not have — which is why the count was *higher* rather than lower,
and why "the emitter emits too many" was a plausible and wrong first reading.

`compileKey` now includes `waccKeyParts()`, which hashes `packages/wacc/src/*.wac`. Old entries are
unreachable rather than invalidated: the key gained parts, so nothing written before this can be
looked up.

## And a second producer of the same boundary, removed

Chasing it turned up something worth fixing on its own. `buildNative` asked `bindTypesFilesIn` for the
wire — **a second compile, with its own signature table** — while taking the module from
`waccArtifacts`. Two producers of one artefact, and the failure mode is exactly what was seen: a
manifest that does not match the module beside it.

`buildFilesIn` already answers the wasm and its metadata together — `issues/lang/0129` made that one
call for speed — so `WaccArtifacts` now hands back `wire` and `sigWire` from the compile that produced
the module, and `native.ts` uses them. The boundary is the module's own by construction.

`nativeWire` had no other caller and is gone.

## What it cost, and the lesson

An hour, and two wrong diagnoses before the right one:

- **"a bare struct return has no `C` line"** — false. `fn[Stat(i32)]` and `fn[Child(i32)]` are in the
  wire; they are `Pending`'s resolver signatures.
- **"the two emitters disagree about an uncalled field"** — false, and it looked true because
  `wac build` gave 63/63 for the same source. Both loops iterate one `env.cbSigs`; one compile cannot
  disagree with itself, and that should have been the tell.

The reading that would have got there first: **`wac build` and `buildNative` produced different
modules from the same source**, and the only way that happens is if one of them is not compiling.
A cache is the first thing to suspect when two producers of one artefact disagree and one of them is
supposed to be deterministic.

Same family as the `builtByDeno` staleness fixed the same day (`issues/system/0144`'s closing note):
a freshness check that watched `build.ts` and not the `host/` directory it bundles.
