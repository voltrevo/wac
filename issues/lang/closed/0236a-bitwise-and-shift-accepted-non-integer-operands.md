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

## Correction: the rule already existed, and the fix is two lines in it

The section above describes adding a rule and a diagnostic code. **That was wrong, and it was
duplication.** The rule was already there, forty lines below where I stopped reading:

```wac
// The bitwise operators want *integers*, which is a narrower demand than "numeric": `a & b` on
// two `f64`s is refused although the two agree, so the same-type rule below never sees it. A
// shift asks it of both sides separately — the value being shifted and the amount to shift by.
bool bitwise = k == kAnd() || k == kOr() || k == kCaret();
bool shift = k == kShl() || k == kShr() || k == kShrU();
if (bitwise || shift) {
  string lt2 = typeOfExpr(c, left);
  string rt2 = typeOfExpr(c, right);
  bool badL = lt2 != typeNone() && !isIntegerName(lt2);
  ...
```

Its comment states the intended rule exactly. What it could not do is **see a literal**: `typeOfExpr`
answers unknown for `1.5`, so `badL`/`badR` stayed false and the guard skipped the very cases this issue
is about. The two lines beside it already solved that problem for the comparison rules —

    string nl = alt != typeNone() ? alt : naturalTypeOf(c, left);

— with a comment saying why. So the fix is to use `nl`/`nr` in the guard, and nothing else: no new code,
no new message, no new hint.

**And the duplicate had a cost that showed up immediately.** With both rules live, `d >>> 1` on an `f64`
reported *three* diagnostics for one fault — mine, the pre-existing operand rule, and `errShiftOp` — in
a file whose own comment records that this was fixed once already: *"nine diagnostics over six lines
where the reference gives six … a list that says it twice disagrees about how many things are wrong."*
Each of the four cases now reports exactly one.

Two lessons, and the second is the one I keep paying for:

- **Read to the end of the construct before adding to it.** I read the `Binary` arm from its start to
  the string rule and stopped about forty lines short. The rule I wanted was in view of a longer scroll.
- **A rule that does not fire is not a missing rule.** Three programs were silent, and I concluded the
  check was absent when it was present and blind. The distinguishing question — *is there a guard here
  that cannot see my case* — costs one grep for the operator kinds and would have found it.

`f64 >>> 1` still reports two, and that pair is pre-existing: `errShiftOp` lists `f32`/`f64` alongside
`u32`/`u64`, so it fires beside the operand rule for floats. That overlap is `issues/lang/0237a`.

## The rest of the table, walked

The lesson above is only worth stating if I then did the second step, so here it is: one program per
remaining row of `checkBinaryOp` and the unary rules beside it.

| row | program | wacc |
| --- | --- | --- |
| `+` with a string and a non-string | `"a" + 1` | `operands have mismatched types` |
| comparison, string against non-string | `"a" < 1` | `these types cannot be compared` |
| comparison on a reference | `a == b` on two `P` | `these types cannot be compared` |
| `&&` on a non-bool | `1 && true` | `condition must be bool` |
| `\|\|` on a non-bool | `x \|\| true` | `condition must be bool` |
| bitwise on mismatched widths | `a & b`, `i32` and `i64` | `operands have mismatched types` |
| `>>>` on an unsigned | `x >>> 1`, `u32` | refused — but see the note below |
| `%` on a string | `s % 2` | `this operator does not take an operand of that kind` |
| `!` on a non-bool | `!x`, `i32` | `this operator does not take an operand of that kind` |
| `~` on a bool | `~b` | `this operator does not take an operand of that kind` |
| `~` on a string or float | `~s`, `~d` | same, once the return type does not mask it |
| **control** | `a % b == 0`, `6 & 3`, `b[0] & 15` | clean |

And four more clusters beside the operators, one program per row:

| cluster | rows tried | result |
| --- | --- | --- |
| structural | a struct holding itself non-null, a duplicate field, an override without `override` | all three refused, wording equivalent to the reference's |
| nullable | a field on a `P?`, returning `P?` as `P`, `i32?` as `i32`, `!` on a non-nullable | all four refused |
| call and construction | too few arguments, no such method, too many arguments to a method, a named construction with an unknown field, one with a field missing | all five refused |
| casts | `x as i32` (redundant), `s as i32` (a reference), `x as~ i64` (lossy not needed), `p as! Q` (no shared ancestor) | all four answered, the last as a warning as the reference does |

So every other row is enforced, and the two this issue fixed were the only silent ones. Worth the
twenty minutes: without the walk, "I read the reference's table" would have been the last word, and it
was the thing that hid these.

One row is enforced by accident of ordering rather than by its own rule: `~s` inside a function whose
return type disagrees is reported as *"return type does not match the function's"*, and only when the
return type matches does the operand rule speak. Both refuse the program, so nothing is silent — but a
reader gets pointed at the return type for a fault in the operand, which is worth knowing if anyone is
ordering these diagnostics later.
