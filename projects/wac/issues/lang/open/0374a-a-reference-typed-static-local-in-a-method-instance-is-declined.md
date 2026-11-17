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

## The second half, implemented on `wip/wac1-0374a` — wac1, 2026-11-17 (focused tests only, not gated)

A reference-typed static in a generic instance's body (`mine<U>`) is registered per instance while the instances are
discovered (`instanceStaticAt`, from `bindBlockStatics`). Its table is kept apart from the constant tables, because the
static evaluator is a snapshot of those, and growing them mid-body replaced it under the block holding its marks.
`assignGlobals` gives it a global after the constants when its initialiser can be emitted, the start function writes it,
and `bindBlockStatics` reads the global into the local. The letters in force at registration are kept and put back around
the initialiser, so `static U[] all = U[]()` is one array per instantiation. Its type is the one the instance writes
(letters bound), registered during discovery: an array type first named later shifted every function index. The local
is typed the same way.

`staticinstance_test.wac` covers one object per instantiation and a distinct one across instantiations, the letters case,
and the first half. Its answers are 40–43 because a declined `main` also exits 1. Still to do before master: a full gate,
and closing this issue.

Found on the way, not fixed: returning such a static as `const U[]` from `arr<U>` is declined as *a return between related
reference types*, which is an emitter gap in returning a `const` array of a letter, not a static one.
