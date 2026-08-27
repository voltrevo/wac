# 0274b — two instantiations of a method that returns an instantiation are refused

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-27
- **Kind:** bug
- **Symptom:** the emitter declines — a refusal, not a wrong answer

`design/lang/0010` option C landed and one of its six criteria did not. **It is not the chain**, which
is where this started and what the first version of this issue said — chaining is a symptom. Narrowed
by four probes to:

> **two or more instantiations of one method whose return type is an *instantiation* naming the
> method's own letter.**

One instantiation is fine. Two are fine when the return type is a plain letter. It is the combination.

## Reproduction — the smallest one, with nothing chained

```wac
struct Box<U> { U w; U get(const this) { return this.w; } }
struct Cell<T> {
  T v;
  Box<U> wrap<U>(const this, fn[U(T)] f) { return Box<U>(f(this.v)); }
}

export i32 main() {
  Cell<i32> c = Cell<i32>(2);
  Box<i64>  d = c.wrap<i64>((i32 x) => (x * 3) as i64);
  Box<bool> e = c.wrap<bool>((i32 x) => x > 1);          // the second one is the problem
  return (d.get() as! i32) + (e.get() ? 3 : 0);
}
```

    wacc: cannot emit … — an assignment between related reference types: Box<U> into Box<bool>

`Box<U>` is the **template's** return type, with the method's letter unbound: the second call resolved
to the template entry because its instance was never registered. That message named neither type
until this issue was written; naming both is what turned the guess into a measurement, and it is
landed.

## The four probes that narrowed it

| program | result |
|---|---|
| one instantiation, return type `Box<U>` | **works**, answers 9 |
| **two** instantiations, return type `Box<U>` | **fails**, as above |
| two instantiations, return type a plain `U` — `fold<i32>`/`fold<i64>` | **works**, `spec/cases/0246` |
| two instantiations, return type `Cell<U>` — the method's *own* template | **fails**, same message |

So it is neither the chain, nor two instantiations, nor an instantiation-shaped return type. It is the
second instantiation *of a method whose return type is one*. The owner's own template is not special:
`Box<U>` from a `Cell<T>` fails the same way.

## The workaround, which is also the strongest clue

**Put the two calls in different functions and it works.**

```wac
i32 a(Cell<i32> c) { Box<i64>  d = c.wrap<i64>(…);  return …; }
i32 b(Cell<i32> c) { Box<bool> e = c.wrap<bool>(…); return …; }
```

That says the failure is *within one body*, and points at the discovery walk: `collectInstances`
walks each body with `canEmit`, which **stops at the first thing it cannot emit**. In round one the
first call names its instance (discovery happens inside `typeOfE`, through `methodSlotFor`) and then
the statement declines, because the instance does not exist yet — so the walk stops there and the
*second* call is never reached, never named, never registered. Two bodies means two walks, and each
gets its first call.

The rounds ought to recover it — round two should pass the first statement and reach the second — and
empirically they do not. That is the thing to understand before writing anything: **why a second
round does not discover what the first could not reach.**

Tried and reverted: making `methodSlotFor` answer *unknown* rather than the template's entry when the
instance is not registered yet, so the statement would not decline and the walk would carry on. It
moves the failure rather than fixing it — `main` is then dropped from the module with no reason
given — so something else is also reading that fallback.

## What that points at

The message is an assignment between two *related* reference types, so the call's result is coming
back as a `Box<…>` that is not the `Box<…>` the slot wants — the second instance is very likely
carrying the **first** instance's return type. That is a question about what
`registerMethodInstances` records in `funcReturns`, or about which substitution is in force when it
does: the two instances differ only in the inner push, and `typeOfTyName(Box<U>)` is what turns `U`
into a name.

### Measured, with a temporary probe in that message

Both questions above are answered, and the answer is narrower than either guess:

    [minst: Cell<i32>.wrap<i64>=>Box<i64>   Cell<i32>.wrap<bool>=NO]

- the **first** instance is registered and its `funcReturns` is `Box<i64>` — correct, both
  substitutions applied;
- the **second** is in `env.instName` (so `methodInstance` named it and `env.instantiate` recorded
  it) and has **no function-table entry at all**.

So this is not a substitution bug and not an ordering bug in the emission passes. It is that
`registerMethodInstances` never registered the second instance, although it is in the list it walks
and the first one beside it went through the same code.

The next question is therefore *when* it entered the list. The rounds ought to make this work: round
one discovers `wrap<i64>` and registers it, round two then passes the first statement and reaches the
second call, and round three registers what it named. Either the second call is being named only
*after* the last round — in which case the discovery that matters is happening in the final emit walk
rather than in `collectInstances` — or the first statement is still declining in round two for a
reason the probe above rules out. **A round counter in that message would separate the two**, and it
is the cheapest thing left to try.

## Where to look

`registerMethodInstances` in `emit.wac`, and the design it follows is in `design/lang/0010` — append,
never interleave, because 43 loops step an index over the per-instance method sequence and six do
nothing else.

## What works, so the ground is known

`spec/cases/0245` and `0246` are the landed behaviour: `fold<i32>` with an inline lambda, and two
type arguments to one method producing two instantiations, measured in emitted bytes. Anything done
here should keep both.

## Notes

**It declines rather than miscompiling**, which is the supported shape — the module is not built. So
this is a missing capability with a poor diagnostic rather than a correctness risk.

**The chain is a consequence**, and the reason this looked like a chaining bug: every link of
`c.then<A>(f).then<B>(g)` is another instantiation of `then`, so a chain reaches two the moment it has
two links.

**The diagnostic is the other half of the work.** `a method Cell<i32>.then, declined: a call to Cell`
names neither the chain nor what to do, and the fix — naming the intermediate — is not something the
message suggests. Whatever lands should say which link could not be built.
