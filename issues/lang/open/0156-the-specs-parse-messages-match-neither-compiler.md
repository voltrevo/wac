# 0156 — the spec's parse-error messages match neither compiler, and nothing compares them

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** diagnostic
- **Symptom:** wrong answer

## What the three say

`spec/spec/errors.md` opens its diagnostic section with *"Each tag below specifies the exact diagnostic
the compiler must emit, including span width, annotation text, and help text where shown"*, and then
shows rendered blocks. For the parse clauses, the **message** in those blocks is the specific thing:

| clause | the spec's message | wacc | the reference |
| --- | --- | --- | --- |
| `§wac-diag-parse-missing-semi-r7jm4xf` | `expected ';'` | `unexpected token` + annotation `expected ';', found 'i32'` | `expected ';', found 'i32'` |
| `§wac-diag-parse-missing-paren-k8fn3qp` | `expected ')'` | `unexpected token` + annotation `expected ')', found ';'` | `expected ')', found ';'` |
| `§wac-diag-parse-unexpected-q3kn8wp` | `unexpected token` + annotation `expected expression` | `expected an expression` + annotation `found ';'` | `expected expression, found ';'` |

So three different answers to the same question, and on the third clause wacc and the spec have the two
halves the other way round.

**Everything else about these diagnostics agrees.** Same phase, same line, same column, and the
information is complete on both sides — it is *where* each part is written that differs. That is the
whole of this issue, and it is why nobody noticed.

## Why nobody noticed

The differentials that cover parse errors compare **by position, not by text**, and say so:
`packages/wacc/test/parse_errors.test.ts` — *"Compared by count and position, not by message: the wac
side reports numeric codes and the reference reports English"*. That is a good decision for comparing two
compilers; it also means the spec's stated wording is checked by nothing at all for these clauses. Two
neighbouring cases found the same way on 2026-08-18 were real and are fixed:

- wacc's message for an unterminated string was `unterminated string`, where the spec, the reference and
  the recorded corpus all say `unterminated string literal`;
- wacc's annotation for an unknown type was `no type foo in scope`, where the spec quotes
  `unknown type 'foo'`.

Both were one-line changes. `packages/wacc/test/wac/specclauses_test.wac` now pins them, and the two span
clauses beside them.

## The decision

Not "make wacc match the spec", because the reference does not either and the README's parity row claims
*"the wording agrees where both speak"*.

- **Change both compilers to the spec.** The spec is the contract, and its split is defensible: the
  message names the rule (`expected ';'`) and the annotation says what it took to notice
  (`expected ';' after statement`). Cost: it moves the message on 282 of wacc's diagnostics — the
  `unexpected token` family — and the same on the reference's side.
- **Change the spec to what both compilers do.** Cheaper, and it would be recording practice rather than
  choosing it. The blocks would then have to be rewritten in a way that admits two spellings, which the
  document deliberately does not do anywhere else.
- **Say the message is illustrative and the fields are normative.** This is the smallest change and it
  is what the current state assumes. It needs a sentence in `errors.md` saying so, because the sentence
  there today says the opposite.

Whichever it is, the check that would keep it honest is the same: one test that reads the rendered blocks
out of `errors.md` and holds both compilers to them, rather than to positions. `spectags_test.wac`
already proves every clause is *mentioned* by something; mentioning is not comparing.

## All six parse clauses, measured — agent-a, 2026-08-21

The table above has three rows; the spec has **six** parse clauses. Here are all six — the original
three re-measured rather than copied, and the three nobody had measured — plus what pins each. The
point of finishing the enumeration: two of the six had never been compared against anything, and each
of those two turned out to say something the three known rows do not.

| clause | the spec | wacc | the reference | pinned by |
| --- | --- | --- | --- | --- |
| `…-unexpected-q3kn8wp` | `unexpected token` + `expected expression` | `expected an expression` + `found ';'` | `expected expression, found ';'` | nothing |
| `…-missing-semi-r7jm4xf` | `expected ';'` | `unexpected token` + `expected ';', found 'i32'` | `expected ';', found 'i32'` | nothing |
| `…-missing-paren-k8fn3qp` | `expected ')'` | `unexpected token` + `expected ')', found ';'` | `expected ')', found ';'` | nothing |
| `…-missing-brace-w5hd2jk` | `expected '}'` + `expected '}' to close block` + a **second label** | `unexpected token` + `expected '}', found 'eof'` | `expected '}', found ''` | nothing |
| `…-bad-struct-h9pd5wn` | `expected field or method declaration` + `expected type name`, **one** diagnostic | `expected a type` + `found '='` + a help, then two more — **3** | `expected type, found '='`, then two more — **3** | nothing |
| `…-bad-type-n7qm3xf` | `expected type` + `unknown type 'foo'` | agrees | agrees | `specclauses_test.wac` |

So five of the six are unpinned, and the one that is pinned is the one whose annotation the spec states
as normative in prose rather than only showing it in a block. That is the whole pattern: **what got
checked is what was written as a sentence, not what was drawn in a rendering.**

### Four things the new rows say that the first three do not

**1. On `missing-brace` the two compilers disagree with *each other*, not just with the spec.** wacc
says `found 'eof'` and the reference says `found ''` — the same fact, spelled two ways, in the
annotation. Every other row here has the two compilers agreeing on the annotation and differing from
the spec only in which half of the sentence it goes in. The README's parity row claims *"the wording
agrees where both speak"*; on this clause it does not, and no differential compares it because
`parse_errors.test.ts` compares by position. This is the cheapest thing on this page to fix and it
needs no decision: one of the two spellings is right and the other is a token name leaking into
prose.

**2. `missing-brace`'s block is the only place in `errors.md` with a secondary label** — `- block
opened here`, on the line that opened the block, above a `...` elision. Neither compiler emits it, and
wacc's diagnostic wire has one position per diagnostic so it *cannot*. That is not a wording question,
so it is filed separately as `issues/lang/0232a`, which found the same shape on
`§wac-diag-multiline-ic7x2hq` and has the measurement.

**3. `bad-struct` cascades in both compilers where the spec shows one diagnostic — and they cascade to
the same number.** Three each, all at 3:3: the reference says `expected type, found '='`, then
`expected member name`, then `expected ';' or '(' after member '?'`. So the count is not a
disagreement between the compilers, it is a disagreement between both of them and the block, which
draws one. Whether one syntax error in a struct body should produce one diagnostic or three is a real
question and a *different* one from the wording, because it is about how many rather than about what
they say. Worth its own decision if this issue's is ever taken.

**And a fourth, smaller thing:** on `unexpected` wacc's message is `expected an expression` where both
the spec and the reference say `expected expression`. An article, in the one row where wacc and the
spec have the two halves of the sentence swapped — so if that row is ever reconciled, it is the
spelling to reconcile *to*, and it would otherwise survive the reconciliation unnoticed.

### What is still true

The decision at the top of this issue is unchanged and this does not pre-empt it: the cost of "change
both compilers to the spec" grows with the count above rather than shrinking, since it is now five
clauses of the `unexpected token` family rather than three. The check that would keep any of the three
answers honest is still the one this issue names — read the rendered blocks out of `errors.md` and hold
both compilers to them.
