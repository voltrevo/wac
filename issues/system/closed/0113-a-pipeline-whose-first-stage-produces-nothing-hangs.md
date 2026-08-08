# 0113 — a pipeline whose first stage produces nothing hangs, if standard input is still open

- **Status:** closed
- **Reported by:** agent-a
- **Date:** 2026-08-08
- **Kind:** bug
- **Symptom:** hangs

## Reproduction

With standard input **open and never written to** — what a terminal is, and what `wac-mono 0110`'s
harness gives a shell:

```
$ wacsh -c ': | cat'          # never returns; bash exits at once
$ wacsh -c 'true | cat'       # the same
$ wacsh -c ': | wc -c'        # bash says 0
$ wacsh -c 'g() { :; }; g | cat'
$ wacsh -c 'echo a | while read l; do echo [$l]; done'   # bash says [a]
```

Working, for contrast: `echo x | cat`, `seq 1 3 | cat`, `{ echo a; } | cat`, `echo a | cat | cat`. The
common factor is a first stage that produces **no bytes**.

Every test in this repo runs a shell with `stdin: "null"`, which is why none of them see it — the same
blind spot 0110 was filed for, and the same fix does not cover this shape.

## Found by

A generative differential: random scripts built from the constructs this shell claims to support, run
through both shells and compared. The first hang came out of 120 scripts, in a case nobody would write
by hand — `v=set; g() { echo b | cat; }; g; : | cat`.

## What I know so far

Two things were wrong and neither was the whole of it, so both are committed as *corrections* rather
than as the fix:

- `runSimple` inferred "this stage is downstream of a pipe" from `stdin.len() > 0`, which cannot tell
  "no pipe" from "a pipe that delivered nothing" — and the comment above it says exactly that
  distinction is what the flag is for. It takes a `piped` argument now.
- `dispatch` recomputed the inherit decision without the caller's `mayInherit`, so the in-process applet
  route could inherit the terminal even where the caller had decided it must not.

It still hangs after both, so the cause is further down. What the next probe should ask: **`cat </dev/null`
hangs too**, with no pipeline in sight, which suggests the redirection path reaches the same place — an
empty input that the applet does not treat as an input at all, and then reads the real one. `read x` at an
open standard input hanging is *correct* and is not this.

## Why it is filed rather than fixed

Two corrections in and the reproduction still stands: the remaining cause is somewhere in `restOfStdin`,
`heldInput` or the applet's own feed, and getting that wrong makes a shell read a terminal it should not
or drop input it should have. That is worth a tick with a bounded harness rather than the tail of one —
the reproduction is exact, and `packages/sh/test/spawn.test.ts` already has the "standard input stays
open" harness this needs.

## Fixed, 2026-08-08 — one condition, and it was in the place the issue pointed at

`Shell.ensureStdin` decided whether to go and read the program's real standard input with

    if (ownsStdin && !triedStdin && stdinPos >= stdinBytes.len())

and `stdinPos >= stdinBytes.len()` is **true of an empty held input**. "The buffer is spent" and "the
shell was never given an input" are the same expression, so a command handed nothing by a pipe or by
`< /dev/null` went to the terminal and waited. `heldInput` — the flag that says "these bytes are the
shell's and they are all there is" — already existed and this line did not ask it.

`cat < /dev/null` hanging was the case that found it: no pipeline in sight, so the fault could not be
in the plumbing between stages.

Fifteen cases in `packages/box/test/stdin_open.test.ts`, including the three that always worked, so a
future fix that breaks them says so. The two corrections pushed with the report stand and were needed:
without `piped`, a stage after an empty one still had `heldInput` false and would hang again.

## And what the generator found next

The same harness, 400 scripts: **374 agreed**. The 26 that did not were all one class — `test`'s
diagnostics. `[ x y ]` says `[: …` in bash and `test: …` here, which names a command the caller never
typed in every message from the spelling a script actually uses; and GNU's wording says *where* it
wanted an operator (`b: binary operator expected`, `x: unary operator expected`) where ours said
"unknown operator". Both fixed, twelve cases in the corpus.
