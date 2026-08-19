# 0164a — wacc never compares array types, so any array satisfies any slot

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-19
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
struct Box { i32 v; }
i32 take(Box b) { return b.v; }
export i32 main() { return take(i32[0]()); }
```

`wac check` says `1 file(s), no diagnostics`. `wac compile` writes a module the engine rejects.

The reference reports it:

```
error: type mismatch: expected Box, got i32[]
```

**Every position, not only arguments.** Each of these is accepted by wacc and refused by the
reference:

| position | program |
|---|---|
| argument | `i32 take(Box b) { … } … take(i32[0]())` |
| argument | `i32 take(string[] a) { … } … take(i32[0]())` |
| assignment | `string[] a = i32[0]();` |
| return | `string[] f() { return i32[0](); }` |
| field | `struct S { string[] xs; } … S(i32[0]())` |

**What it does catch**, which is what makes the shape clear:

```wac
struct A { i32 v; }
struct B { i32 v; }
i32 take(A a) { return a.v; }
export i32 main() { return take(B(1)); }   // refused: argument does not match the parameter's type
```

So the check is there and works for named types. An **array** value simply does not reach it — any
array satisfies any slot, including a slot that is not an array at all.

## Why it matters

The failure is the worst-shaped one available: the checker is silent, the emitter produces a module
that will not load, and the message blames the compiler — *"this is a compiler bug rather than a
fault in your program"* — for what is a plain type error in the source. The line is gone by then.

It also means the reference is doing work here that wacc is not, so a program can pass `wac check`
and fail the harness. That is the same asymmetry as `issues/lang/0163` and a different cause.

## How it was found

Writing `design/lang/0009` step 7. A refactor left `closureOfIn(paths, sources, string[0](fill: ""),
entry, seen)` where the third parameter had become a struct. wacc compiled it without complaint and
the seed came out invalid; `seed:bootstrap` went through the reference, which named the mismatch in
one line. Two compilers is what turned a confusing seed failure into a two-minute fix.

## Notes

Worth checking whether the same hole exists for other unnamed types — funcrefs, nullables of arrays,
`i31ref` — since the pattern looks like "the comparison is by declared name, and a type with no name
falls through" rather than anything specific to arrays.
