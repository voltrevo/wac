# 0097 — a type named the same as one in `core` retypes every use of the `core` one

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b, reduced by agent-c
- **Date:** 2026-08-11
- **Kind:** bug
- **Symptom:** invalid wasm

## What it is

**Any type declared anywhere in the link whose name matches a type imported from `core` silently
replaces it.** `core` exports one type, `Read`, so today that is the only name it can happen to —
but it needs no cleverness to hit: one package naming a type `Read` retypes every `fn[Read()]` in
every *other* package, and the two need never import each other.

Three files, ten lines, and a control that differs by one identifier:

```wac
// obj.wac  — any of these four does it
export enum Object { Read(i32 kind, u8[] content) }   // a variant
// export enum Object { Read, Other }                 // a variant with no payload
// export struct Read { i32 kind; }                   // a struct
// export enum Read { A, B }                          // an enum
// export i32 Read() { return 1; }                    // a FUNCTION does not — it is not a type

// cli.wac
import { Read } from core;
export struct Cli {
  fn[Read()] readChunk;
  Cli of(fn[Read()] readChunk) { return Cli(readChunk); }
}

// main.wac — imports something from each; needs to use neither
import { Cli } from "./cli.wac";
import { Object } from "./obj.wac";
export i32 f() { return 1; }
```

```
WebAssembly.Module(): Compiling function #1 failed:
  struct.new[0] expected type (ref null 18), found local.get of type (ref null 5)
```

`Cli`'s field is declared to hold a function returning `Object`, and `of`'s parameter returns
`core`'s `Read`. Rename the variant and the same three files emit a module that validates, so the
control is one identifier wide.

## What it is not

Ruled out by probing the emitter directly, so the next person does not repeat them:

- **Not the variant table.** `Env.canonType` maps a variant to its enum and looked like the
  culprit; forcing it to answer `Read` for `Read`, and separately making `enumOf` refuse the name
  altogether, both leave the invalid module byte-for-byte the same. A struct or an enum *named*
  `Read` breaks it identically, and neither goes near that table.
- **Not import order.** Swapping which file the entry imports first changes the type indices and
  not the outcome — `core` is appended to the queue when an import of it is parsed, so it is
  concatenated last either way.
- **Not `packages/git`.** git is where it surfaced because `platform.wac` and `git/object.wac` meet
  in one link; the shape has nothing to do with either.

The remaining suspect is `Env.keyAt`, which resolves a used name to a declaration's key. Its second
branch is "the import that names it", which is exactly the rule that should make `import { Read }
from core;` win, and something about a capability import — whose `importTo` is the synthetic path
`" core"` rather than a file anyone can spell — makes it fall through to a later, permissive branch
instead. That branch is written to set `env.ambiguous` when two files declare a name, and it does
not fire here, so whatever it matches it believes is unique.

## Why the corpus is green anyway

`packages/git/src/object.wac`'s variant was renamed `Read` -> `Loaded` in the commit that added this
section, which unbreaks `corpusEmit`/`corpusMutate` for everyone. **That is a workaround and not a
fix** — the bug is untouched, `packages/box/src/lib/trset.wac` still declares a private
`struct Read` that has not collided yet only because nothing puts it in a link with an
`fn[Read()]`, and the next package to name a type `Read` gets the same invalid module with no
warning. The rename carries a comment pointing here so nobody quietly undoes it.

## Reproduction (as originally filed)

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
