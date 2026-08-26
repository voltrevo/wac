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
| `…-unexpected-q3kn8wp` | `unexpected token` + `expected expression` | `expected an expression` + `found ';'` | `expected expression, found ';'` | `specclauses_test.wac`, as practice |
| `…-missing-semi-r7jm4xf` | `expected ';'` | `unexpected token` + `expected ';', found 'i32'` | `expected ';', found 'i32'` | `specclauses_test.wac`, as practice |
| `…-missing-paren-k8fn3qp` | `expected ')'` | `unexpected token` + `expected ')', found ';'` | `expected ')', found ';'` | `specclauses_test.wac`, as practice |
| `…-missing-brace-w5hd2jk` | `expected '}'` + `expected '}' to close block` + a **second label** | `unexpected token` + `expected '}', found 'eof'` | `expected '}', found ''` | `specclauses_test.wac`, as practice |
| `…-bad-struct-h9pd5wn` | `expected field or method declaration` + `expected type name`, **one** diagnostic | `expected a type` + `found '='` + a help, then two more — **3** | `expected type, found '='`, then two more — **3** | `specclauses_test.wac`, as practice |
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
both compilers to them.## A seventh clause, outside `errors.md`, and not this decision — agent-c, 2026-08-25

`§wac-keyword-name-8wnq4kp` in `spec/spec/naming.md` is a parse-message clause too, and it is **not**
one of the six above. The six share a diagnosis this page states in a sentence: *"nobody is missing
information; they disagree about which field it goes in."* On this one wacc was missing the
information outright — all nine name positions answered `unexpected token`, naming no keyword in the
message, the annotation or the help:

    export i32 go(i32 match) { ... }   // wacc: unexpected token
                                       // ref:  'match' is a keyword and cannot be used as a
                                       //       parameter name

Against a spec clause that says *"A keyword in a name position is an error that names the keyword and
points at it"*, and a section that goes on to say *"the wording is part of the rule rather than a
courtesy"* — with the reason, which is that `from` was once reserved and a parameter called `from`
reported a missing semicolon a hundred lines further on, braces balanced.

So it is fixed rather than tabled, and this page's own criterion is why: *"what got checked is what was
written as a sentence, not what was drawn in a rendering."* This one is written as a sentence.

**It cost the decision nothing**, which is the part worth checking before anyone reads this as
pre-empting the list above. The message moves and the positions do not: all nine were measured
against the reference before the change and agreed to the column, and the change adds a code and a
note without touching what the parser consumes. The one site that could not go through `declName` is
the type-parameter name, because `declName` consumes the keyword and the reference does not consume it
there — consuming would move every later diagnostic in the file and trade a better message for a
rung-3 contradiction. That site gets the message and keeps its control flow.

`packages/wacc/test/wac/specclauses_test.wac` pins all nine, beside the five rows this page left
unpinned.

### How it was found, which is the reusable part

Not by reading `naming.md`. `specCases.json` records an expected message for 332 refusal cases and the
spec-case runner only checks that the program is *refused*, so a wrong message is invisible to the one
harness that has the right string sitting in front of it. Sweeping all 317 single-file cases and
comparing text turned this up.

**The sweep is mostly noise and should not be added to the suite as written**: 264 of 317 "differ",
because wacc's checker wording was deliberately moved away from the reference's, so inequality is the
normal case. The signal was one subset — cases where wacc answers a *generic parse error* and the
other side has a designed message. That was 42 cases, 34 of them the mechanical `expected 'X', found
'Y'` family this page already covers, and 8 real: seven keyword-name positions and
`'override' is not allowed on an enum method`. All eight are fixed here.

Two more came from following those rather than from the sweep, which is the argument for reading
*around* a finding: a keyword as a **type parameter** name and as the target of a **field write** are
name positions the recorded cases happen not to contain, and both answered `unexpected token` too —
nine in total. And beside the `override` case sat `i32 make() { … }`, an enum method with no `this`,
which was not vague but **wrong**: `perrMethodName` was carrying two faults, so it answered *"expected
a method name"* and pointed at `{`, naming the one thing about that declaration that was correct.


## 2026-08-26: all six are pinned now, and that changes what the decision costs — agent-a

The table above still reads `pinned by | nothing` for five of the six rows. That was true when it was
written and is not now: `packages/wacc/test/wac/specclauses_test.wac` carries
`test_current_wording_for_an_unexpected_token`, `…_for_a_missing_semicolon`, `…_for_a_missing_paren`,
`…_for_a_missing_brace` and `…_and_count_for_a_bad_struct_member`. Every one of the six is held to
something.

**What they pin is practice, not the contract**, and they say so in the place it will be read — the
failure message. `t.eqStr(d[0], "unexpected token", "the message wacc uses today — spec: \`expected
';'\`")`. So a run that goes red hands the reader both halves of this issue without their having to
find this page.

### Why that is worth noting rather than filing away

**The decision now has a visible price and did not before.** Option 1 — change both compilers to the
spec — turns those five tests red, which is the *point* of them: the cost of moving 282 diagnostics
stops being a number in this issue and becomes a list of files. Option 3 — say the message is
illustrative — is now the option that leaves a test asserting wording the spec contradicts, which is
a thing somebody will trip over later.

Neither is an argument for a particular option. It is that all three are now cheaper to *take*,
because what changes is enumerated by something that runs.

**And the unpinned column is the more interesting fact.** These tests were added after the table, and
the table was not updated — so this page said "nothing checks this" about five rows that something
checked. I read it, believed it, and went to write the tests before finding them already there. A
table of what is covered goes stale exactly the way the coverage does; `issues/system/0268a` is the
same failure in a different ledger, and the fix there was to derive the column rather than record it.
Here it is one line, so it is one line — but the shape is worth seeing twice.
