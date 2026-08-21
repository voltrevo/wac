# 0241a — a generic method's body is never checked under substitution, so `wac check` passes what `wac build` refuses

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** diagnostic
- **Covered by:** `§wac-generic-template-check-2wkq7nm`
- **Symptom:** no error — from the checker; the emitter refuses it

## Reproduction

```wac
enum Opt<T> { Some(T v), None
  bool isSome(const this) { return match (this) { case Some(_): true, case None: false }; }
  T orElse(const this, T d) { match (this) { case Some(v): { return v(); } case None: { return d; } } }
}
export i32 f() { Opt<i32> o = Opt.Some(1); return o.orElse(0); }
```

`v` is an `i32` at this instantiation and `v()` calls it. Measured:

    wac check   1 file(s), no diagnostics                      exit 0
    wac build   wacc: cannot emit … — the exported function `f` is not in the module the
                emitter produced — a method Opt<i32>.orElse, declined: a call to v      exit 1
    reference   'v' of type 'i32' is not callable                                       reported

**The same with `orElse` never called** — `return o.isSome();` as the body — so this is not about which
methods are reached. wacc is silent either way; the reference reports either way.

Nothing ships: the emitter declines and names the method and the reason, which is `issues/lang/0170a`'s
first item working as intended. The defect is that **`wac check` is the fast loop and it says the program
is fine.** A reader who checks, gets a clean answer, then builds, is sent to an emitter message for what
is an ordinary type error.

## Why

`issues/lang/0043` type-checks each template **once**, with its type parameters bound to an opaque type
that permits any operation whose result does not need to be known. That is right, and it is what the
first half of `§wac-generic-template-check-2wkq7nm` says:

> The second is not, and cannot be: an opaque `T` has no known members, so nothing about it is
> decidable yet. Anything naming a type parameter is deferred…

The sentence continues, and this is the half that is missing:

> The cost is that a genuine mistake involving another template inside a template body is also
> **deferred to instantiation**.

Deferred to instantiation, not to never. `Opt<i32>` is instantiated here. wacc has no instantiation-time
pass over a generic's method bodies, and `check.wac` records the same fact from the other side, at the
line where it declines to compare argument types in a generic call:

> Arity applies to a generic function; the *types* do not, until the parameters are bound. Binding them
> is what this asks about — not whether each argument fits, **which needs the substitution this checker
> does not perform**.

So the opaque pass is the whole of what a generic body gets, and any fault that only exists for a
particular `T` is invisible to the checker.

## How it was found, which is the part worth keeping

`mutateCheck.test.ts`'s recall table carried `2 missed of 7  '…' of type '…' is not callable` — two
programs the reference refuses and wacc says **nothing** about, which is the one direction a subset
checker may not be wrong in.

Guessing the shape from the family name did not work: `return x();` was tried against twelve types —
`bool`, `f64`, `u32`, `i64`, `u8[]`, `string[]`, an enum, a struct, a nullable, an `anyref`, a parameter
and a `string` — and wacc refuses **all twelve** with *"this is not something that can be called"*. The
rule is present and correct; it is the generic body that never reaches it.

`packages/wacc/test/missed.ts "is not callable"` printed the programs, which is what identified it. That
tool exists because `corpusMutate.test.ts` learned the same lesson — *"a count is not a queue"* — and it
is worth saying that reaching for it beat both guessing and adding a second one.

## The decision, and a recommendation

- **Check each instantiated generic's methods under substitution.** What the spec says, and the end
  state. The cost is the substitution the checker does not perform, and it is not only machinery: a pass
  that suddenly checks every generic body in the seed app's graph will find things, which is good and is
  also a red suite for everyone until they are fixed.
- **Let `wac check` report the emitter's declines.** The emitter already knows — *"a method
  Opt<i32>.orElse, declined: a call to v"* — and giving that answer a position is much less work than
  deriving it a second time with less information. It makes `check` and `build` agree, which is the
  user-visible defect, without new checker capability. Against it: an emitter decline is not positioned
  like a type error, and a diagnostic that cannot point at `v` is a worse diagnostic than the
  reference's.
- **Record it as a known limitation** and leave the emitter as the backstop. Honest, and it leaves `wac
  check` answering "no diagnostics" about a program that does not build, which is the thing a reader
  will report again.

**Recommended: the second, then the first.** Making `check` and `build` agree is the defect anybody
actually hits, and it is the smaller change; the substitution pass is the correct answer and is better
attempted when it is the only thing changing.

**This is the second instance of one shape**, which is the argument for doing it once properly:
`issues/lang/0157`'s remaining half is the same trade for imports — *"Ask the linker instead of
re-deriving. `emit.wac` already knows which imports it could not satisfy… Give that answer a position and
let the checker report it, rather than computing membership twice with less information."* Two issues, two
subsystems, one seam: **the emitter knows something the checker does not, and the checker is what the
reader asked.**

## Notes

The recall row this came from cannot close until the checker reports, so it will keep reading as `2
missed of 7` — a permanent entry of the same kind `issues/lang/0151` describes for its own 1, and worth
knowing about before somebody tries to fix the number rather than the cause.
