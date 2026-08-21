# 0236a — bitwise and shift operators accepted non-integer operands, and two shapes emitted invalid wasm

- **Status:** closed — agent-a, 2026-08-21: the checker asks for an integer now; found by checking the
  reference's rule table row by row against the implementation instead of only reading it
- **Fixed in:** `packages/wacc/src/check.wac`, with four rows in `illtyped_test.wac`
- **Claimed by:** agent-a
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** bug
- **Symptom:** invalid wasm, with the checker reporting nothing

## Reproduction

Four programs. All four checked clean; the reference refuses all four.

| program | wacc `check` | `wac build` | the reference |
| --- | --- | --- | --- |
| `return 1.5 & 2.5;` | **clean** | wrote a module | `'&' requires i32 or i64, got f64` |
| `return x & 1.5;` | **clean** | **invalid wasm** | `'&' requires i32 or i64, got f64` |
| `return "a" << 1;` | **clean** | declined by the emitter | `'<<' requires an integer type, got string` |
| `return x << "a";` | **clean** | **invalid wasm** | `'<<' requires an integer shift amount, got string` |

The invalid ones are caught by the validator `wac build` runs, which says what it is:

    zz.wasm: 4342 bytes from 1 file(s)
    rejected zz.wasm
    wac: the build wrote zz.wasm and the engine will not load it, so the compiler emitted something
         invalid rather than refusing the program

and `wacland` names the fault: *"Invalid input WebAssembly code at offset 1028: type mismatch: expected
i32, found (ref $type)"* — the string pushed where the shift wanted an `i32`.

**Three of the four were accepted by *both* halves**, which `illtyped_test.wac`'s pair claim exists to
catch and which the canary demonstrates: with the rule removed, `a19`, `a20` and `a22` fail
`test_no_program_here_is_accepted_by_both_the_checker_and_the_emitter`.

## The cause

`checkExpr`'s `Binary` arm has an `arith` group that includes `& | ^` and asks only that the operands
are not `bool`, not a reference and not a `string`. A float is none of those, so it passed. Shifts are
**not in that group at all** and were asked nothing beyond one special case — `>>>` on an unsigned or
float type, which is a different rule.

The reference states both requirements, and they are narrower than "a number":

    if (op === "&" || op === "|" || op === "^") { if (!isInteger(lt)) … }
    if (op === "<<" || op === ">>" || op === ">>>") { if (!isInteger(lt)) … if (!isInteger(rt)) … }

## Why reading the rule table was not enough

`issues/lang/0170a` item 2 extracted this exact table out of `checkBinaryOp` a few hours earlier, and
used it — for `typeOfE`'s *inference*. It never asked whether each row was **enforced**. Two of the
seven were not.

So the lesson is narrower than "read the reference": extracting a rule table is half the work, and the
other half is walking it against the implementation, one row at a time. The rows are cheap to test —
one line each — and two of eight turned out to be silent.

## The fix, and why `isIntegerName` is the whole set

One condition, at the operator, with a code of its own rather than joining `errShiftOp`: that code
already answers two questions (`>>>` on an unsigned type, which *is* an integer and is merely
redundant, and `>>>` on a float, which is not one), and a third meaning would leave the message unable
to name any of them.

`isIntegerName` — `i32`, `i64`, `u32`, `u64` — is every integer *expression* in the language: a packed
type cannot be a parameter or a field (`a packed type cannot be used in this position`), and reading one
out of an array yields an `i32`. Measured before the rule was written, because a narrower set would have
refused working code: `b[0] & 15`, `b[0] << 2`, `x & 255` on a `u64` and `b[0] << n` all still check
clean, and that pattern appears across `ssh`, `tor` and `box`.

`nl`/`nr` rather than the resolved types alone, so a literal — which has no type until something gives
it one — is filled in by `naturalTypeOf` instead of reading as unknown and skipping the check.

## Verified

- The four programs are refused, at the operator, with a caret and a help line.
- The packed and integer controls above still check clean, as does `6 & 3`.
- Canaried by disabling the condition: all four rows fail the refusal claim and three fail the
  accepted-by-both claim.
- Seed a fixed point with all three payloads; `cases` 225 of 225, `illtyped` 5 of 5,
  `binaryoperands`, `specclauses`, `corpusMutate`, `checkSweep`, `emitSweep`, `mutateCheck` and
  `parse_errors` green.

## Also noticed

`errShiftOp`'s message is *"shift needs integer operands"*, and it is reported for `>>>` on a `u32` —
where the operand **is** an integer and the real complaint is that `>>>` says nothing `>>` does not.
One code, two faults; the message names the half that does not apply to the commoner case. Not fixed
here because it wants its own wording decision, and it is now the only meaning of that code that is
misdescribed.
