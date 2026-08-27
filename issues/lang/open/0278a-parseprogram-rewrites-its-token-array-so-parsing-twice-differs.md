# 0278a — `parseProgram` rewrites its token array, so parsing the same file twice differs

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-27
- **Kind:** bug
- **Symptom:** wrong answer, and it lands on a file nobody touched

## What

`parse.wac`'s `splitGt` rewrites the token array **in place**:

```wac
void splitGt(P p) {
  i32 base = p.abs(0) * tokenStride();
  p.toks[base] = p.kindAt(0) == kShrU() ? kShr() : kGt();
  ...
}
```

Its own doc explains why — *"`Vec<Vec<i32>>` ends in what the lexer read as one shift operator … the
parser consumes one `>` worth and rewrites the rest in place — the same trick the reference calls
`replaceCurrent`, and the reason `P.toks` is mutable."* That is a reasonable design.

What is not written down is the consequence: **a `Lexed` is single-use.** Parse it once and every
`>>` that closed a nested type-argument list has become a `>`; parse the *same array* again and the
second read sees `Vec<Vec<i32>` — a comparison — and reports

```
error: type arguments, and a value cannot follow them — parenthesise to compare
     --> packages/sh/src/exec.wac:1590:22
      |
 1590 |   Vec<Pending<Read>> outT = Vec.create();
```

## How it was found, which is the part worth keeping

A change to `api.wac` routed `diagnoseFilesWithIn` through a helper that parses, and left the
`parseProgram` call that was already there. One line, two parses, one array.

The failure surfaced as **a parse error in `packages/sh/src/exec.wac`** — a file the change did not
touch, in a package it has nothing to do with — during round 2 of `tools/seed.sh`. Round 1 built a
compiler; that compiler could not read a nested generic. Nothing about the symptom pointed at the
cause, and `git stash` + reseed was the only thing that attributed it.

It also only fires on a **nested** generic, because only `>>` needs splitting. `Vec<i32>` parsed
twice is fine. So the blast radius is small and the diagnostic is maximally confusing.

## Why no test catches it

Every caller parses once, so nothing has ever asked whether parsing twice agrees. The reference has
the same design and the same property, so the differential cannot see it either: both sides parse
once, both give the same answer, and the invariant that is broken is not one either side is asked
about.

## What to do

Three options; the first is the cheap one and the third is the honest one.

1. **Say so, loudly.** A doc line on `parseProgram` and on `P.create`: *the token array is consumed;
   build a fresh `Lexed` for a second parse.* Costs nothing, catches nobody who does not read it.
2. **Make it detectable.** A `parsed` flag on `P`, set by `parseProgram`, trapping on a second call.
   That converts a wrong answer three phases later into a message at the mistake. `P` is created per
   parse today, so the flag would have to live with the *tokens* rather than with `P` — which is the
   honest place, since it is the array that is consumed.
3. **Make it not happen.** `splitGt` writes to a copy, or the lexer emits `>` `>` and the parser
   joins them for a shift. The second is how several compilers do it and would delete `splitGt`, but
   it moves a decision the reference also made and the differential compares positions across it —
   so it is a language-plumbing change rather than a fix.

**Recommendation: 2, then 3 when the reference stops being a differential.** A guard that fires at
the second parse is worth more than a comment, and 3 is a good change to make once there is no second
implementation to keep in step.
