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

Deferred to instantiation, not to never. `Opt<i32>` is instantiated here, and wacc has no
instantiation-time pass over a generic's method bodies — so the opaque pass is the whole of what a body
gets, and any fault that exists only for a particular `T` is invisible to the checker.

**What is missing is the pass, not the ability to substitute.** `substituteType(c, owner, written)` turns
a written `T` into the type it has at a given instance, and has 16 call sites — `checkMethodArgs` uses it
on every generic method's parameter types. There is a nearby comment that reads like a statement of the
opposite, and it is worth not being misled by it as I first was:

> Arity applies to a generic function; the *types* do not, until the parameters are bound. Binding them
> is what this asks about — not whether each argument fits, **which needs the substitution this checker
> does not perform**.

That is about comparing **argument types at a call to a generic function**, where the instance is not
known from the call site. It is not a statement that the checker cannot substitute.

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
  state. The cost is a second body pass per (generic, instantiation) pair — the substitution itself
  already exists — and the real expense is not machinery: a pass that suddenly checks every generic body
  in the seed app's graph will find things, which is good and is also a red suite for everyone until they
  are fixed. That is the number to get before starting, and it is measurable without landing anything: a
  probe importing `../../src/api.wac` compiles the working tree while the seed stays the last good one.
- **Let `wac check` report the emitter's declines.** The emitter already knows — *"a method
  Opt<i32>.orElse, declined: a call to v"* — and giving that answer a position is much less work than
  deriving it a second time with less information. It makes `check` and `build` agree, which is the
  user-visible defect, without new checker capability. Against it: an emitter decline is not positioned
  like a type error, and a diagnostic that cannot point at `v` is a worse diagnostic than the
  reference's.
- **Record it as a known limitation** and leave the emitter as the backstop. Honest, and it leaves `wac
  check` answering "no diagnostics" about a program that does not build, which is the thing a reader
  will report again.

**Recommended: the first.** This paragraph recommended the second, and both halves of the argument for
it turned out to be wrong when priced instead of assumed.

**The second costs `check` its reason for existing.** A decline is discovered while emitting a function
body, so reporting declines means emitting — and `wac check` exists because it does not. Measured on
`packages/json/src/json.wac`, 12 files:

    wac check    88ms
    wac build   245ms

2.8×, and the only part that is not shared is writing the module. A fast loop that is 2.8× slower is not
a fast loop, and `issues/lang/0153` is already about a build costing two emits.

**And the first's blocker was overstated — by me, quoting a comment about something else.** The line
above from `check.wac` — *"which needs the substitution this checker does not perform"* — is about
comparing **argument types at a generic call**, which is a different question. `substituteType(c, owner,
written)` exists and has **16 call sites**; it is what `checkMethodArgs` already uses to turn a written
`T` into the type it has at this instance. So the missing thing is not the substitution primitive. It is
a *pass*: re-walk an instantiated generic's method bodies with its parameters bound, where `0043`'s pass
walks them once with the parameters opaque. That is a smaller and much better-founded change than "the
checker cannot substitute" suggested, and it is what the spec asks for.

**So the `0157` link is weaker than stated too.** That one proposes asking the linker about *imports* —
which the checker already walks, and which needs no emission at all. The shape rhymes; the price does
not, and pricing them as one was the same mistake in miniature.

## The red suite is the thing to be afraid of, and it is measurable now

The first option's real cost is not the pass — it is what a pass that suddenly checks every generic body
finds in code that currently compiles. **That is answerable without writing it**, because the reference
already does this checking, so anything the pass would newly report is something the reference reports
today. Run over unmutated sources, 2026-08-21:

    packages/wacc/src/api.wac      17 file(s), no errors
    packages/json/src/json.wac      8 file(s), no errors
    packages/url/src/url.wac        4 file(s), no errors
    packages/crypto/src/sha256.wac  2 file(s), no errors

So for 31 files including the compiler's own sources — the largest wac program here, and the one whose
breakage would stop the seed — a per-instantiation pass has nothing to report. **The feared red suite is
not there**, at least not in what the reference can be asked about.

The scope of that claim is exactly the reference's own: it cannot compile everything here — the app
imports `packages/platform`, whose `Pending<T>.then` is a lambda, and the reference has none, which is
why `WAC_APP_FROM=reference` stopped working. So the packages whose graphs reach `platform` are not
covered by the measurement above and would need the pass itself to answer for them.

## And what it would cost in time, which is the number left

A per-instantiation pass walks a generic's method bodies once per instance, so the multiplier is the
number of concrete instantiations. Counted over `packages/wacc/src` — the compiler's own sources, the
graph whose check time anybody editing this feels:

    53 concrete instantiations across ~22 template names
    19 of them are `Pending<…>` alone, whose methods would be re-walked 19 times

Against a baseline of **833ms** for `wac check packages/wacc/src/api.wac` today. So this is not free and
it is not alarming either; it is a number the operator should see before it lands, because `wac check` is
the fast loop and `issues/lang/0153` is already about what a build costs.

Two things that would keep it down, if it is taken:

- **Only where a body says something about a type parameter.** A method whose body never names one is
  already fully checked by the opaque pass; re-walking it per instance buys nothing. That test is cheap
  and would take most of the 53 out.
- **Once per distinct instantiation, not per use.** `Pending<i32>` appearing fourteen times is one
  instance.

## Notes

The recall row this came from cannot close until the checker reports, so it will keep reading as `2
missed of 7` — a permanent entry of the same kind `issues/lang/0151` describes for its own 1, and worth
knowing about before somebody tries to fix the number rather than the cause.
