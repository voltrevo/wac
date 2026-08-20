# 0161 — an aliased import of an already-imported type is a *different* type in wacc

- **Status:** open — the variant half is fixed (2026-08-20); the two-imports half is not
- **Claimed by:** agent-a, 2026-08-20 — step 1 below (making `renamed` a relation)
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
## The mechanism, and it is worse than a type mismatch — agent-a, 2026-08-20

**The plain name silently stops being declared at all.** `C.renamed` is a *function* from the
declaring file's name to the importing file's — one entry, one answer — and `declareModule` registers
each declaration under `c.renamed(name)`. `api.wac:1200` adds an entry only when the alias differs
from the name, so `import { E, E as E2 }` records exactly `E → E2`, the enum is declared under `E2`,
and **nothing is declared under `E`**. An undeclared type is `typeNone()`, and unknown means silent
everywhere in this checker.

Measured, `E` and `E2` both from one `import { E, E as E2 }`:

| program | result |
|---|---|
| `E2 e = E2.Nope;` | refused — *no variant of that name* |
| `E e = E.Nope;` | **accepted** |
| `E e = E.Nope;` with the plain import *alone* | refused |

So the reported symptom — an argument mismatch at the call — is downstream. The name the programmer
wrote plainly is not a type, and every rule about it goes quiet.

### It is not only types, and it was live in the tree

The same registration path declares functions (`declareFunc(c.renamed(…))`), so a function imported
plainly and aliased loses its plain name too — and a call to an unknown function is silent:

| program (`export i32 add(i32 a, i32 b)` in lib.wac) | result |
|---|---|
| `import { add }` … `add(1)` | refused — *wrong number of arguments* |
| `import { add, add as plus }` … `plus(1)` | refused |
| `import { add, add as plus }` … `add(1)` | **accepted** |

`packages/ssh/test/wac/probe.wac` was doing exactly that: `disconnect` and `openFailure` imported
from `../../src/server.wac` both plainly and as `srvDisconnect`/`srvOpenFailure`, with all four names
used. Two call sites in a green package had no arity or argument checking at all. Fixed in this commit
by dropping the redundant plain imports — the file's own convention is the `srv*` prefix
(`srvClose`, `srvData`, `srvEof`, `srvChanFailure`, `srvHash`), so the plain names were the anomaly.

`tools/wac/importtwice_test.wac` now refuses the shape tree-wide, and it is canaried against the real
case rather than only a synthetic one: with `probe.wac` reverted it reports both names and the file and
line, and with the fix it is green. Two instances in 700-odd files, so the tree has no appetite for
this and the guard costs nothing.

*(The scan behind that guard first reported **138** double imports, from matching the six letters of
`import` anywhere — inside `important`, inside strings holding programs, and inside
`packages/wacc/example/wacc.wac` where the quote pairing then read `""` as a module path. Requiring
the word at the start of a line with `{` after it is the whole fix. Third time this class of mistake
has cost a wrong count today — see `issues/system/0220`.)*

### What the fix needs

Registering under every local name is right for functions, consts and variants — they are keyed by
name and two entries are harmless. It is **wrong for a struct or an enum**, where two names must
collapse to one type string or `take(E2)` still refuses an `E`. So:

1. `renamed` becomes a relation — `renamedAll(n)` — and `api.wac:1200` records the identity entry too
   when a name is imported more than once from one path. Fixes functions, consts and variants, and
   makes `E` a declared type again so the silence ends.
2. For types, one of the names has to be canonical and the other resolved to it *in the importing
   file* — which needs a table that outlives `api.wac:1273`, where `renameCount` is reset before the
   entry is checked. `typeOfTy` is the single funnel for type names, so that is one place; `is` and a
   qualified `E2.A` want checking separately.

Step 1 alone is worth doing and strictly reduces silence. Step 2 is what closes this issue.
