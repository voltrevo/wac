# 0320a — grammar.md is behind the implementation again, in four places

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
