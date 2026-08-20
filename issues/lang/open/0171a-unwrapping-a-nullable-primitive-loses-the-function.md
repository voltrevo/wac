# 0171a — unwrapping a nullable *primitive* loses the function; a nullable reference is fine

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-20
- **Kind:** missing feature
- **Symptom:** the build fails and names the function

## Reproduction

```wac
export i32 f(i32? x) { return x!; }
```

    $ wac check g06.wac    1 file(s), no diagnostics
    $ wac build g06.wac -o g06
    wacc: cannot emit g06.wac — the exported function `f` is not in the module the emitter produced

The reference accepts this program: `NO DIAGNOSTICS`.

**A guard does not help** — `if (x is null) { return 0; } return x!;` fails the same way, so this is
not the checker asking for proof that the value is present.

**A nullable *reference* works**, which is what narrows it:

```wac
struct S { i32 v; }
export i32 f(S? s) { return s!.v; }        // builds, 2210 bytes
```

## Why

`spec/spec/types.md`: a nullable primitive is **boxed**. The emitter's `Unwrap` arm is

```wac
case Unwrap(operand): {
  emitExpr(fb, src, lexed, env, operand);
  fb.byte(212);   // ref.as_non_null
}
```

`ref.as_non_null` is right for a nullable reference and wrong for a boxed primitive: what the slot
wants is the `i32` *inside* the box, so the unwrap needs the null check **and** the read out of the
box. There is no arm for that, so the function does not reach the module.

## What is good about this issue

It used to be silent. `wac build` wrote a module without `f` and exited 0, and you found out when a
caller could not find it. The export-parity check added in `issues/lang/0170a` is what turns it into
the message above.

**But the message names the symptom, not the cause.** It should say *an unwrap of a nullable
primitive* — the emitter knows exactly what it could not do. This is one of the 40 bare
`if (…) { return; }` bails in the emitter's expression walk that record no reason; 0170a counts them
and explains why they matter. Fixing this one's *message* is smaller than fixing the feature and worth
doing either way.

## Where the feature work is

The unwrap needs to be two operations for a boxed primitive, and the boxing is already implemented —
`i31ref` and the nullable-primitive path both exist, since `i32? x = null;` and `x is null` compile.
So this is the read side of something already half-present rather than new machinery.

Checked, so the scope is known rather than guessed: **`i64?`, `f64?` and `bool?` all fail the same
way**, so it is every nullable primitive and not something about `i32`. `u8?` is refused outright —
*a packed type cannot be nullable* — which is `spec/cases/0025` and correct.
