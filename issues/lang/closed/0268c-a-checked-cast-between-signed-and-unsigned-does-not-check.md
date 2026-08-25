# 0268c — `as!` does not check when the two types share a wasm value type

- **Fixed in:** `packages/wacc/src/emit.wac`, with `spec/cases/0224`–`0234`
- **Status:** closed — agent-c, 2026-08-25: two repairs, because it was two faults
- **Claimed by:** agent-c, 2026-08-25
- **Reported by:** agent-c
- **Date:** 2026-08-25
- **Kind:** bug
- **Covered by:** `spec/spec/casts.md`, which states the trap in a comment on the exact program
- **Symptom:** wrong answer — a value where the spec and the reference both require a trap

## Measured

    export u32 f() { i32 x = -1; return x as! u32; }

    wacc       returns 0, exit 0
    reference  main trapped — unreachable

`spec/spec/casts.md` is not ambiguous. `as!` "succeeds with the exact value or traps. No silent data
loss", and line 223 is this program:

    export u32 check(i32 x)  { return x as! u32; }   // traps if x is negative

Eight cells of the rung-4 generated sweep are in this state, and they are all and only the pairs that
share a wasm value type or reach one through a float:

    export u32 f() { i32 x = -1; return x as! u32; }                          ours 0
    export u64 f() { i64 x = -1; return x as! u64; }                          ours 0
    export i64 f() { u64 x = 0xffffffffffffffff; return x as! i64; }          ours 9223372036854775807
    export i64 f() { u64 x = 18446744073709551615; return x as! i64; }        ours 9223372036854775807
    export f32 f() { u64 x = 0xffffffffffffffff; return x as! f32; }          ours 1.8446744073709552e19
    export f64 f() { u64 x = 0xffffffffffffffff; return x as! f64; }          ours 1.8446744073709552e19

(the last two appear twice, once per spelling of the literal)

## Why

`emitCast` in `packages/wacc/src/emit.wac` guards a checked cast by converting, converting back, and
trapping when the round trip does not return the original. Its first line declines to do that:

```wac
if (op != kAsBang() || from == to || !isNumericTy(from) || !isNumericTy(to) ||
    valType(from) == valType(to)) {
  emitConversion(fb, env, from, to, op);
  return;
}
```

`valType(from) == valType(to)` is true for exactly `i32`/`u32` and `i64`/`u64` — one wasm value type
each — so the guard is skipped for the pairs whose whole difference is the range being checked, and
`emitConversion` for a same-valType pair emits nothing at all. **The bail is the bug**: it reads as
"nothing to convert", and what it means is "nothing to check".

The float rows looked like the other half of the same mechanism and are not — see *"The float rows
are saturation hiding inexactness"* below, written after measuring rather than reading. This paragraph
guessed that the conversion back used the signed instruction; it does not.

## Why nothing caught it

`packages/wacc/test/emitSweep.test.ts` compared an answer to an answer. When **wacc** trapped the
result became `threw: …` and mismatched, which is caught; when the **reference** trapped the cell was
skipped whole — `trapped++; continue;` — so a program where the reference refuses at runtime and wacc
quietly answers was outside the comparison. The count was printed as `54 trap` and read as agreement.

That asymmetry is fixed in the same change as this issue: the sweep now emits wacc's module for those
cells too and reports `N answered where the reference traps`. It is what found these eight.

## What a fix looks like

For a same-valType pair the check is a range test rather than a round trip:

    i32 -> u32   trap when the value is negative        i32.const 0,  i32.lt_s
    u32 -> i32   trap when it exceeds i32's maximum     i32.const 0x7fffffff, i32.gt_u
    i64 -> u64   trap when the value is negative        i64.const 0,  i64.lt_s
    u64 -> i64   trap when it exceeds i64's maximum     i64.const 0x7fffffffffffffff, i64.gt_u

That half is done. The float rows need something else, and the section below says what.

Both halves are in one function, which is the good news; the emitter is also where a wrong guard costs
an invalid module rather than a bad diagnostic, so the sweeps are the thing to run — `emitSweep`,
`specEmit`, `corpusemit_test`, and the `--checked` pair in `checked_test.wac`, which asserts that a
default build is byte-identical and would notice a guard emitted where none belongs.

## Not `--checked`

`--checked` is about add, subtract and multiply trapping on overflow, and is a whole-module flag. This
is `as!`, which traps in every build by definition — the spec's word for it is "checked" too, which is
worth keeping apart when reading either.

## Four fixed, four left, and they are not the same fault — agent-c, 2026-08-25

`emitCast` gets a branch before its bail: for `as!` between two integer types of one wasm width, a
**range test** rather than a round trip — negative into unsigned, or above the signed maximum into
signed. The round trip cannot work there because there is nothing to convert.

    export u32 f() { i32 x = -1; return x as! u32; }        traps
    export u64 f() { i64 x = -1; return x as! u64; }        traps
    export i64 f() { u64 x = 0xffffffffffffffff; … as! i64 } traps

`spec/cases/0224` and `0226` run those, with `0225` — `check(5)` returns `5` — beside them so the trap
is a range test and not a refusal of the conversion. Both trap cases failed before the change and pass
after: the corpus went **226 of 228** to **228 of 228**.

### What the old comment claimed

The bail carried a justification: *"It is also the right answer rather than only the cheap one:
`casts.md:86–94` lists nine trapping rows and not one of them has the same wasm value type on both
sides."* True of that table — it is the cross-width and float one — and the same-width signedness
change is specified separately at `casts.md:215–230`, with a clause naming the program:
`[§wac-usign-chk-p8jn3wl]`, *"`check(-1)` traps"*. Generalising from one table over a section it does
not cover is what left this answering 0 for as long as it did. The saving the comment measured is
real and is kept for the cases that genuinely carry no check.

### The float rows are saturation hiding inexactness

    export f64 f() { u64 x = 18446744073709551615; return x as! f64; }   ours 1.8446744073709552e19

Here the value types *do* differ, so the round trip is emitted, and both halves of it are already
signedness-correct — `emitConversion` picks `f64.convert_i64_u` going out and `i64.trunc_sat_f64_u`
coming back. The round trip still returns the original: `u64`'s maximum rounds **up** to 2^64 in an
`f64`, and the saturating truncation clamps that back to `u64`'s maximum. So the guard compares the
value with itself and sees no loss, exactly where the loss is.

`casts.md:64` says `as!` "traps unless x has an exact f32 value", so these should trap. The check
cannot be a round trip through a saturating instruction — it needs to ask whether the float is exactly
representable, which a comparison against 2^64 or a non-saturating truncation would answer. That is a
different repair from the one above and is why this issue stays open rather than closing at half.

`emitSweep` prints `N answered where the reference traps` and lists them: **8 before, 4 now.** It is
still a print rather than an assertion, for the reason given when it was added — the number should not
be able to grow quietly, and it cannot be pinned at zero until these four are done.

## The float rows, and the count was low — agent-c, 2026-08-25

The round trip comes back from the float with the **trapping** truncation now — `i64.trunc_f64_u` and
its seven siblings — where `emitConversion` gives the saturating one. Saturating is right for `as~`
and is what made the guard blind: `u64`'s maximum rounds *up* to 2^64 in an `f64`, the clamp puts it
back on the original, and the comparison sees no loss exactly where the loss is. The trapping form
refuses the out-of-range value itself, and a value that merely rounds still comes back different and
is caught by the comparison that was always there.

**The sweep undercounted.** It reported four float cells; the generator does not produce every pair,
and two more fell out of checking what the change would newly affect:

    export f64 f() { i64 x = 9223372036854775807; return x as! f64; }   was 9223372036854776000
    export f32 f() { u32 x = 4294967295;          return x as! f32; }   was 4294967296

Both trap on the reference. So the whole fault was ten rows, not eight, and the two nobody had seen
were found by asking *what else does this touch* rather than by the instrument. `spec/cases/0230`,
`0231` and `0233` run them, each with a control beside it — `0232` and `0234` — so the trap is an
exactness test rather than a refusal of the conversion.

Checked before changing anything: `16777217 as! f32` already trapped and still does, `5 as! f64`
answers 5 on both, and `2147483647 as! f64` is refused at compile time by *both* compilers, which say
to use `as` — it is lossless, so `as!` is the wrong spelling rather than a failing one.

Nothing in the repository outside `spec/` uses `as!` to a float, so no package could depend on the old
answer.

### One rule was two, and the comment said one

`emitCast`'s header said *"The check is one rule for every row: convert, convert back, compare, trap
if they differ."* Two families cannot be checked that way, both because the round trip returns the
original without the value having survived — same width with nothing to convert, and a saturating
truncation that clamps. The header says that now, and names both.

