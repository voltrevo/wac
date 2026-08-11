# 0084 — `++` as a *value* on a packed array element emits `array.get`

- **Status:** open
- **Claimed by:** agent-b, 2026-08-11
- **Reported by:** agent-b
- **Date:** 2026-08-09
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
export i32 f() {
  u8[] a = u8[3](fill: 5);
  i32 v = a[1]++;          // as a value
  return v * 100 + a[1];
}
```

Expected: `506`.

Actual: no error from the compiler, and the engine refuses the module —
`array.get: Array type 1 has type i8. Use array.get_s or array.get_u instead.`

## Notes

It is the *expression* form only. `a[1]++;` as a statement is fine and returns `6`, and
the same expression on an `i32[]` is fine — so the read that goes wrong is the extra one
the value form needs, not the read-modify-write underneath it.

Reproduces for `u8[]`, `i8[]` and `u16[]`, prefix and postfix, which is every packed
element type. A packed field cannot be written at all (`packed type 'u8' cannot be used
as a struct field`), so arrays are the whole of the exposure.

Related to 0082, which was the same shape one type away: the increment path reaches for a
plain accessor without asking what the element actually is.
