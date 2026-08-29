# 0281b — `as~` to `i32` wraps instead of clamping when its operand is a constant

- **Status:** closed
- **Fixed in:** `packages/wacc/src/emit.wac` — the `Cast` arm emits a too-wide integer literal at
  `i64` and lets `emitCast` do the narrowing. `spec/cases/0294` and `0295`.
- **Claimed by:** agent-b (2026-08-28)
- **Reported by:** agent-b
- **Date:** 2026-08-28
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
export i32 castLit()   { return 4294967296 as~ i32; }              // 0, want 2147483647
export i32 castParen() { return (4294967296) as~ i32; }            // 0, want 2147483647
export i32 castSum()   { return (4294967295 + 1) as~ i32; }        // 0, want 2147483647
export i32 castMin()   { return (-9223372036854775807 - 1) as~ i32; } // 0, want -2147483648

// Correct, and the contrast that locates it: through a local, it clamps.
export i32 castLocal() { i64 n = 4294967296; return n as~ i32; }   // 2147483647
```

Expected: `2147483647` for the first three and `-2147483648` for the fourth —
`spec/spec/casts.md` gives `i64 -> i32   clamp to i32 range` for `as~`, and
`[§wac-cast-matrix-6hkq4wz]` is about that clamping.

Actual: all four are `0`, which is what `as@` gives — the low 32 bits of `2^32` and of `i64` min
are both zero. So the constant is being narrowed to 32 bits *before* the clamp, and the clamp then
has nothing left to do.

## Notes

**Only the constant path.** `castLocal` above returns the right answer, and so does a runtime
argument:

```wac
export i32 runtime(i64 n) { return n as~ i32; }
```

`runtime(4294967296n)` is `2147483647` and `runtime(-9223372036854775808n)` is `-2147483648`. The
emitted instruction is right; something ahead of it folds the constant with `as@`'s rule.

The literal itself is not the problem — `export i64 plainLit() { return 4294967296; }` returns
`4294967296`.

**Found by `tools/fuzz.ts` after it was repointed from the reference to wacc**, which is how it had
gone unnoticed: the fuzzer's oracle is the generated tree, and it was checking the TypeScript
reference, which gets these right. Seeds 13 and 31 of `--count 40 --seed 1` both fail on this and
both agree with the reference. Two of forty programs, so the generator reaches it easily once it is
pointed at the right compiler.

Not filed as an `as@` bug: `export i32 wrapped() { return 4294967296 as@ i32; }` is `0` and that is
correct — `as@` keeps the low bits by definition. The two operators appear to share a fold that
implements only the second.

## Fixed, 2026-08-28 — and the same defect had already been fixed for floats

The `Cast` arm pushes the target type into an operand with no type of its own, and the `IntLit` arm
emits an `i32`-slotted literal as `v as@ i32` — the low bits, unconditionally. So `4294967296 as~
i32` became `i32.const 0` and the cast then converted `i32` to `i32`, which is nothing: the clamp had
been pre-empted by a truncation nobody wrote. Through a local the literal is an `i64` and the cast
does its job, which is the contrast this page used to locate it.

**The fix is one line, and its precedent sits directly above it.** `issues/lang/0117` is the same
sentence one family along:

> **A float literal being converted is still a float.** With no type of its own it took the cast's
> target, so `1.5 as~ i32` emitted the literal *as an `i32`* and then converted `i32` to `i32` —
> nothing at all.

So a too-wide integer literal is emitted at `i64` and `emitCast` narrows. That is right for all
three operators rather than for `as~` alone: `as@` wraps to the same low bits it was taking anyway,
and `as!` traps where it should instead of silently answering the truncation.

## `42 as~ i32` cannot be written, which the second case found

The guard is *"only where the literal does not fit"*, and the first version of `spec/cases/0295`
asserted that `42 as~ i32` still compiles to one instruction. It does not compile at all: a bare
literal that fits `i32` already **is** one, so the cast is between a type and itself and is refused a
step earlier —

    error: this cast is between one type and itself
       = help: the cast can be removed

The case now makes that point through a local, and the comment in `emit.wac` says the guard is belt
and braces rather than a live path. Worth recording because it is the second time today a test
asserted a program that was never legal, and both times the corpus is what said so.
