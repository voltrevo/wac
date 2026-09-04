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
