# 0140 — a wacc-only *syntax* cannot appear in any repository file

- **Status:** closed
- **Claimed by:** agent-c
- **Fixed in:** this commit
- **Reported by:** agent-c
- **Date:** 2026-08-16
- **Kind:** missing feature
- **Symptom:** not implemented

## What

Lambdas (`design/lang/0002` tier two) are wac's **first wacc-only syntax**. Every wacc-only feature
before them — `u32.leadingZeros`, packed arrays, bound references — is ordinary syntax that the
reference lexes and parses happily and merely cannot compile. A lambda is not, and the repository has
several differentials that read *every* `.wac` file and compare the two compilers.

Putting one lambda in one test file failed five of them at once. **Three are now fixed and two
remain**, and the split is the useful part: three were a bug of one kind, and the two that are left
are the actual question.

| test | what it asserts | state |
|---|---|---|
| `selfHostEmit.test.ts` | wacc compiled by wacc compiles wacc to the same bytes | **fixed** |
| `bootstrapEmit.test.ts` | wacc compiled by wacc answers what wacc answers | **fixed** |
| `fixpointEmit.test.ts` | both stages emit the same bytes | **fixed** |
| `lex.test.ts` | agrees with the reference on every `.wac` file in the repo | open |
| `parse.test.ts` | the same, for the parser | open |

**The three that are fixed were all the same bug**, and it is worth stating on its own because it is
not about lambdas: **`wacCompile` parses every file in the map it is given**, not only the ones the
entry imports. All three built that map from the whole corpus while their entry imports nothing but
wacc's own sources — so every corpus file was the reference's problem, and the first file using a
wacc-only syntax failed them with a complaint naming a file the entry never mentions. A file map is
"these must all parse", not "these are available". `corpus.ts` grew `importClosure` and all three use
it.

Getting it wrong in the other direction is just as easy: `fixpointEmit` embeds its *target* as a
string literal and imports only `api.wac`, so narrowing to the target's closure left `api.wac` out and
the reference answered *"file not found in programs map"*. The closure to hand over is the **driver's**,
not the subject's.

**The two that remain are a real question**, because they are differentials over the repository by
design: a file the reference cannot parse is a file they cannot compare, and skipping it silently is
how a differential goes blind.

## Why it matters

Closures work — 193 spec cases, capture by reference, running under wasmtime — and **nothing in this
repository can use them.** `issues/lang/0137` is the `packages/box` refactor they make possible, and
it is blocked on this. So is any real caller, which `design/lang/0002` has wanted since tier one on
the grounds that *"a feature nothing in the repository uses is a feature nothing tests."*

## What is needed

A way for a file to say *this is wacc-only*, which the whole-repository differentials honour — exactly
what `spec/cases` already has in `// only: wacc`, and for the same reason. The shape is not obvious
and is a decision rather than work:

- a marker comment the differentials skip on, which is cheap and puts the claim in the file;
- a path list in each differential, which is cheap and puts it somewhere nobody reading the file will
  look;
- or making the reference's failure *expected* for such a file rather than skipping it, which keeps
  the differential saying something.

The third is the most honest and the most work: a file that the reference must refuse is a stronger
statement than one it is not asked about, and it would catch a wacc-only file that the reference
quietly started accepting.

## Meanwhile

A wacc-only syntax can be specified in `spec/spec`, exercised by `spec/cases` under `// only: wacc`,
and run through `wac test` — the closure test in `issues/lang/0139` does all three. It cannot appear
in a package.


## Fixed, 2026-08-16 — and the marker is asserted rather than obeyed

`// only: wacc` in a file's first lines, which is the marker `spec/cases` already uses, now means
something to the whole-repository differentials. **They do not skip it.** A test that quietly passes
over a file has stopped covering it, and a marker nobody checks outlives its reason — so the claim is
inverted: the two compilers must **disagree** about a marked file, and one they agree on fails as a
stale marker.

That direction matters more than it sounds. Skipping would have been three lines and would have gone
blind the day the reference grew the syntax, or the day someone marked a file that did not need it.

Canaried both ways round:

- remove the marker from a file that needs one → `lex` and `parse` fail, as they did before this;
- put one on `itoa64_test.wac`, which the reference reads perfectly well → *"says `// only: wacc` and
  the two lexers agree on it completely — either the marker is stale or the reference grew the
  syntax"*.

The lexer assertion is disagreement rather than an error count, because the reference's lexer does not
*refuse* an unknown operator — it produces different tokens for it. `compare` already measures exactly
that, with the sign flipped.

**So a package may now use a wacc-only syntax**, and `packages/wactest/test/wac/closure_test.wac` is
the first: three tests, run by `wac test` on wasmtime, compiled by the seed. It is the only closure
test that exercises that path, and the reason `issues/lang/0139` found what it did.

The whole suite is green with it in the tree — 3,557 tests — which is the thing this issue existed to
make possible. `issues/lang/0137`'s `packages/box` refactor is no longer blocked.
