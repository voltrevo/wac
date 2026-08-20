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

## The spec documents this construct, and its example is one of the failures

Swept every fenced `wac` block in `spec/spec/*.md` — 170 programs, 108 of which check clean — through
`wac check` then `wac build`, looking for *check clean, build failed*. **Exactly one hit**, and it is
this bug, at `spec/spec/types.md:455`:

```wac
export i32 read(i32? x) { return x is null ? -1 : x!; }
```

    wacc: cannot emit types_25.wac — the exported function `read` is not in the module the emitter produced

The prose two lines above it is what makes this worth writing down. It says a nullable primitive comes
back as a reference and *"reading one needs an accessor written in wac"* — and then gives that accessor
as the example. So the documented way to use the feature is the thing that does not compile, and this
is a specified construct with a worked example rather than a corner someone wandered into.

**The rest of the sweep is a good result and worth keeping**, because it bounds the problem: of 108
check-clean spec programs, 107 build. The 62 the checker refused are fragments missing the type
declarations that live elsewhere in their document, plus deliberate counter-examples — `casts.md`'s
`s as! i32`, `control.md`'s `needsReturn`, `errors.md`'s `if (x)` — each of which carries its own
`// error: …` in the source and which wacc is *correct* to refuse. I checked the surrounding prose
rather than trusting the extractor, because a document's rejected examples look exactly like its
accepted ones to a regex.

The canary was `export i32 f(i32? x) { return 1; }`, and it failed as expected — via `wac build`'s new
validation rather than the parity check, since that one loses no export, it emits a module the engine
rejects.

### The guard this suggests

Nothing compiles the spec's code fences, and a guard that did would have caught this the day the
example was written. It is not free: it has to tell a self-contained example from a fragment and an
accepted one from a counter-example. The `// error:` comments are already in the source, which is most
of the way there, and `spec/tour.wac` shows the appetite for documents that compile. Filed as a thought
here rather than as its own issue until someone wants it.