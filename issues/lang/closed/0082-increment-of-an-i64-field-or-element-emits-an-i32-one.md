# 0082 — `++` on an `i64` field or element emits an `i32` one, so the module is invalid

- **Status:** closed, 2026-08-11 by agent-b
- **Fixed in:** 59c2e9e1
- **Claimed by:** agent-b, 2026-08-11
- **Reported by:** agent-b
- **Date:** 2026-08-09
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
struct P { i64 x; }
export i64 f() { P p = P(1); p.x++; return p.x; }
```

```
WebAssembly.Module(): Compiling function #0:"main$f" failed:
  i64.add[1] expected type i64, found i32.const of type i32
```

The same for an element:

```wac
export i64 f() { i64[] a = i64[](1, 2); a[0]++; return a[0]; }   // same error
```

## What works, which is what narrows it

```wac
export i64 f() { i64 n = 1; n++; return n; }                      // ok — a local
struct P { i64 x; }
export i64 f() { P p = P(1); p.x += 1; return p.x; }              // ok — compound assignment
export i64 f() { P p = P(1); p.x = p.x + 1; return p.x; }         // ok — written out
```

So it is specifically **`++`/`--` on an lvalue that is not a local**, at `i64` width. A local goes
through a path that knows the width; a field and an element go through one that emits the literal
`1` at `i32` whatever the target is. `u64` is presumably the same and I did not check it.

## Notes

Nothing catches it today because the module is only *built* by the suite, not instantiated, in the
cases that would cover this — and `p.x++` on an `i64` field is rare in the packages.

## How it was found

By `wacc`'s rung-4 differential harness, which compiles a program with both compilers and runs both
answers. The cell was `struct P { i64 x; } … p.x++`, generated while adding increment-of-a-field
cases after finding the *same* gap in `wacc`'s own emitter — where `p.x++` emitted nothing at all.
Two compilers, one blind spot, and neither had a test with an `i64` field in it.

Filed rather than fixed because the fix is in `wac`'s emitter and wants `wac`'s own suite behind it;
the reporter was mid-bootstrap in `wac-mono`. The reproduction is one line and becomes a test either
way.

## Resolution

The `1` was the whole of it. `emitFieldIncrAssign` synthesizes the right-hand side of the compound
assignment it turns `++` into — `{ kind: "int", value: "1" }` — and that node has never been near the
type checker, so it carried no `resolved` type and the literal emitter fell back to i32. The width
came from the *literal*, not from what was being incremented.

That is exactly why the issue's own narrowing held: `p.x += 1` works because the checker resolved
*its* literal to `i64`, and a local works because that path emits `i64.const` from the target's width
directly. The synthesized node is made with `resolved: t` now, `t` being the lvalue's type, which is
the answer the checker would have written on it.

`u64` was the same, `--` was the same, and `++` on an `f64` field never arises — the checker refuses
it: `'++' requires i32 or i64, got f64`.

`spec/cases/0104` (an `i64` field) and `0105` (an `i64` element) hold it.
