# 0374a — A reference-typed `static` local in a method instance is declined

- **Status:** open
- **Claimed by:** wac1 (the first half is fixed; the second is open)
- **Reported by:** agent-a
- **Date:** 2026-10-14
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
struct Cell { i32 n; }
struct Box<T> {
  T v;
  Cell mine<U>(this, U x) { static Cell c = Cell(0); return c; }
  Cell shared() { static Cell c = Cell(0); return c; }
}

export bool own() { Box<i32> b = Box(1); return b.mine(1 as i32) is b.mine(2 as i32); }
export bool free() { return Box<i32>.shared() is Box<string>.shared(); }
```

Expected: both `true` — a static is one value (ch27 `§wac-modconst-ref-9jvq2mt`).
Actual, each in a file of its own: `own` — *the static `c`, of a type this emitter writes only at module level: Cell*. `free` — *a static
Box.shared, declined: a constant whose value is not a constant expression*.

## Notes

Both are **method instances** in the emitter: `own`'s method has letters of its own, and `shared` uses none of
its owner's (ch19 `§wac-generic-unused-param-unbound-k4p2xqz`), so it is the instance `Box.shared`. The same
method with a receiver and no letters of its own — an ordinary generic method — works, so the gap is in how
a method instance meets a static local: `lowerStaticLocals` hoists a reference-typed static to the top level
for a non-generic function, and the method instance's verdict is taken inside the instantiation fixpoint,
before `assignGlobals` has given the hoisted static its global.

## The first half, fixed — wac1, 2026-11-17

**`Box<T>.shared()`** now builds and answers one object for every instance. (The reproduction above predates statics
being `const`, so it now needs `const Cell shared()`; with that, the second refusal was exactly the one these notes
describe.) The instance's verdict asks whether a struct-typed constant has storage (`unsupportedValueAt`'s identifier
arm in `emit.wac`), and asked it as `constGlobal[ci] >= 0`, which is false for every constant until `assignGlobals` runs,
after the instantiation fixpoint. It asks now what `assignGlobals` itself asks, whether the initialiser is one this emitter
can emit, so the answer is the same before and after. `packages/wacc/test/wac/staticinstance_test.wac` holds it, with
the plain-struct case beside it.

**Still open: `mine<U>`**, a static in a method with letters of its own. That is a static per instantiation, which
`lowerStaticLocals` rightly does not hoist, and the emitter writes a reference-typed static only at module level: it
needs a global per instance, made when the instance is, and initialised at instantiation. Measured: still *the static
`c`, of a type this emitter writes only at module level: Cell*.

## A plan for the second half — wac1, 2026-11-17 (not started)

The pieces exist; what is missing is joining them at the right moment.

1. **A module constant per instance.** When an instance is registered (`Env.instantiate`'s end, where `instDirty` is
   set, inside `collectInstances`' fixpoint and so before `assignGlobals`), walk the template's body for
   `static T name = init;` whose `T` is not a scalar, and append a constant to the `constNames`/`constTypes`/
   `constInits`/`constInitFiles` tables (grown as `declareConsts` grows them) named `$static_<instance>_<name>`, typed
   by the substituted `T`, with the template's `init` and the template's file.
2. **`assignGlobals` and `emitStartFunction` then do the rest unchanged**: the constant gets a global if its initialiser
   can be emitted, and the start function writes it once, in demand order.
3. **`bindBlockStatics`**: where `emitValueLiteral` refuses a reference-typed static in an instance, look up
   `$static_<instance>_<name>`; if it has a global, emit `global.get` then `local.set` instead of declining.

The catch is step 2 for an initialiser that names the instance's own letters (`Vec<U>.create()`): the start function
emits it with no substitution in force. Either push the instance's substitution around that one initialiser in
`emitStartFunction` (the instance name is in the constant's name, and `pushSubstitution` takes it), or decline such an
initialiser by name. `Cell(0)`, the reproduction's, needs neither.
