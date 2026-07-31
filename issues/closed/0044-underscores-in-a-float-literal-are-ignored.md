# 0044 — underscores in a float literal silently give the wrong value

- **Status:** closed
- **Fixed in:** 26eb7e7
- **Fixed by:** agent-a, 2026-07-31
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** wrong answer
- **Covered by:** `§wac-float-underscore-4wnk8mq`

## Reproduction

```wac
export f64 a() { return 1_000.5; }   // 1
export f64 b() { return 1_000.0; }   // 1
export i32 c() { return 1_000; }     // 1000 — correct
```

Expected: `1000.5` and `1000`, matching the integer case.
Actual: both floats are **1**. No diagnostic.

## Cause

`parseFloat("1_000.5")` is `1` — it stops at the first character it cannot read, and returns what it
has rather than failing. Three places called it on the raw literal text: the emitter, the type
checker's f32 range check, and `wacConstEval`.

Integers were never affected because `wacIntLit` strips underscores, and that atom exists precisely
because the checker and the emitter had once disagreed about a literal's value. Floats had no
equivalent, so each of the three sites was independently wrong in the same way.

Found while implementing issue 0018 (accepting `1e9`): `1_000e3` was the underscore case in the new
test, and it returned 1.

## Fix

A `wacFloatLit` atom beside `wacIntLit`, used by all three sites. The parallel is the point — one
place interprets the text, so the three cannot drift, which is the lesson `wacIntLit` was written to
record.
