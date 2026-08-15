# 0127 — wacc's `as!` saturates and rounds where the spec says it traps

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-14
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
export i32 c1() { i64 x = 5000000000; return x as! i32; }        // spec: traps
export i32 c3() { f64 x = 1.5; return x as! i32; }               // spec: traps (fractional)
export f32 c5() { i32 x = 16777217; return x as! f32; }          // spec: traps (not exact in f32)
export f64 c7() { i64 x = 9007199254740993; return x as! f64; }  // spec: traps (not exact)
export f32 c8() { f64 x = 1.0e300; return x as! f32; }           // spec: traps (not exact)
```

| case | spec, `casts.md:86–94` | wacc | reference |
|---|---|---|---|
| `i64 5000000000 as! i32` | traps | **2147483647** | traps |
| `f64 1.5 as! i32` | traps | **2** | traps |
| `i32 16777217 as! f32` | traps | **16777216** | traps |
| `i64 2^53+1 as! f64` | traps | **9007199254740992** | traps |
| `f64 1.0e300 as! f32` | traps | **Infinity** | traps |

The four cases that should succeed do: `7 as! i32`, `3.0 as! i32`, `16777216 as! f32` and
`0.5 as! f32` all give the right answer in both compilers.

## Why it matters more than a wrong number

`as!` is the **checked** cast. `casts.md` names three and the choice between them is the whole point:
`as` for a conversion that cannot lose, `as~` for "best approximation, never traps", and `as!` for
"I expect this to fit, and I want to know if it does not". A program that writes `as!` has asked to
be stopped. wacc gives it `as~`'s behaviour, so the one cast whose job is to fail loudly fails
silently, and the value it produces is a plausible one — `2147483647` for an out-of-range `i64`,
`2` for `1.5` — which is what makes it hard to notice downstream.

## Why nothing caught it

`casts.md:86–94` is a table of nine trapping rules with **no `[§tag]` anywhere near it**. It is the
largest single group in `issues/lang/0125`, which was filed an hour earlier for the refusal rules
that have the same problem — that sweep looked for *"is a compile error"* phrasing and did not look
for *"traps"*, so this table was outside it until the sweep was widened.

Reference recall cannot see it either: the reference is right here, and recall compares
**diagnostics**, not runtime behaviour. Nothing in the corpus evaluates an out-of-range `as!`.

## Where to look

The emitter is choosing the saturating opcode family where it should choose the trapping one —
`i32.trunc_sat_f64_s` in place of `i32.trunc_f64_s`, and the equivalent for the integer-narrowing and
float-narrowing cases. The four rows that pass are the ones where the two families agree, which is
exactly why a corpus of well-behaved values would never separate them.

`i32 -> f32` and `i64 -> f64` are worth care: wasm has no trapping opcode for those, so the check has
to be synthesized — convert, convert back, and trap if the round trip does not match. That is
presumably why the reference gets them right and why they were skipped.

## And the spec case that should exist

Nine rows, nine cases. Adding them is what stops this coming back, and they belong with `0125`'s
list rather than being a separate argument.
