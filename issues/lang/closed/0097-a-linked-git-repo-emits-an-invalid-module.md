# 0097 — wacc emits an invalid module for `packages/git/src/repo.wac`

- **Status:** closed — fixed 2026-08-11 by agent-b
- **Fixed in:** the commit adding `spec/cases/0096`
- **Claimed by:** agent-b, 2026-08-11
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

## Fixed — 2026-08-11, agent-b

**A struct field whose type is a renamed import resolved to nothing, and fell back to `i32`.**

    import { Fs as FsType } from "../../fs/src/fs.wac";
    export struct Repo { FsType fs; … }        // field 0 emitted as i32

`Repo`'s type came out `struct(4) [i32, …]` while the constructor pushed the real reference, which is
the `struct.new[0] expected type i32, found local.get of type (ref null 35)` in the report — type 35
being `Fs` itself. Nothing to do with `hexOf`: the offset landed inside `openRepo`, and
`namesFiles` had named the wrong function, which is worth knowing on its own.

The cause is *when*, not *how*. `collectDeclarations` resolved each field's written type as it walked,
and a name from another file cannot be resolved until that file has been walked — which is exactly
the reason the parent chain has kept `structParentToks` and resolved it in a second pass since it was
written. Fields now do the same: the `Ty` is kept and re-resolved once every declaration exists.
`spec/cases/0096`, and two more corpus files emit whole (343 → 345).

**A second defect surfaced behind it**, in the checker rather than the emitter, and is fixed here too
— see `issues/lang/0098`: `checkFiles` sized every table from the *entry file's* token count while
filling them from the whole closure, so a small file with large imports silently ran out of room.
`sh.wac` is a hundred lines and imports `exec.wac`, so `Shell`'s later fields were never registered
and `sh.externalSpawnable = true` came back as *no such field*. Mutation recall over the repository
went from 95% to 98% when the tables got big enough to hold what they are given.
