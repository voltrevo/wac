# ts — the transform that proves the rule the desugarer discovered

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/ts`: TypeScript to JavaScript by type erasure, 2,336 lines, checked
against `ts.transpileModule` over all 22 files of `packages/platform/host/` **byte-identically**. It
is the strongest differential in the repository and its README is honest about where the difficulty
is.

- [`src/blank.wac`](src/blank.wac) — a buffer whose only operation is blanking a span
- [`src/token.wac`](src/token.wac) — a token, where there is a quintuple in a flat `i32[]`
- [`src/strip.wac`](src/strip.wac) — the erasure
- [`src/fault.wac`](src/fault.wac) — four refusals, where there is a `string`
- [`src/ts.wac`](src/ts.wac) — the barrel

---

## Source-to-source is viable exactly when the transform only removes

Earlier today [`@/packages/wacc/src/desugar.wac`](../wacc/src/desugar.wac) wrote the `try` lowering as
a compiler pass, on the strength of `../../TECHNICAL.md`'s conclusion:

> a source-to-source desugarer is the wrong target. Its output for that function is unreadable, and
> unreadable output is not a minor cost for a tool whose purpose is to let people run the proposal —
> every diagnostic, every line number and every stack frame would point into it.

`packages/ts` is a source-to-source transform whose diagnostics, line numbers and stack frames point
at the **input**, and it holds that over 22 real files against the TypeScript compiler. So the
conclusion is right and its stated reason is not the one that decides it.

The difference is one word. **Erasure only removes**, so the output can be the input with spans
blanked and every line and column survives — `design/system/0009` D1, and the reason newlines inside
an erased range are kept. A desugaring **adds**, and no arrangement of added text leaves the
surrounding columns where they were. A source map is the standard answer, and it is a second artefact
every downstream tool has to consult: a different cost, not a smaller one.

So: **source-to-source is viable exactly when the transform is length-preserving.** Neither page says
it, and the two files that prove the two halves were written on the same day.

## The property is a comment, and here it is the type

D1 holds because every write in a 924-line file is careful, and it is checked at the end by the
differential. `Blanked` starts as a copy of the source and its only mutation is `blank(from, to)`,
which cannot change the length and cannot touch a `\n`. **A stripper that erased by deleting would
not compile**, because there is no operation for it — and `src/bundle.wac`, which writes into the
same buffers and re-derives the rule, would inherit it instead.

## Third flat table, first with no reason at all

```wac
export i32 tokenStride() { return 5; }
export struct Lexed { i32[] tokens; string error; i32 errorAt; }
export i32 kindAt(Lexed l, i32 i) { return l.tokens[i * tokenStride()]; }
```

— plus `lenAt`, `startAt`, `lineAt`, `colAt`, `textAt`, `tokenCount`, and seven `k*()` kind
constants. After `@/packages/abi`'s descriptor and `@/packages/ssz`'s, this is the third, and it is
the first of the three that never crossed a boundary: `ssz` names a JS boundary that was deleted on
2026-08-17, `abi` gives no reason, and `packages/ts` is a wac program whose only consumer is another
wac program. **By the third occurrence it is a habit rather than a decision.**

The honest counterweight is in [`src/token.wac`](src/token.wac): a `Vec<Token>` is a header and a
reference per token where the flat array is five words, and this is the one rewrite in the directory
where the shipped form might be right for the reason the shipped form usually is not. Nothing here
can tell, and `../../bench/` measures something else.

## Two structs in one package holding "empty when `error` is set"

```wac
export struct Stripped { u8[] out; string error; i32 line; i32 col; }
export struct Lexed    { i32[] tokens; string error; i32 errorAt; }
```

Both are a `Result` written as one struct because there was no other way to answer either, and both
say so in a comment. The messages are good English that no caller can act on — an editor integration
wanting to underline the `enum` keyword gets a string beginning with a backtick. Four refusals become
three variants plus the lexer's, nested so that `Err(is LexFault):` is one arm for *"it is not valid
JavaScript, never mind the types"*.

That nesting is the **good** case of the flattening question, and
[`@/packages/box/src/upper.wac`](../box/src/upper.wac) is the bad one — a stacked transform with the
same member at two depths. Both are now in this directory, which is what makes the question
answerable rather than a preference.

## The half of this package I recorded as unwritten is 544 lines

`packages/ts/README.md` said, in its opening summary and again at the foot, that the bundler was
*"still to do … step 4"*. `design/system/0009`'s status table says **done** — *"the bridge bundles to
214 KB and Deno parses it"* — `src/bundle.wac` is 544 lines, `main.wac` and `transform.wac` call
`bundle()`, and `test/wac/bundle_test.wac` exercises it.

I read the README, because that is what one reads, and repeated the claim in four places here before
checking the note that owns it. Both are now fixed.

**The mechanism is worth more than the correction.** A status copied into a second file has no reason
to be visited when the work lands, *because the work lands somewhere else* — the commit that finished
the bundler touched `src/`, and nothing about it pointed at a sentence in the README. That is not the
same as a comment going stale next to the code it describes, which at least sits where an editor is
looking.

Swept the rest: three design notes carry status tables and three READMEs say something is *not
written*. `packages/git`'s ref-directory walk and `packages/tor`'s onion-service program are both
genuinely unwritten and both agree with their notes. **`ts` was the only one out**, which bounds the
problem rather than opening it — and the tor note records the mirror-image failure already, that the
interop matrix's *"first act was to catch step 6 above being marked done against the wrong
condition"*.

So the pair exists in one repository: a status that said done and was not, and a status that said
not-done and was. What both have in common is a second copy — and the rule the tree already applies
to rules, *a rule written twice is a rule that drifts*, has never been applied to a **state**.

## What could not be written

**Three of the differential's eight defects were one rule stated three times.** The README:
*"after a type-level operator — `=>`, `|`, or a second `as` — what follows is more type, and reading
it as code left an object type behind as a statement."* That is a **state**, not three conditions,
and `../../QUESTIONS.md`'s *an exception hides the rule it broke* is exactly it. `ColonMeans` here is
half the idea; a `Reading { Code, Type }` state is the other half. A language finding only weakly —
it argues for a state machine, which is not a proposal — but a strong argument for the differential,
since the hand-written cases were written by somebody who believed the rule was three rules.

**`step` answers the next index and nothing says it is greater than the one it was given.** A
stripper that returns `i` loops forever, and this is the one function where that is possible. A
generator — `gen<Blanked>` yielding after each construct — puts the advance in the language's own
loop, and is a real alternative rather than a wish.

**The `Ctx` is threaded and a helper could push a frame and not pop it**, which is the class of bug
this package fears most. `defer { ctx.pop(); }` is what the code wants; `defer` is one of the four
constructs whose meaning is open, and this is the third file in the directory blocked on the same
answer.

**~~A `Span` for `blank(from, to)`.~~ Answered 2026-09-05, and the residue is better than the ask.**
It is `blank(Bytes span)`. A `Slice<u8>` is `{ of, from, len }` and `slice()` traps on a range it
does not contain, so `from <= to` and `to <= len` are both guaranteed by construction — making the
slice *is* the check, and a caller cannot build a bad one.

What it does not give is that `span.of` is the buffer being written. **A slice pairs a position with
*an* array and not with *the* array the receiver means**, so `blank(otherFile.slice(0, 3))`
type-checks. That is the limit of the *carry the subject* argument
[`../../QUESTIONS.md`](../../QUESTIONS.md) makes: for a fault being rendered there is one array in
play and it does not bite; for a **mutation** the receiver has an array of its own, and the question
becomes *where in what of mine*, which a slice answers confidently and wrongly.
