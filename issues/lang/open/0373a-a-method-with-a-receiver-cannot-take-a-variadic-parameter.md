# 0373a — A method with a receiver cannot take a variadic parameter

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-14
- **Kind:** missing feature
- **Symptom:** compile error

## Reproduction

```wac
struct Box<T> {
  T v;
  i32 plus<Ts>(this, Ts ...xs) { return typeref(Ts).tupleMembers().len(); }
}

export i32 f() { Box<i32> b = Box(1); return b.plus("x", true); }
```

Expected: `f() = 2` — ch14 `§wac-variadic-tuple-sfevn82` is about "a parameter", not a function's.
Actual: *a method with its own type parameters cannot be called yet* — nothing packed the two arguments into
one tuple, so the method's `Ts` is matched against two arguments and binds nothing.

## Notes

Variadics are a source rewrite before parsing for real (`lowerVariadics` in `packages/wacc/src/api.wac`): a
call to a variadic name has its trailing arguments wrapped in a tuple. It works by name, so it can lower a
free function and, since 2026-10-14, a method with no receiver (`Box.count(…)`, `Box<i32>.count(…)` — keyed
`Owner.name`, which is the shape of core's `Ticket.all`). `x.plus(…)` cannot be lowered that way: which
`plus` it calls depends on `x`'s type, which text does not have. Packing has to move to a phase that knows the
receiver's type, or the call site has to be found some other way.
