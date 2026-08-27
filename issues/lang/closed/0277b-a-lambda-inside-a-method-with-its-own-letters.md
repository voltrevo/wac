# 0277b — a lambda inside a method with its own type parameters

- **Status:** closed 2026-08-27
- **Claimed by:** agent-b
- **Reported by:** agent-b
- **Date:** 2026-08-27
- **Fixed in:** `packages/wacc/src/emit.wac` — the lambda table gains the third monomorphisation level
- **Kind:** bug
- **Symptom:** compile error — *a value of a type this emitter cannot write: U*

`design/lang/0010` option C landed and every spec case for it has a method whose body is ordinary
code. This is what those cases cannot see: a **lambda** inside such a method.

## Reproduction

```wac
struct Cell<T> {
  T v;
  Cell<T> of(T v) { return Cell<T>(v); }
  U pick<U>(const this, U a) {
    fn[U(i32)] g = (i32 i) => a;
    return g(0);
  }
}
export i32 main() {
  Cell<bool> c = Cell.of(true);
  return c.pick<i32>(7);
}
```

Expected: 7. Actual: *cannot emit — a value of a type this emitter cannot write: U*.

Removing the lambda — `U pick<U>(const this, U a) { return a; }` — answers 7, so it is the lambda and
not the method. The captured value's type does not have to be a funcref: this captures a bare `U`.

## What it was: three walks that bind only the owner's letters

A generic struct's methods are walked per *owner* instantiation — `Cell<bool>` — with
`pushSubstitution` binding `T` and nothing else. A method type parameter is bound by nothing there,
so every one of these recorded something still naming `U`:

1. **the lambda walk** (`findLambdasInInstances`) recorded the lambda with a capture typed `U`, and
   the capture *cell struct* built from that type is what `writeValType` was eventually asked to
   write — as `$cell$fnU(bool)$a`, which is how the trail was picked up;
2. **the instance registration walk** called `collectArrayTypesIn` over the body fifteen lines before
   declining the method, registering a local declared `fn[U(i32)]` as a signature;
3. **`pushInstSubstitution`**, which re-derives a hoisted lambda's world from `lambdaInst`, matched a
   method instance's `instOf` — `Cell<bool>.pick` — against declaration names, found none, and
   answered 0, so the lambda was emitted with `U` unbound.

## The fix, and the part that is a real design point

The three walks decline an own-letter method, and a new one — `findLambdasInMethodInstance` — walks
it per **method** instance with both substitutions pushed, the way `registerOneMethodInstance`
already emits it.

**`curInst` names the method instance, not the owner's**, which is a deliberate departure from the
comment in `registerOneMethodInstance` saying the inner push leaves it alone. It is the key
`Env.lambdaAtPos` matches on, and `pick<i32>` and `pick<i64>` are two copies of one written lambda:
with the owner's name as the key, one hoisted function serves both and has the wrong type for one of
them. So the finer key is the point rather than an accident, and the three sites that push both
substitutions now all set it.

**And the ordering is the part that took longest.** A method instance is discovered *inside* the
emittability fixpoint. The pass that records generic instances' lambdas runs once before the fixpoint
and once after; the first is too early for a method instance and the second is too late for the
`canEmit` that has already declined it. The decline said so exactly —

    a lambda (this module has 0, 0 in a position the walk does not type yet, 0 sharing a position key)

— *this module has 0*, at a point where the module plainly had one. So the recording is now done
where the instance is discovered, before the verdict that reads it. Every other instantiation is
named before the fixpoint starts, which is why this is the only place that needs it.

## What it unblocks

`std/platform.wac` gains `Pending<U> map<U>(const this, fn[U(T)] f)` — `design/lang/0010`
criterion 4, the one criterion that had no compiler answer. It is **smaller than that design
predicted**: the design expected a derived ticket resolved when the first resolves, which is
scheduler plumbing. A ticket is an id plus three functions of that id, so the chained one keeps the
same host id, the same `settled`, the same `drop` and the same world, and differs only in `resolve`,
which gains `f` on top. No scheduler change at all.

Tested in `packages/platform/test/wac/scheduled_test.wac`, including two links in a row.

## How it was found

By the instrument from `issues/lang/0276b`: tag the call sites of the registrar, one marker per
line written immediately before the call, and trap on the first type containing a bare letter. Four
rounds of it — `sigType`, then `pairType`, then `writeValType`, then the field walk naming its owner
— each answered in one build. A marker at a function *entry* does not work and gives plausible wrong
answers; that lesson is written up in 0276b.
