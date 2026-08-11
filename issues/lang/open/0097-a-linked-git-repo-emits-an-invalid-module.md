# 0097 — wacc emits an invalid module for `packages/git/src/repo.wac`

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-11
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```
deno test -A packages/wacc/test/corpusEmit.test.ts
    rung 4 corpus: 352 files — 343 whole, 8 partial, 1 invalid
```

The one is `packages/git/src/repo.wac`, and the engine says:

```
WebAssembly.Module(): Compiling function #0 failed:
  struct.new[0] expected type i32, found local.get of type (ref null 35)
```

`#0` is the first *defined* function, which `namesFiles` calls `hexOf`:

```wac
string hexOf(u8[] name) { return string.fromBytes(encode(name)); }
```

## What is already ruled out

- **Not the import section.** The emitter at `6924c429`, before imports existed, produces the same
  invalid module with the same message at function `#0`. (With imports the same body is `#3`, three
  callback dispatchers along.)
- **Not `hexOf` on its own.** `string.fromBytes(<call>)` — with the callee imported, local, or the
  array written inline — emits and runs correctly in a two-file reduction.
- **Not the `Opened` name collision.** `repo.wac` declares `RepoAt.Opened` while `pack.wac` declares
  `enum Opened`, which *was* a real defect on the checker side and is fixed (`spec/cases/0095`).
  Reducing it on the emitter side — an imported enum matched in a file that declares a variant of the
  enum's name — emits a valid module that answers correctly.

So the body at index 0 is being compiled against a signature or a struct layout that belongs to some
*other* function, and the reduction has to come from the linked whole rather than from the one line
`hexOf` is. The likely next step is to bisect `repo.wac`'s imports: it pulls from `bytes`,
`platform`, `fs`, `codec`, `pack` and `object`, and the closure is where a wrong index would come
from.

## Notes

**This is new code meeting an old bug**, not a regression: `repo.wac` was rewritten in `a914f7e3`
(`packages/git`, design/system/0005 step 5) and the corpus grew to 352 files with it. Nothing in the
emitter changed under it.

It makes `corpusEmit` red for everyone, which is why it is filed rather than left in a report. The
invariant that test asserts is worth keeping exactly as it is — *a function the walk approves must
produce a module that validates* — so the fix is to find the wrong index, not to widen the test.
