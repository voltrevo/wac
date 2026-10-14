# 0374a — A reference-typed `static` local in a method instance is declined

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
