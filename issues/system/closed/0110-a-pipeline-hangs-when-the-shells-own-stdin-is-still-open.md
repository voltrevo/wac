# 0110 — a pipeline hangs when the shell's own standard input is still open

- **Status:** closed, 2026-08-08
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

## 2026-08-08: fixed where a shell can spawn, and the other half named

**`streamPipeline` said `n == 1`.** Only a lone command could inherit the real descriptor; a pipeline of
two or more had the shell forward its own input to the first stage instead, and forwarding means reading
to the end. It is `i == 0` now — the *first* stage inherits, whatever the length, and every later stage
reads the pipe from the one before it. The race the old comment worried about is not one: only stage 0
inherits, and when it does the shell sends nothing, because the bytes are not the shell's to send.

`packages/sh/test/spawn.test.ts` has the case, and the harness is the point: `stdin: "piped"` and never
written to is a standard input that stays open, which no other test in this repo gives a shell.

**What is left is the in-process route**, which a browser and `bin/sealedsh.wac` take because they cannot
spawn:

```
$ sealedsh -c 'seq 1 3'     # with an input that stays open: hangs
```

`runExternal` hands an applet `sh.restOfStdin()`, and `boxRun` passes those bytes to `cli.pushChild`,
which is a **value**. So the shell must have read the whole input before it can start an applet that may
not read a byte of it. Being lazy needs `pushChild` to be able to say *"leave the input alone, let the
child read the real one"* — a platform change with three hosts behind it (Deno, Node, the browser), and
the shell then telling it which stage may inherit.

That is a tick of its own and it is where this issue continues. A shell that can spawn — which is every
one on a real machine — is fixed.

### What the in-process half actually needs, having read it

Smaller than "a platform change" makes it sound, and worth writing down so the next person starts from
the shape rather than from the symptom.

`packages/platform/host/child.ts` is the whole of `pushChild`/`popChild`'s state, shared by all three
hosts. Its `readChunk()` already has exactly the right escape hatch:

```ts
readChunk(): Uint8Array | null {
  const frame = this.top;
  if (frame === undefined) return null;   // no child — ask the host instead
  …
}
```

**`null` means "read the real input".** So an inheriting child is a frame whose `readChunk` and `readAll`
answer `null` while `write` goes on capturing — three lines:

- `Frame` gains `inheritInput: boolean`;
- `readChunk()` and `readAll()` return `null` when it is set;
- `push()` takes it.

Then the parts outside that file:

- `pushChild` in `platform.wac` becomes `(string[], u8[], string, bool)` — a fourth argument rather than
  a second function beside it — and each host's decode of the payload gains the flag;
- `Shell.external` needs to say *whether this command may inherit*, which the shell already knows: it is
  the same `!heldInput && ownsStdin && !triedStdin` that `streamPipeline` uses, plus "this is the first
  stage";
- `runExternal` passes it and stops calling `restOfStdin()` when it is true.

The test is the one shape that already exists: `stdin: "piped"` and never written, against
`bin/sealedsh.wac`, which cannot spawn and therefore takes this route by construction.

## Closed: both halves

The in-process half went exactly where the scoping above said it would.

`pushChild` takes a fourth argument — **the child reads the real standard input** — and `host/child.ts`
implements it by answering `null` from `readChunk` and `readAll`, which is the answer it already gave for
"no child running" and which sends the host to the process's own input. Output is still captured, which
is what the frame is for. One field, two returns, and the payload gained an `i32`.

`runExternal` computes the same condition `streamPipeline` uses — nothing held, this shell owns its
input, nothing has touched it — and when it holds, hands the applet no bytes and never reads any.

`packages/box/test/sealed.test.ts` has the case, against `bin/sealedsh.wac`, which cannot spawn and so
takes this route by construction. Both new tests use `stdin: "piped"` and never write to it, which is the
shape this issue is really about: a standard input that stays open, as a terminal's does, and as
`stdin: "null"` — every other test in this repo — does not.
