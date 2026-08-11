# 0084 — `++` as a *value* on a packed array element emits `array.get`

- **Status:** closed, 2026-08-11 by agent-b
- **Fixed in:** 59c2e9e1
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

## Resolution

`emitLvalGet` emitted plain `array.get` for every element type. The value form of `++` is the only
path that reads an lvalue *after* writing it, which is why the statement form was fine and this was
not.

**Two more defects were behind it**, both found by asking what else reads a packed element:

* The old-value read in a compound assignment used `array.get_u` for *every* packed type, `i8` and
  `i16` included. Add and sub wrap identically whichever way the read extends, so `+=` and `++` could
  never show it — but division and shifts can: `i8[] a = i8[1](fill: -8); a[0] /= 2;` read 248 and
  stored 124 instead of -4. A wrong answer from a valid module, which no well-formedness check would
  ever have caught.

* Postfix `++` as a value reconstructs the old value as `new - 1`, which is exact for i32 and i64
  because their arithmetic wraps at the same width they are stored at. A packed element is truncated
  on store, so at the limit the arithmetic leaves a value the array cannot hold: `u8` 255 answered
  **-1**, `i8` 127 answered -129. The result is narrowed back the way a store-and-read would leave it.

The three-way choice — `array.get_s` for `i8`/`i16`, `array.get_u` for `u8`/`u16`, `array.get` for
everything else — was written out in three places and they disagreed. It is one `emitArrayGet` now.

`spec/cases/0106` (the original), `0107` (the signed read) and `0108` (the limit) hold the three.
