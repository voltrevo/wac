# 0195 — a `Frame`'s standard input cannot be open and silent, which is the shape a terminal has

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** missing feature
- **Symptom:** a case that cannot be written in process

## What is missing

`Frame.of(argv, stdin, cwd, inheritIn)` takes standard input as a `u8[]`, and `take` answers an empty
slice once `at` reaches the end. So a frame has exactly two states: bytes to read, and end of input.

A terminal is neither. Its input is **open and silent**: a read finds nothing there *and* the stream has
not ended, and more may arrive later. That is a third state, and nothing in a frame can say it.

## Why it matters here

`wac-mono 0113` is the whole argument. A pipeline whose first stage produced no bytes hung, because one
condition could not tell an empty held input from no input at all — and it appears **only** under the held
shape. `tools/wac/shfuzz.wac` runs every generated script under both, which is how it was found.

So when `packages/box/test/wac/fuzz_test.wac` moved the differential in process, the held shape could not
come with it: an in-process replay collapses precisely the distinction the defect was about. It is left in
`packages/box/test/fuzz.test.ts`, which builds a shell and spawns it 120 times — 16 s of the box suite, and
the only reason that file still exists.

The same gap is under `packages/platform/src/frame.wac`'s `inheritIn`, whose comment records the other
half of it: a caller that runs a command in process "has to have bytes to give it, and to have them it
must read its own input to the end — which at a terminal never comes". `inheritIn` is the escape hatch for
*reading a real terminal*; what is missing is the ability to **simulate** one.

## A shape that would do it

A frame that can answer "nothing now, and not the end" — a flag beside `stdin`, or a source function the
frame calls rather than an array it slices. `take` would return empty with the stream still open, and a
shell polling it would have to make the same decision it makes on a host.

Whatever the spelling, the test for it is 0113's script: `: | cat` under a held input, in process, without
a binary.

## Notes

Filed while moving box's tests off spawning (`issues/system/0193`). It blocks nothing — the shape is still
covered, by a spawn — but it is the reason one 19-second test file cannot be deleted, and it will be the
reason for the next one.
