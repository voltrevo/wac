# 0406a — a method call on a union value is not checked

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-27
- **Kind:** diagnostic
- **Symptom:** compile error

## Reproduction

```wac
struct A { i32 x; }
struct B { i32 y; }
string f(union<A, B> e) { return e.nothing(); }
export i32 main() { return f(A(1)).len(); }
```

Expected: the checker's error for an unknown method, as `A(1).nothing()` gets.
Actual: `wac check` reports no diagnostics; building fails in the emitter.

## Notes

Found as `e.toString()` on a fault union (`ReadFault`), which looks right because every member has `[toString]` and
interpolation converts through it (`§wac-interp-union-member-m3vq8ke`). The emitter says *a call to
`union<Denied, …>.toString`, which this expression is emitted as and which is not in the program*. `"\{e}"` is
the spelling that works. Possibly the same gap as 0403a (a match scrutinee's method is not checked either): the
checker may type a call on a union, or on a value whose method it cannot find, as unknown and move on.
