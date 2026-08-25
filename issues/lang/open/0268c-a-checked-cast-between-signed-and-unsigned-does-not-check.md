# 0268c — `as!` does not check when the two types share a wasm value type

- **Status:** open
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

The float rows are the other half of the same mechanism. There the value types *do* differ, so the
round trip is emitted — but converting back from `f32`/`f64` to `u64` uses the signed conversion, so
the comparison is against the wrong value for anything above `i64`'s range.

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

and for the float rows, the conversion back has to be the *unsigned* one when the integer side is
unsigned. `emitConversion(fb, env, to, from, 0)` is where that choice is made.

Both halves are in one function, which is the good news; the emitter is also where a wrong guard costs
an invalid module rather than a bad diagnostic, so the sweeps are the thing to run — `emitSweep`,
`specEmit`, `corpusemit_test`, and the `--checked` pair in `checked_test.wac`, which asserts that a
default build is byte-identical and would notice a guard emitted where none belongs.

## Not `--checked`

`--checked` is about add, subtract and multiply trapping on overflow, and is a whole-module flag. This
is `as!`, which traps in every build by definition — the spec's word for it is "checked" too, which is
worth keeping apart when reading either.
