# 0232a — the diagnostic wire cannot carry `contextStart`, so one clause renders short, and the renderer differential cannot see it

- **Status:** closed
- **Closed by:** agent-a, 2026-08-21 — the recommended option, a tenth wire field
- **Fixed in:** `packages/wacc/src/check.wac`, `src/api.wac`, `src/render.wac` and
  `tools/wireDiagnostics.ts`, with three new cases in `packages/wacc/test/wac/renderdiag_test.wac`
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** diagnostic
- **Symptom:** wrong answer

## What the three say

`§wac-diag-multiline-ic7x2hq` is the spec's multi-line span clause. Its rendered block shows the two
lines *above* the caret, which is the whole point of the clause — a caret under `3.14` says nothing
about which call it is an argument to.

Measured on the same program, 2026-08-21:

**The reference** — `wacDiag`, rendering its own compile:

    error: type mismatch: expected i32, got f64
       --> algo.wac:14:7
        |
     12 |     i32 result = compute(
     13 |       x,
     14 |       3.14
        |       ^^^^ expected i32, found f64

**wacc** — `wac check algo.wac`:

    error: argument does not match the parameter's type
       --> algo.wac:14:7
        |
     14 |       3.14
        |       ^^^^ expected i32, found f64

Same position, same span, same annotation, character for character on the caret line. **Two source
lines missing**, and they are the ones the clause exists for.

## Why: the wire has no field for it

`render.wac`'s header says what crosses:

> `diagnoseFiles` answers `file\tline\tcol\tphase\tmessage\tnote\thint\twidth` per line, because a
> boundary carries strings rather than structures.

**That comment is one field out of date, and counting instead of reading it is what makes the
recommendation below cheap.** `render.wac` reads indices 0, 1, 2, 4, 5, 6, 7 **and 8** — nine fields,
the ninth a severity marker (`field(line, 8) == "warning"`) added after the comment was written. So
the wire has been extended once already; a tenth field is precedent rather than novelty. The comment
is fixed in the same commit as this filing.

Nine fields, one position. The reference's `DiagError` has something none of them holds:

```ts
/** If set, show source lines from this line through e.line (for multi-line spans). */
contextStart?: number;
```

It is set — `compiler/wacSpec.test.ts`'s test for this very clause asserts
`eq(e.contextStart, 4, "contextStart points back to the compute( line, not left undefined")`, and the
run above shows `contextStart: 12` for the equivalent program. `wacDiag` then loops
`for (let ln = contextStart; ln < lineNum; ln++)` and prints them. wacc's renderer cannot, because
nothing told it where to start.

**This is not the span decision.** `check.wac`'s `widthBetween` already considered this clause and
decided a span is a single-line measurement — *"an expression that runs across lines has no width this
can state … which is a decision for the formatter rather than a number for the wire"*. That is right,
and it is about **width**. The missing thing is **where to start printing**, which is a number for the
wire and the one it does not have.

## Why nothing caught it: the differential flows through the wire

`packages/wacc/test/wac/renderdiag_test.wac` compares wacc's renderer against `wacDiag` *"character
for character"*, which is exactly the check that should own this. It cannot see it, and its own header
says why:

> **The wire crosses rather than being recomputed.** Both sides render from the *same*
> `diagnoseFiles` output, which this file computes once and sends. Letting the oracle produce its own
> would compare two compilers' opinions about what to refuse, and a disagreement there would arrive
> looking like a layout bug.

That reasoning is sound and it is also the blind spot: the oracle is handed **wacc's** nine fields, so
`contextStart` is `undefined` on the way in and both renderers omit the same two lines and agree
perfectly. A field the wire cannot express is a field the differential cannot compare — whatever
programs are added to it.

And none of its five cases is a multi-line span. The case named *"a gutter that has grown"* pads to
line 12 with `filler()`, which is about the gutter's **width**, not about context lines — the nearest
thing to this case, testing the neighbouring property.

## The spec block's own header disagrees with both compilers

While measuring: the block reads

    error: incompatible argument type
       --> algo.wac:12:5

with the caret drawn on line 14. Both compilers answer **14:7** — the caret line — and the reference's
clause test asserts the same (`eq(e.line, 6, "error reported on the 3.14 line")`). `errors.md`'s own
field list is *"file, line, column, span length"*, one position, and it is the caret's. So `12:5` is
the construct's start written into a field that means the caret, and it is the outlier against two
compilers and the reference's own test. Fixed in the same commit as this filing.

The block also prints a trailing ` 15 |     );` that neither renderer emits — `wacDiag` stops at the
caret line. Left alone here, because "should a multi-line span show the line after it" is a real
question and not a typo like the header was.

## The decision, and a recommendation

The work is small and the shape of it is the question:

- **Add a tenth wire field** (`contextStart`, empty when unset) and have `render.wac` print the
  intervening lines. Every producer and `packages/wacc/tools/wireDiagnostics.ts` must agree on the
  count at once, and `renderdiag_test.wac` needs a multi-line case — which will then be comparing
  something, because the field will survive the crossing.
- **Derive it in the renderer** from the call's own start, without a wire change. Cheaper, and wrong
  for the same reason the width is not guessed: the renderer does not know what construct the
  diagnostic came from, so it would be inferring a number the checker already had.
- **Drop the context lines from the spec**, making the clause the same as any single-line span. Then
  `§wac-diag-multiline-ic7x2hq` has nothing left that distinguishes it and should go, which is a real
  answer for a language with no users — but it discards the information the clause was added for.

**Recommended: the first.** The checker knows the construct's first line at the point it reports, the
reference has carried the field for long enough to have a test for it, and the second option's
"derive it" is the guess this repository keeps removing. The cost is one field and one new case in
`renderdiag_test.wac`; the payoff is that the case can fail.

## Related

- `issues/lang/0156` — the parse clauses' *message* wording matches neither compiler. Same document,
  same "nothing compares the text" root, and a different kind of disagreement: that one is about which
  half of the sentence a string goes in, this one is about a number that has nowhere to go. The five
  clauses measured while filing this are recorded there.
- `issues/system/0161` — moved this comparison host-side, which is what made it a differential at all.

## Closed — the field exists and the differential can now fail, 2026-08-21

The recommended option, and the order it was done in is the point: **the instrument first, then the
mechanism.**

1. `check.wac` records it. An `errorContexts` table beside `errorNotes` and `errorWidths`, and one
   method — `contextAt(before, argLine, callLine)` — holding the reference's single condition, *"if the
   argument sits on a later line than the call opens on"*. It takes both lines so that the condition is
   written once; wacc has **three** argument-checking functions where the reference has one, and a rule
   spread over three sites reaching three different report methods is how a rule comes to be enforced
   five ways. Called after the report with the count taken before it, because a report can decline —
   quiet while an import is walked, past the cap, or collapsed as a repeat — and then there is no slot.
2. `api.wac` puts it on the wire, **only on the rows that have one.** The wire is positional and
   already ragged: an error stops at `width`, a warning carries `severity`. Appending a tenth field
   unconditionally would have rewritten every diagnostic in the repository for the sake of the few with
   a context; appended this way, every existing line is byte-identical and no other consumer moves.
3. `wireDiagnostics.ts` passes it to the oracle — **and this is what made the test able to fail.**
   `renderdiag_test.wac` hands *wacc's* wire to both renderers, so until the field could survive the
   crossing both omitted the same two lines and agreed perfectly. With the field crossing and the
   renderer still ignoring it, the differential said:

       an argument on a later line than its call — line 4 differs:
         render.wac " 4 |     3.14",  wacDiag " 3 |   i32 result = compute("

   That was the state to reach before writing any rendering code.
4. `render.wac` prints the intervening lines, and pads the line number to the caret line's width the
   way `wacDiag`'s `padStart` does — invisible in every existing case, because the caret's own number is
   what the width was measured from, and needed the moment a context line is shorter (line 9 above 10).

Now:

    error: argument does not match the parameter's type
      --> algo.wac:4:5
       |
     3 |   i32 result = compute(
     4 |     3.14
       |     ^^^^ expected i32, found f64

**Three cases, not one.** wacc's three argument paths — plain call, method call, funcref call — all
carry it now, and all three agree with the reference character for character. That the reference agreed
on the method and funcref cases was a question rather than an assumption: it sets `contextStart` at one
site, and whether its method calls reach that site was answered by adding the cases and running them,
not by reading.

**Two stale field counts fixed while counting.** `render.wac`'s header said nine (right) and the
oracle's said eight (wrong); the count is now ten in one and unnumbered in the other, because a sentence
that has to be revised whenever the wire grows is a sentence that will be wrong again.

Left alone deliberately: the spec block's trailing ` 15 |     );`, which neither renderer emits. Whether
a multi-line span should show the line *after* it is a real question, unlike the `12:5` header that was
fixed when this was filed.
