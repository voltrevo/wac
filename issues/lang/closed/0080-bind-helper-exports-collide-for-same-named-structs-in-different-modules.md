# 0080 — bind helper exports collide for same-named structs in different modules

- **Status:** closed, 2026-08-11 by agent-b
- **Fixed in:** 3e251655
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** voltrevo, on GitHub — [https://github.com/voltrevo/wac/issues/9](https://github.com/voltrevo/wac/issues/9)
- **Mirrored by:** agent-a
- **Date:** 2026-08-08
- **Kind:** bug
- **Symptom:** invalid wasm

Two structs with the same declared name in different modules compile — the core keeps module-scoped
type identity — but the bind helpers are named from the declaration alone, so `a.wac::S` and
`b.wac::S` both emit `$bind$s_S_new` and the module is invalid.

**Reproduced here:** `atoms/wac/wasmBuildBin.ts` builds helper names from `bindName(s.name)` at
`:1388`, `:2293` and `:2785`. Same family as **0076**, where two packages declaring a `Writer` made an
untouched function fail to compile because the emitter kept whichever registered first.

Worth knowing for whoever fixes it: **wac-mono's native runtime reads those names as data.** Its
manifest keys a struct by `bind` — `packages/platform/native.ts`, and `native/src/manifest.rs` looks
one up by it — so a collision there is not only invalid wasm, it is two different structs answering to
one name in a host that has no other way to tell them apart. A fix that makes the name module-scoped
is the one that helps; a fix that appends a counter would leave the manifest ambiguous in a new way.

## Resolution

The reproduction is `spec/cases/0117` — an `S` in two files, both crossing the boundary — and the
engine's answer to it was *"Duplicate export name '$bind$s_S_new' for function 22 and function 25"*.

A bind name that more than one struct wants is qualified by the declaring file now, and **for all of
them**: `S__a` and `S__b`, rather than leaving the bare name with whichever was met first. That is
the part that matters for the manifest this issue warned about — the name stays a property of the
struct instead of a property of declaration order, so a host looking one up gets the same answer
whatever else the program contains. A program with no collision is unchanged, byte for byte, and the
helpers, the methods and the metadata the glue and the manifest read all take the same key, so they
cannot drift.

**What this does not fix, filed as `issues/lang/0100`:**

* `wacBindgen` writes `export class S` twice for that program, because a class is named from what
  the author wrote.
* Worse, and the reason the class name was not simply made unique here: an exported signature says
  `S` for both, so bindgen's own table is keyed by a name two structs answer to. Making the file
  compile without fixing the metadata would wire one function to the other's class — a silent wrong
  answer in place of a loud error.
* wacc disambiguates with a counter (`$bind$s_S@2_new`) where the reference now uses the file, so
  the two disagree about what a host should call these — and a counter is the ambiguity this issue
  said to avoid.
