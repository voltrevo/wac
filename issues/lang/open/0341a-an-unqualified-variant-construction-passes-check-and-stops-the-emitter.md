# 0341a — an unqualified variant construction passes `check` and stops the emitter

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** bug
- **Symptom:** `wac check` exits 0 on a program `wac build` cannot emit, and says nothing about where

## The reproduction

Two files, both self-contained, run against the binary from `./bootstrap.sh --no-install`.

```wac
// an enum declared in the same file
enum E { A(i32 x), B(i32 y) }
i32 main() {
  E e = A(7);
  match (e) { case A(v): { return v; } case B(v): { return 100 + v; } }
}
```

```wac
// and a variant imported by name
import { Result, Ok } from "core/result.wac";
i32 main() { Result<i32, i32> r = Ok(3); return 0; }
```

    $ wac check <either>       1 file(s), no diagnostics       exit 0
    $ wac build <either>                                       exit 1

and what `build` says:

```
wacc: cannot emit …/20_bare_runtime.wac — the function `main` is not in the module the emitter
produced — a construction of A with 1 of 0 fields
```

```
wacc: cannot emit …/23_ok_emit.wac — the function `main` is not in the module the emitter
produced — a call to Ok
```

Expected: one diagnostic from `check`, with a line and column, saying an unqualified variant
construction is not a construction — or accepting it, and emitting.
Actual: `check` is clean, `build` fails, and the message names `main` and gives no position.

## Two defects, and the second one is the reason this is worth filing

**1. The stages disagree.** `check` is the thing a person runs to find out whether a program is
well-formed, and it is the thing an editor runs. It says yes and the emitter says no. `spec/spec/
enums.md` gives the bare form for a **type test** — *"`is` accepts a variant name, bare or qualified
by the enum"* — and for a `case` pattern, and construction is `Enum.Variant(args)` everywhere in
`packages/`. So the emitter is right and the checker is missing a rule.

The checker does have the rule for one spelling. Same enum, no argument list:

```wac
enum E { A, B }
i32 main() { E e = A; return 0; }
```

    error: a type name is not a value
      --> …:2:20

So bare `A` as a *value* is refused with a position, and bare `A(7)` as a *call* is not refused at
all. The two paths are the arity paths `issues/lang/open/0335a` is about, from the other side — that
issue is a bare **qualified** variant with no argument list that emits a default payload, and this
one is an **unqualified** variant with an argument list that emits nothing. Both are the same gap in
the same place: the construction check is reached from the qualified-with-arguments path and every
other spelling walks past it.

**2. The emitter's message has no location and blames the wrong thing.** *"the function `main` is
not in the module the emitter produced"* is the emitter reporting a missing output symbol, with the
real cause appended as a clause. There is no file:line:col, so on a real program the reader is told
that `main` is missing and has to find which of a thousand expressions did it. The appended clause is
good — *"a construction of A with 1 of 0 fields"* names the construct — and it is the part that
should be the diagnostic.

That is the same shape as `issues/lang/open/0328a`, where `check` blames a test and `emit` names the
variant: **the stage with the position does not have the reason, and the stage with the reason does
not have the position.** Two independent instances now.

## What it means for the vision delta

`vision/GRAMMAR.md` records this construct as the largest omission it found, measured 2026-09-04:

> `Res<i32, F> f() { return Ok(3); }`     // 1 type error: `a call to Ok`
>
> **An unqualified variant construction is not a thing today.**

The conclusion is right and the evidence is misattributed: *a call to Ok* is the **emitter's** clause,
not a type error, and a type check of the same program is clean. Which changes the ask. It is not
*add a construct the compiler refuses*; it is *the checker already accepts it, so decide whether to
make the checker refuse it or the emitter emit it*, and the second is a smaller change than the delta
implies.

## Notes

Found by sweeping the vision constructs through the real compiler rather than reading — sixteen
minimal programs, one per proposed construct. The other fifteen behave as the delta says: `union<>`,
`fn<>`, `gen`/`yield`, `defer`, brace patterns, list literals, `never`, re-export, typedef and
`default:`-in-a-value-match are all refused at parse or type; `trap "…";` and a `const` parameter
already exist, which `vision/GRAMMAR.md` also records.
