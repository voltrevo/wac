# 0140 — a wacc-only *syntax* cannot appear in any repository file

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-16
- **Kind:** missing feature
- **Symptom:** not implemented

## What

Lambdas (`design/lang/0002` tier two) are wac's **first wacc-only syntax**. Every wacc-only feature
before them — `u32.leadingZeros`, packed arrays, bound references — is ordinary syntax that the
reference lexes and parses happily and merely cannot compile. A lambda is not, and the repository has
several differentials that read *every* `.wac` file and compare the two compilers.

Putting one lambda in one test file fails four of them at once:

| test | what it asserts |
|---|---|
| `packages/wacc/test/lex.test.ts` | agrees with the reference on every `.wac` file in the repo |
| `packages/wacc/test/parse.test.ts` | the same, for the parser |
| `packages/wacc/test/bootstrapEmit.test.ts` | builds a driver and hands it to the reference |
| `packages/wacc/test/fixpointEmit.test.ts` | the same |

`selfHostEmit.test.ts` was a fifth and is **fixed**: it handed `wacCompile` the whole corpus when its
driver imports only wacc's own entry and embeds everything else as string literals. It gets the
driver's closure now. Worth knowing generally: **`wacCompile` parses every file in the map it is
given**, not only the ones the entry imports, so a file map is "these must all parse" rather than
"these are available".

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
