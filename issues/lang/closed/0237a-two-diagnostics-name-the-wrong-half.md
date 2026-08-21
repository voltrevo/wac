# 0237a — two diagnostics name the half of the rule that does not apply

- **Status:** closed — agent-a, 2026-08-21: split both, and the `>>>` half also removed a double
  diagnostic and a count disagreement with the reference
- **Fixed in:** `packages/wacc/src/check.wac` and `diag.wac`
- **Claimed by:** agent-a
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** diagnostic
- **Symptom:** wrong answer — a message that describes something the program did not do

## Two codes, each covering two faults

Found by walking the reference's rule tables against wacc one program per row — the exercise that
produced `issues/lang/0236a`. Both programs *are* refused; what is wrong is what they are told.

### `errReferenceOp` (code 43) — "this operator needs a reference"

```wac
struct P { i32 v; }
export i32 f(P p) { return p!.v; }
```

    wacc       error: this operator needs a reference
    reference  '!' unwrap requires nullable type, got P

`P` **is** a reference. The fault is that it is not *nullable*, and the message denies something the
program has. Its own doc comment states the conflation plainly — *"`is` or `!` applied to something the
question does not make sense for"* — and for `is` on a primitive the wording is exactly right, which is
presumably where it came from.

### `errShiftOp` (code 24) — "shift needs integer operands"

```wac
export u32 f(u32 x) { return x >>> 1; }
```

    wacc       error: shift needs integer operands
    reference  '>>>' is redundant on u32 — '>>' on an unsigned type is already a logical shift

`u32` **is** an integer. The fault is that `>>>` says nothing `>>` does not on an unsigned type — which
the reference explains, with a help line telling you to write `>>`. Code 24 is raised for `u32`, `u64`,
`f32` and `f64` in one condition, and the message fits only the floats.

## Why it matters more than a wording nit

Both messages assert something false about the program: *you did not give me a reference* when a
reference was given, *your operands are not integers* when they are. A reader who believes it looks in
the wrong place — and the second one has a help line, `shift a whole number by a whole number`, that
doubles down. A diagnostic that misdescribes is worse than a vaguer one, which is the same argument
`errTypeAsValue`'s rename rests on (`issues/lang/0235a`).

## Options

- **Split each into two codes.** `!` on a non-nullable gets *"this needs a nullable value"*; `>>>` on an
  unsigned gets the reference's sentence and its `use >>` help. Four small edits, and each message then
  names one thing. The cost is two more numbers in a table that has 203 of them.
- **Generalise each message** to cover both halves — *"this operator does not apply to that type"*.
  Cheaper, and it throws away the specific advice that makes a diagnostic worth reading.
- **Leave them.** Both programs are refused, so nothing is silent; only the explanation is wrong.

**Recommended: the first.** `issues/lang/0236a` already added a code rather than overloading
`errShiftOp` for exactly this reason, so the precedent is set and half the work is choosing the two
sentences — both of which the reference has already written.

## Not a gap in the rules

Worth stating, because the walk that found this was looking for gaps: every other row of the reference's
binary, unary, structural and nullable rule tables is enforced by wacc, with equivalent wording. These
two are the only rows where the *refusal* is right and the *reason* is not.

## Fixed

**The unwrap half** got a code of its own, `errNeedsNullable`, because the fault it names is the
opposite of the one it was sharing:

    before  error: this operator needs a reference
    after   error: this needs a nullable value
              --> n4.wac:2:29
               |
             2 | export i32 f(P p) { return p!.v; }
               |                             ^
              = help: a `T?`, which is what there is something to unwrap from

`is` on a primitive keeps the old code and the old wording, which was always right for it.

**The `>>>` half** needed no new code — narrowing the existing one was enough, and it fixed more than
the message:

    before  error: shift needs integer operands          (on `u32 x; x >>> 1`)
    after   error: `>>>` is redundant on an unsigned type
              = help: `>>` on an unsigned type is already a logical shift — write `>>`

Its condition listed `f32` and `f64` beside `u32` and `u64`, and a float is already the operand rule's
business. So `d >>> 1` on an `f64` reported **two** diagnostics where the reference reports one:

    wacc before  `shift needs integer operands` + `this operator does not take an operand of that kind`
    wacc after   `this operator does not take an operand of that kind`
    reference    `'>>>' requires an integer type, got f64`

One fault, one diagnostic, and the count now agrees. That the overlap existed at all is the same thing
this file's own comment warns about — *"a list that says it twice disagrees about how many things are
wrong"* — and it was invisible because nothing compares diagnostic **counts** between the compilers for
this shape; `parse_errors.test.ts` compares counts, but only for parse errors.

Verified: `cases` 225 of 225, `illtyped` 5 of 5, `binaryoperands`, `specclauses`, `renderdiag`,
`corpusMutate`, `checkSweep`, `emitSweep` and `mutateCheck` green, seed a fixed point.
