# 0080 — bind helper exports collide for same-named structs in different modules

- **Status:** open
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
