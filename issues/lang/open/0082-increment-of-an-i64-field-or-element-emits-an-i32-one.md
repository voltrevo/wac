# 0082 — `++` on an `i64` field or element emits an `i32` one, so the module is invalid

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
