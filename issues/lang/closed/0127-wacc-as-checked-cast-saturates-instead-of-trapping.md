# 0127 — wacc's `as!` saturates and rounds where the spec says it traps

- **Status:** closed
- **Fixed in:** 84dfc582
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

## The fix is not the dead code that is sitting there

`emit.wac`'s `emitConversion` already receives the operator — `kAsBang()` is 33 and the `i31ref`
branch above already distinguishes it, with a comment saying *"the check below is what makes `as!`
checked"*. And a few lines down there is an `if (false) { … }` block holding exactly the trapping
trunc opcodes, 168–171 and 174–177. It reads as a fix waiting to be switched on.

**It is not, and enabling it would ship a different wrong answer.** `i32.trunc_f64_s` truncates
toward zero and traps on *range* and NaN only — it does not trap on a fractional part. So it would
turn `1.5 as! i32` from `2` into `1`, and the spec says that row traps.

Every row therefore needs a synthesized check rather than an opcode swap:

- **float → int**: value is integral *and* in range, else trap.
- **`i64 -> i32`**: in range, else trap — `i32.wrap_i64` never traps.
- **int → float, `f64 -> f32`**: a round trip, since no opcode can express "is this exactly
  representable".

That is the whole of the work, and it is why the dead block should be **deleted** as part of it
rather than revived: it encodes an answer that was already not the rule.

### One rule covers every row: round trip and compare

The three bullets above look like three different checks and they are one:

> convert with the opcode wacc already emits, convert **back**, compare with the original, and trap
> if they differ.

Every failing row falls out of it, including the two that looked hardest:

| value | forward | back | equal? |
|---|---|---|---|
| `i64 5000000000 as! i32` | wrap → 705032704 | extend → 705032704 | no → trap |
| `f64 1.5 as! i32` | trunc_sat → 1 | convert → 1.0 | no → trap |
| `i32 16777217 as! f32` | convert → 16777216.0 | convert → 16777216 | no → trap |
| `i64 2^53+1 as! f64` | convert → 2^53 | convert → 2^53 | no → trap |
| `f64 1.0e300 as! f32` | demote → inf | promote → inf | no → trap |

and every row that should succeed round-trips equal, so it passes untouched. The fractional case
needs no separate test — `1.5` truncates to `1` and `1.0 != 1.5` — and NaN handles itself, since
`trunc_sat` gives 0, `0.0` converts back to `0.0`, and `NaN != 0.0`. Not being equal to anything,
including itself, is the property that makes the comparison right here rather than a special case.

The cost is a scratch local of the source type and about ten instructions per checked cast, which is
what `as!` is asking for. `as~` and `as@` keep the single opcode they emit now.

## Fixed — 84dfc582

The round trip above, in `emitCast` beside `emitConversion`. All nine rows match the reference; `as~`
and `as@` are unchanged, checked against the arithmetic grid that found this. Six cases in
`spec/cases` (0151–0156), canaried by reverting the emitter change and watching them fail. 1,649
tests across nineteen packages, plus wacc's 188 and the spec suite's 530.

The dead `if (false)` block is **gone**, deleted separately after the fix landed. It read like the
fix and was not one, so a comment stands where it was saying why — the next reader should not have to
rediscover that `i32.trunc_f64_s` does not trap on a fractional part.

**And one thing the fix got wrong first**, which is the same shape as the bug it was fixing. The
numeric test asked `valType(t)`, and that helper answers 127 — `i32` — for every type it does not
recognise. So structs, strings and arrays all looked numeric, reference downcasts were wrapped in an
`i32.eq`, and four spec tags emitted invalid wasm. A default that silently means something, found by
the suite rather than by reading. The types are named explicitly now, so anything unlisted keeps the
behaviour it had.

## And the spec case that should exist

Nine rows, nine cases. Adding them is what stops this coming back, and they belong with `0125`'s
list rather than being a separate argument.
