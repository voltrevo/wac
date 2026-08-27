# 0274b — chaining calls with written method type arguments is refused by the emitter

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-27
- **Kind:** bug
- **Symptom:** the emitter declines — a refusal, not a wrong answer

`design/lang/0010` option C landed and one of its six criteria did not: **a chain**.

## Reproduction

```wac
struct Cell<T> {
  T v;
  Cell<U> then<U>(const this, fn[U(T)] f) { return Cell<U>(f(this.v)); }
  T get(const this) { return this.v; }
}

export i32 main() {
  Cell<i32> c = Cell<i32>(2);
  Cell<bool> b = c.then<i64>((i32 x) => (x * 3) as i64).then<bool>((i64 y) => y > 5);
  return b.get() ? 9 : 4;
}
```

    wacc: cannot emit … — a method Cell<i32>.then, declined: a call to Cell

**One link works**, which is what makes this a chain problem rather than a feature that does not
work:

```wac
Cell<i64> d = c.then<i64>((i32 x) => (x * 3) as i64);    // compiles, runs
```

## Two causes, not one, and that is the useful part

Naming the intermediate produces a **different** failure:

```wac
Cell<i64> mid = c.then<i64>((i32 x) => (x * 3) as i64);
Cell<bool> b  = mid.then<bool>((i64 y) => y > 5);
```

    wacc: cannot emit … — an assignment between related reference types

So there are at least two:

1. **An intermediate instantiation no type names.** In the chained form, `Cell<i64>` appears nowhere
   in the program except as one method instance's return type. It has to be discovered *from* that
   instance and then registered before the same instance's body can be walked — one round behind
   itself. `registerMethodInstances` takes its verdict every round and may revise a no to a yes for
   exactly this reason, and that is evidently not enough.
2. **The second link's result type.** With the intermediate named, `Cell<i64>` exists and the failure
   moves to the assignment, so `mid.then<bool>(…)` is producing something the checker sees as related
   to `Cell<bool>` rather than as it. That is a *second* bug and the first one hides it.

## Where to look

`registerMethodInstances` in `emit.wac` is the pass this belongs to, and the design it follows is
written up in `design/lang/0010` — append, never interleave, because 43 loops step an index over the
per-instance method sequence and six do nothing else.

The two failures should be attacked in the order above, since the second is only visible once the
first is worked around by naming the intermediate. **Write the named-intermediate form first**: it is
the smaller of the two and it isolates cause 2.

## What works, so the ground is known

`spec/cases/0245` and `0246` are the landed behaviour: `fold<i32>` with an inline lambda, and two
type arguments to one method producing two instantiations, measured in emitted bytes. Anything done
here should keep both.

## Notes

**It declines rather than miscompiling**, which is the supported shape — the module is not built. So
this is a missing capability with a poor diagnostic rather than a correctness risk.

**The diagnostic is the other half of the work.** `a method Cell<i32>.then, declined: a call to Cell`
names neither the chain nor what to do, and the fix — naming the intermediate — is not something the
message suggests. Whatever lands should say which link could not be built.
