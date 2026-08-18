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

Both were one-line changes. `packages/wacc/test/wac/diagspans_test.wac` now pins them, and the two span
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
