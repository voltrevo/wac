# 0110 — a pipeline hangs when the shell's own standard input is still open

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-08
- **Kind:** bug
- **Symptom:** hangs

## What

Type this at a terminal, into either shell:

```
$ wacsh -c 'seq 1 3 | cat'
```

It never returns. So does `seq 1 3 | wc -l`, `seq 1 3 | head -2`, `cat f | cat` — **every pipeline whose
first stage is a spawned applet**. `echo x | cat` is fine, because `echo` is a builtin and is not spawned.

Redirect the shell's own standard input and it all works:

```
$ wacsh -c 'seq 1 3 | cat' < /dev/null      1 2 3
$ echo | wacsh -c 'seq 1 3 | cat'           1 2 3
```

Both shells: `packages/sh/src/sh.wac` and `packages/box/src/bin/sh.wac`. It is not new — a build from
before 2026-08-07's `Fs` work hangs identically — and it is not the sealed shell, which cannot spawn and
therefore takes the in-process route.

## Why nothing caught it

**Every test in this repo runs a shell with `stdin: "null"`.** The differential corpus, the corpus
through box's applets, the spawn tests, `corpusThrough.ts` — all of them. That is the right default for a
harness and it is the one setting under which this bug cannot happen: with standard input already at end
of file, whatever the shell is waiting for arrives immediately.

So the first stage of a pipeline is the one shape a person meets in the first minute at a prompt and no
test has ever run.

## Where to look

`Shell.restOfStdin` and `heldInput` in `packages/sh/src/exec.wac`: a spawned stage is handed what the
shell has left of its own input (wac-mono 0066), and a shell whose input is a terminal has *no* end to
read to. `seq` does not read standard input at all, so this is the shell draining its own before the
spawn rather than the child asking for anything.

The fix probably wants to be "a stage that is not the first reads the pipe, and the first reads the
shell's input **lazily** rather than up front" — but that is a guess from reading, and the fix should
start by making a test that fails, which means a harness that gives the shell a standard input that stays
open. `Deno.Command` with `stdin: "piped"` and no write is exactly that.
