# 0161 — an aliased import of an already-imported type is a *different* type in wacc

- **Status:** open — the variant half is fixed (2026-08-20); the two-imports half is not
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

## Half of this was a narrower bug, and it is fixed — 2026-08-20

The reproduction above needs two imports and a call. Reducing it found a **smaller and different**
failure underneath, which the filed one was hiding:

```wac
import { E as E2 } from "./lib.wac";
export i32 f() { E2 e = E2.A; return 1; }
```

    wacc:      error: no variant of that name
    reference: OK

One aliased import, no second name, no call — and `E2` works perfectly as a parameter type in the same
program, which is the confusing pair of facts. `check.wac`'s enum walk does

```wac
c.declareEnum(c.renamed(tokenText(c, nameTok)), etps);        // under the alias
...
c.declareVariant(tokenText(c, nameTok), vname, arity);        // under the original  ← seventeen lines below
```

so the enum was registered as `E2` and its variants as belonging to `E`. `declareVariant` was the one
call in that walk not wrapped in `c.renamed`. Fixed by wrapping it.

`packages/wacc/test/wac/aliasimport_test.wac` pins it, with a canary — `E2.Nope` must stay refused, or a
fix that simply stopped checking variant names would pass. Canaried by reverting: the first test fails
with three diagnostics, the canary still passes.

Not in `spec/cases`, because it takes two files and a single-file runner has no `lib.wac` — and an import
naming a file nobody supplied is not refused by this checker anyway, which is `issues/lang/0157`.

## What is left, and it is narrower than the title

The original program still fails, with the original message:

```wac
import { E } from "./lib.wac";
import { E as E2 } from "./lib.wac";
i32 take(E2 e) { … }
export i32 run() { E e = E.A; return take(e); }
```

    error: argument does not match the parameter's type

Two *different* local names for one declaration are two declared enums as far as the checker is
concerned, so `assignable("E2", "E")` is false. The `renamed` table maps a declared name to the local
one; with two imports of the same file there are two local names for one declaration and nothing records
that they are the same. That is a real change to how identity is keyed, not another missing `c.renamed`.

Worth saying that this half is the *rarer* pattern — importing one name twice, once aliased — and the
half now fixed is the common one.

**Measured, since this widens what the checker rejects:** 221 of 221 cases, 53 typecheck cases, the
generated sweep clean, specEmit 419/419 with 258 of 279 whole, and crypto, std/platform, box and wacc's
own example all still check.