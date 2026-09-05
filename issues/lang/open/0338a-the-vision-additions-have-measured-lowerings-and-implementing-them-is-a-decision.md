# 0338a — the vision additions have measured lowerings, and implementing them is a decision

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** design question
- **Symptom:** none — nothing is broken. This is a decision about whether to build something.

`vision/` proposes a set of additions to the language and its brief says *"nothing in vision
compiles"*. Over four days the constructs were costed against today's compiler, and the summary is
that **the lowerings are the easy part**: four of them have targets that compile and run, written
out in `vision/TECHNICAL.md`. What is missing is a parser and a pass, and both are changes to
`packages/wacc`, which is why this is an issue rather than a commit.

## What is established

Every target below was checked and run through `deno run -A bootstrap/ts/ask_wacc.ts`, zero parse
and zero type errors.

| addition | lowers to | evidence |
|---|---|---|
| `union<A, B> Name;` | an enum of one-field variants, `AsA(A v)` | runs; nested unions run; inside a generic `Result<T, E>` runs |
| `gen<T>` / `yield` | a struct with a resume tag and hoisted locals | runs, including a yield inside a **nested** loop |
| `try e` | a `match` with an early `Err` return | runs, both branches |
| `try for (T x in src)` | a `while` over a two-arm `Step`, `Done(Err)` returning | runs, both branches |
| a match arm without `case` | prepend `case` | token-level |
| unqualified `Ok(x)` | `Result.Ok(x)` | runs — a qualified variant construction on a generic enum checks clean |

`try await for`, which is the loop head in eleven vision files, is the third and fourth rows plus an
`await` in a loop body — and that last is already pinned by
`packages/wacc/test/wac/asyncplan_test.wac` at `ok suspends=1 hoist=3`.

## What is not established

- **`coroutine`** (one file), **a default type argument** (three), and **`never`** (two — and `never`
  is *"the enum with that arm deleted"*, which the `Step` lowering needs and nobody has written out).
- **Re-export**, `issues/lang/0073`, which blocks twenty files — **all of them barrels**, containing
  nothing but `export … from` lines. It blocks no program.
- **Injection**, which is the only genuinely new rule in the `union` lowering: a value of a member
  type, in a slot whose type is the union, is wrapped. It needs the slot's type, so it is a checker
  change rather than a syntactic one.

## Two shapes it could take, and one of them is ruled out

**A source-to-source desugarer is the wrong target.** The general `try` lowering nests the remainder
of its block inside the `Ok` arm — there is no uninitialised declaration to fall back on, `Foo x;`
being two parse errors — so a function with eight declaration-form `try`s lowers eight `match`es
deep. `vision/packages/datetime`'s `parse` has exactly eight, one per field of the grammar. Its
desugared source is unreadable, and every diagnostic, line number and stack frame a user would see
points into it.

**So it is a compiler pass over `wacc`'s AST**, and what that touches, in the order the work would
go:

1. `parse.wac` and `ast.wac` — the syntax and the nodes. `vision/GRAMMAR.ebnf` is the grammar as a
   patch over `spec/spec/grammar.md` and every one of the 104 files parses under it, so the shape is
   known; what it is not is a recursive-descent parser, which is the work.
2. A pass per lowering. Each is a page of `vision/TECHNICAL.md` with a target that has been run.
3. `check.wac` for injection, which is the one rule that needs types.

**The ladder constrains this in a way worth knowing before starting.** `packages/wacc` is compiled by
wac-L5, so wacc's *own source* cannot use anything wac-L5 has not got. Adding a construct to wacc
therefore makes it available to users and not to the compiler, until the ladder moves — which is
fine, and is the same position `async` was in, and is the reason a *self-hosted* rewrite of wacc in
the new syntax is a separate and much later question.

## Costed against the three compiler files, 2026-09-05 — and the parser is not where this is decided

Since this was filed, each of `packages/wacc`'s big three has been read for what the additions
actually cost it. The summary changes the shape of the work: **the parser is nearly free, the emitter
is entirely free, and the whole bill is one checker clause plus its sibling.**

**`parse.wac` — nine of ten constructs are one branch or less.**

| construct | what the parser gains |
|---|---|
| `union<A, B>` | **nothing** — `IDENT type_args` is already a type name |
| `T??` | nothing — the `?` suffix already loops |
| `fn<R(A)>` | one token, `[` to `<`, reusing the existing `splitGt` |
| `default:` for `else:` | one token |
| `try` / `defer` / `schedule` / `yield` | one branch each, in the statement or unary parser |
| a list literal `[a, b]` | one branch — a **leading** `[` is unused today |
| a brace pattern `X { a, b }:` | one alternative in the arm payload |
| `never` | nothing — a type name |
| **`?.`** | **one token of lookahead, and it is the only ambiguity** |

Two things I expected to pay for and do not: `fn<` does **not** reintroduce the `>>` problem, because
`splitGt` is already in the parser with the bug that bought it recorded at line 852 and 23 nested
generics in the tree; and `union<A, B>` needs no production at all. And the one construct that costs
the parser something — `?.`, which makes this grammar need two tokens where it needed one — has
**zero uses** across `vision/`'s 185 files.

**`emit.wac` — nine of ten never reach it.** A proposal reaches the emitter only if it changes what a
*value* is, and the additions change what a *program* looks like nine times and what a value is once.
That once is `union`, and the emitter has already priced it: an enum is one wasm struct, a tag plus a
slot per payload field of every variant, so `union<A, B>` is `{ i32 tag; ref A; ref B; }` with one
reference live. `never` is the empty union, which is a struct with a tag and no payload slots — one
type-section entry.

The bill the emitter had already written is worth re-reading in this light: *"the cost is space … that
is the trade a language with no unions makes anyway, and nothing here is measuring bytes yet."* The
excusing clause expires. Counted in `vision/`: **37 unions, 174 members, mean 4.7 and a maximum of
10** — `std`'s `FileFault`, `http`'s `RequestFault` and `mpt`'s `ProofFault` each have ten, so each is
a struct of a tag and ten reference slots with one live, allocated on every failure. **A union is the
first enum whose width is not under one author's control.** The lowering's decision to *nest* rather
than flatten bounds it at each level and was taken for an unrelated reason.

**`check.wac` — the whole bill, and it is smaller than filed above.** `assignable(C c, string want,
string got)` is shared by 26 call sites and already has five clauses: nullable widening both ways,
nullable-into-base, struct inheritance, a generic child into a parent, and a variant into its enum.
So injection is a **sixth clause on an existing relation**, not subtyping added to a language with
none.

And it is a **lookup, not a parse**. The worry that `Ty` is a string and a union comparison would mean
re-parsing `"union<A, B>"` is wrong twice: the AST has a `Ty` tree, and `typeOfTy` renders it to a
canonical name **on purpose** — *"a type is its canonical name … invariance then costs nothing"*. A
union is *declared*, exactly as a struct is, so the context can answer `c.unionMembers(name)`, which
is what four of the five existing clauses already do. One table, the same table structs have.

**The one genuinely new thing is that `try` needs a second function.** `try f()` inside a function
declaring `E2` is legal when the callee's `E1` is contained in `E2`, and when it is not the checker
has to say **which member** is missing:

    try: `parseProxy` can fail with `PortNotDigits`, which this function does not declare

`assignable` answers a `bool` and has never needed to say why not, because none of its five clauses
can fail *partially* — a `string` is not an `i32` and there is nothing to enumerate. A union is the
first relation in this language where refusal has a **witness**. So `Ty? missingFrom(c, want, got)`
beside `assignable`, with the law that one is null exactly when the other is true — which the language
cannot state, and which is the fifth such law in this exercise.

**Revised estimate of the work in step 3**, which this issue filed as *"`check.wac` for injection"*:
one clause that is a table lookup, one sibling function for the diagnostic, and one table populated
from declarations. The parser and emitter steps are smaller than filed; the checker step is one
function larger.

## The decision

Three answers, and the middle one is not obviously wrong:

1. **Do it.** The lowerings are measured, the grammar exists, and the payoff is that
   `vision/packages` stops being prose — 62 of 102 files become runnable once the barrels are
   dropped, and the arguments in this exercise become testable rather than argued.
2. **Do part of it.** `union` alone is a declaration form plus one coercion, eleven files declare one
   and fifteen use one in a type, and it is the addition with the highest ratio of use to
   implementation cost. Nothing else needs to follow it.
3. **Do none of it, and keep the directory as a design record.** Which is what the brief says today —
   *"nothing in vision compiles. Nothing walks it"* — and is defensible: the exercise's stated value
   is the list of things that could not be written, and that list is complete without an
   implementation.

What made this worth filing rather than continuing to measure: **the measuring is done**, and every
further tick spent on it produces a smaller correction than the last. The next useful thing is
somebody deciding, and the material to decide with is `vision/TECHNICAL.md` and
`vision/GRAMMAR.md`'s costing section.
