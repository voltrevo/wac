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

## Where the missing state actually has to go — agent-a, 2026-08-20

The shape sketched above puts the flag on `Frame`. The frame is not where the hole is, and knowing that
changes the cost.

`packages/platform/src/frame.wac:318` is the whole conversion:

```wac
u8[] chunk = f.readChunk();
if (chunk.len() == 0) { return Read.End; }
return Read.Data(chunk);
```

So a frame's own read path is `u8[]` — `take`, `readChunk`, `readAll` all return one — and "empty" is
turned into `Read.End` *here*, by this line. A flag on the frame could stop it saying `End`… and then it
would have nothing to say instead, because **`core.Read` has no fourth state**:

```wac
export enum Read { Data(u8[] bytes), End, Failed(string why) }
```

Open-and-silent is a fourth variant of that enum, in `core` — the one place `core/read.wac`'s own header
says a change cannot be localised: *"both ends of a stream have to name it and no adapter can join two
copies"*. And `match` is exhaustive, so every consumer of `Read` in the repository stops compiling until
it handles the new case. That is the honest price, and it is not a flag on a struct.

**The precedent in that same header is the part worth reading before choosing.** The obvious cheap
alternative — a frame-local flag the caller asks about separately — is exactly the shape already tried and
rejected for the *failure* case:

> A companion `inputError()` to ask afterwards was tried first and left the ordinary path looking exactly
> as correct as it had been, so anyone who forgot to ask got the old behaviour back. This cannot be
> forgotten: `match` is exhaustive, and a caller that ignores `Failed` does not compile.

So `Read` was given `Failed` rather than a companion query for the same reason a fourth variant would be
right here, and the argument is already written down. Whoever takes this should decide against that
paragraph rather than around it.

Nothing here changes the conclusion that it blocks nothing. It does move the work from "a field on
`Frame`" to "a variant in `core` plus every `match` on it", which is a different conversation and probably
one to have with the operator.