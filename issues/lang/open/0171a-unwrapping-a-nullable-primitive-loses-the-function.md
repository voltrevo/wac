# 0171a — a nullable primitive is unimplemented in the emitter; the parameter alone makes an invalid module

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-20
- **Kind:** missing feature
- **Symptom:** invalid wasm, or the build fails and names the function

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

## Rescoped: it is not the unwrap, it is the type

I filed this as an unwrap problem and then probed the neighbours. Every nullable-primitive program
fails, and the smallest one is the worst:

| program | outcome |
|---|---|
| `export i32 f(i32? x) { return 1; }` | **invalid module** — the parameter is never even used |
| `export i32 f(i32? x) { return x is null ? 0 : 1; }` | the export is missing |
| `export i32 f() { i32? x = null; return x is null ? 0 : 1; }` | the export is missing |
| `export i32 f(i32? x) { return x!; }` | the export is missing |

The reference accepts all four.

The first row is the one that matters: an `i32?` **parameter**, unread, produces a module the engine
refuses — `Compiling function #12:"$bound$0" failed`. So the type is wrong at the boundary, before any
operation on a value of it, and the unwrap is a symptom rather than the fault.

`i31ref` and boxing exist, and `x is null` *checks* fine on its own, which is what made this look
narrow. It is not: nothing that takes or holds an `i32?` emits correctly.

### A message I wrote and reverted

I added a reason to the emitter's `Unwrap` bail — *an unwrap of a nullable `i32`, which is boxed and
this emitter cannot read back out yet* — and it never fired. `typeOfE` answers `""` for a nullable
primitive throughout, so the gate never sees a type to object to, which is also why `canEmit` approves
these functions and the emitter then drops them.

Reverted rather than left in place. It cannot fire until the type is modelled, and an unreachable
message is a claim nothing checks — `CLAUDE.md`'s rule about keeping things applies to code I wrote
five minutes ago as much as to anything else.

**So the order for whoever takes this is: model `T?` for primitive `T` in `typeOfE` first.** Until
then every rule that would name the problem is looking at an empty string, and the only thing standing
between this and silence is the export-parity net.
