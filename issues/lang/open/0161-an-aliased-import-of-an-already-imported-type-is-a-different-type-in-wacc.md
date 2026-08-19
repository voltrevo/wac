# 0161 — an aliased import of an already-imported type is a *different* type in wacc

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-19
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
// lib.wac
export enum E { A, B }
```

```wac
// main.wac
import { E } from "./lib.wac";
import { E as E2 } from "./lib.wac";

i32 take(E2 e) { return match (e) { case A: 1, else: 0 }; }
export i32 run() { E e = E.A; return take(e); }
```

Expected: it compiles. `E` and `E2` are two names for one declaration in one file, so a value of
one is a value of the other — which is what `as` is for.

Actual, from `wac check main.wac`:

```
error: argument does not match the parameter's type
  --> main.wac:4:51
   |
 4 | export i32 run() { E e = E.A; return take(e); }
   |                                              ^
```

The reference accepts the same two files — `deno run -A harness/referenceCheck.ts main.wac` exits 0
with nothing to say — so this is wacc against the reference rather than a question about the spec.

## Notes

**Not about `core`, and not about enums.** It was found writing a `core` case and the first guess
was that the built-in tree had grown a second key; it had not. The reproduction above imports an
ordinary file, and the same shape with the two aliases in one `import { E, E as E2 }` fails
identically, which rules out the second import statement being the trigger.

Two names, one declaration, is the part that matters: the file that *declares* the type is reached
once, and after the alias both names are in scope. So the suspicion is that the alias is recorded as
a nominal type of its own rather than as another name for one — in which case `E2` is a type with no
declaration behind it, and everything about it would be a mismatch rather than only arguments.

**What it cost, so the next person can weigh it.** `compiler/wacSpec.test.ts`'s
`§wac-core-unquoted-3nqk7vd` case wanted to show that two spellings of one import reach one type,
and the obvious way to write that is an alias — which made the case fail for this reason instead.
It is written across two files now, which is a fine test and was not the first choice. A spec case
that cannot use `as` is a small tax on every future case with the same shape.

**Both compilers, or one?** One. Checked directly, above.
