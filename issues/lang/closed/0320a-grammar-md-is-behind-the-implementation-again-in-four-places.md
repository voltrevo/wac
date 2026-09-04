# 0320a — grammar.md is behind the implementation again, in four places

- **Status:** closed
- **Fixed in:** this commit (agent-a)
- **Fixed by:** agent-a, 2026-09-04
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** bug
- **Symptom:** not implemented — the spec is wrong, not the compiler

`issues/lang/closed/0020` was this, on this file, in four places, closed 2026-07-31. The file's own
keyword block says the reason it has a guard: *"this block has drifted from the implementation three
times."* The guard covers the keyword list and nothing else, and the productions have drifted again.

Each is a one-line fix and they are grouped because they are one drift, exactly as `0020` grouped
its four.

| production | says | accepts |
|---|---|---|
| `func_decl` | `[ "export" ] , type , IDENT , "(" …` | `T first<T>(T[] xs)` — **type parameters**, documented at length in `generics.md` |
| `func_decl` | as above | `export async i32 f() { … }` — **`async`**, which parses and fails at emit with *a call to Pending* |
| `method_decl` | `[ "override" ] , type , IDENT , "(" …` | `U pick<U>(const this, U a)` — **type parameters**, and `generics.md` has a section for them |
| `primary_expr` | `IDENT , [ "." , IDENT ] , "(" , [ arg_list ] , ")"` | `zero<i32>()` — **written type arguments at a call**, `[§wacc-written-type-args]`, added 2026-08-27 |

All four measured against the current `wac`.

## Why it matters more than tidiness

`CONTRIBUTING` says the spec is the source of truth, and this is the file a parser would be written
from. I nearly wrote one: `vision/GRAMMAR.md` computes what a proposed syntax adds by diffing
against the *parser*, and had it diffed against this file instead it would have reported generic
functions, generic methods, `async` and written type arguments as new syntax somebody had invented.
Two of those four are load-bearing in code that exists.

The keyword guard is the precedent for what would stop it: something that compares a production
against what the parser accepts. `[§wac-grammar-keywords-h4mq7wn]` exists because the list drifted
three times, and the productions have now drifted twice.

## Fixed

Three productions, all measured against the current `wac` before and after:

- `func_decl` gains `[ "async" ]` and `[ type_params ]`
- `method_decl` gains `[ type_params ]`
- `primary_expr`'s call form gains `[ type_args ]`

**A fourth was written, removed, and put back**, which is the part worth recording — and the
removal was the mistake, not the writing.

The first draft gave `method_decl` an `[ "async" ]` by symmetry with `func_decl`. I removed it
because `struct S { async i32 f(this) { … } }` had answered `expected a type` when I measured it —
and **that measurement was taken against a stale seed.** `wac` carries a prebuilt compiler in
`native/v8/seed/wacc.wasm`, so the parser answering was the one from before three merged
`packages/wacc/src` commits. After `./bootstrap.sh --no-install` the same program parses and fails
at emit with *a call to Pending*, exactly as an `async` free function does. `method_decl` takes an
`async` and the production now says so.

Four of the five things measured in this issue were unaffected; the one that was not is the one I
re-measured in order to *undo* a correct change. A stale seed is not a broken build — everything
compiles and the answers are simply a few commits old, which reads as evidence.

The durable fix is done, in `packages/wacc/test/wac/specproductions_test.wac`, and it caught this on
its first run.
`[§wac-grammar-keywords-h4mq7wn]` guards the keyword list *because it drifted three times*, and the
productions had drifted twice. The new guard is that idea one level up: a table of probes, each a
program that settles whether the parser has a construct and the token that says whether the
production does, asserted in **both** directions — because a production that documents something
absent is the failure a reader meets as their own bug.
