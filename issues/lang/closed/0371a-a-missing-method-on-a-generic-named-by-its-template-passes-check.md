# 0371a — A call to a method a generic does not declare passes `wac check` when the receiver is the generic itself or `this` inside it

- **Status:** closed
- **Fixed in:** 4eea044cd
- **Claimed by:** agent-a
- **Reported by:** agent-a
- **Date:** 2026-10-14
- **Kind:** diagnostic
- **Symptom:** check clean, build exit 1

## Reproduction

```wac
struct S<T> {
  T v;
  i32 g(this) { return this.nosuch(); }
}
export i32 f() { i32 x = S.nosuch(1); return x; }
```

Expected: both calls refused — *no such static method* at `S.nosuch`, as it is when `S` is not generic, and
*no such method* at `this.nosuch`.
Actual: `wac check` is clean. The build fails later, in the emitter.

## Notes

`packages/wacc/src/check.wac`, the `if (c.isGeneric(recv))` arm of the method-call check (about line 10998):
it looks the method up on the generic's base (`gm = c.methodAt(genericBase(recv), name)`), checks arity and
argument types only `if (gm >= 0)`, and returns silently when `gm < 0`. The comment above it says a generic's
methods are not recorded, so an empty answer means "not modelled". That was true when it was written
(2094e60c8, 2026-08-08); the lookup two lines below it now finds them, so `gm < 0` means the method is not
there. The fix is to report `errNoStaticMethod`/`errNoMethod` there.

A concrete receiver (`Vec<i32> v; v.nosuch()`) is refused already; it does not take this arm.

`Ticket.any(a, b)` passes check this way (0369a). The comment's own example, `this.hash(k)` inside `Map<K, V>`,
is the case to check for a false alarm, along with a repository-wide `wac check` run after the change.

## Fixed

The generic arm reports *no such static method* / *no such method* when the template declares no method
of that name and has no field of that name (a field may hold a funcref). Cases a38 and a39 in
`illtyped_test.wac`. The repository-wide sweep (`corpuscheck_test`) stays clean, so `this.hash(k)` in
`Map<K, V>` is not a false alarm.
