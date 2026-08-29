# 0275 — an unbounded producer into `head` hangs on the native host, streams on Deno's

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-29
- **Kind:** bug
- **Symptom:** trap — no, worse: no output, no error, no exit

## Reproduction

One program — `packages/box/src/bin/sealedsh.wac`, no grants — packaged two ways and handed the same
script. The only variable is the host.

```
$ ./deno-built  -c 'yes | /bin/head -2'      # packages/platform/build.ts, deno target
y
y
exit=0   in 0s

$ ./app-built   -c 'yes | /bin/head -2'      # wac app, so the native binary's host
y
y
exit=124 killed at 15s
```

Expected: `head` takes two lines, the pipeline ends, the shell exits.
Actual: on the native host the **output is correct** and the process never returns.

It is specifically an *unbounded* producer. A producer that ends on its own is fine, which is why
nothing caught this:

```
seq 1 5      | /bin/head -2     exit=0    0s
seq 1 200000 | /bin/head -2     exit=0    0s
yes          | /bin/head -2     exit=124  hangs
yes          | head -2          exit=124  hangs      (not about the /bin path)
```

## The third answer

`wac sh` on the same binary gets it wrong a *different* way, which is worth recording because it says
the two paths do not share the code:

```
$ wac sh -c 'yes | head -2'
yes: output exceeded what this shell can hold for a command
exit=1   in 0s
```

So there are three behaviours for one script: Deno's host streams it, `wac sh` buffers and refuses,
and a `wac app` artefact streams it and then hangs. That last pair is the same binary.

## What it looks like

Downstream exiting does not stop upstream. On the Deno host, `head` closing its input ends `yes` —
the write fails and the producer stops, which is what SIGPIPE does for everybody else. On the native
host nothing propagates back, so `yes` keeps producing into a pipe with no reader and the shell waits
for a stage that will never finish.

The `wac sh` message is `packages/box`'s own bound rather than a host behaviour, and it belongs to
`issues/system/0127` — the non-streaming path. It is here only as evidence that `wac sh` and an app
artefact take different routes to the same pipeline.

## A hypothesis, from the code rather than from a debugger

`streamPipeline` in `packages/sh/src/exec.wac` says what is supposed to end it:

> **What makes it terminate.** When a stage's output ends, the stage before it has nowhere left to
> write, so it is stopped: that is `head -1` ending `seq`, and it is what a pipe does with `SIGPIPE`.

And `killBuiltin` says what "stopped" can mean here:

> the only thing that can end a process is the process itself, so `kill -9` on something in a loop
> that never reaches a check point does nothing.

Together those say `yes` stops only by *noticing its own write failed*. So the thing to check first
is whether a write to a closed child handle **faults on the Deno host and succeeds on the native
one** — which would leave `yes` looping on a pipe with no reader, matching every symptom: right
output, no error, no exit.

Not yet measured. It is written down because it is the cheap experiment and it names the seam, not
because it is established.

## Why it matters now

`design/system/0009` moves `packages/box/test/`'s ~47 `buildApp` calls off
`packages/platform/build.ts` and onto `wac app`, which changes the host underneath them from Deno's
to the native one. `packages/box/test/bin.test.ts` hangs on exactly the assertion quoted above — its
last case is `yes | /bin/head -2`, and its comment says why it is there:

> **And a `/bin` path streams**, which is the same statement about a fourth route: `canStream`
> refused every word with a slash in it, so this stage's pipeline ran sequentially and buffered `yes`
> until the array grew past what wasm will allocate — about eleven seconds, then the shell died.

So the test was written for a streaming bug, it caught a second one, and it is the reason this was
found rather than shipped.

**It also means the migration cannot complete until this is fixed**, and that is the useful part: the
tests are not the obstacle, the host difference they exposed is. A `wac app` artefact is what this
repository tells people to distribute, and `producer | head` is not an exotic idiom.

## The decisive experiment, now that it can be run

`issues/system/0276c` is fixed, so the same artefact runs under both hosts. One `wac app` build of
`packages/box/src/bin/sealedsh.wac`, one script, `app-run` on each:

    JS host    exit=0    0s    y y
    native     exit=124  20s   y y      correct output, then never returns

The artefact is held constant — same file, same wasm, same manifest — so this is the host and nothing
else. That is what the section below could not establish.

## The earlier attempt, and why it failed

The obvious next step is to run **one artefact under both hosts** — same wasm, same script — which
removes the artefact as a variable entirely. It cannot be done yet: `wac app-run` on a
JavaScript-hosted `wac` cannot start a program as large as `packages/box`'s shell.
`issues/system/0276c` has that, with one of its two faults already fixed.

So the comparison in this report is between a `build.ts` deno-target build and a `wac app` artefact,
which differ in *how they were packaged* as well as in which host runs them. The hosts are still the
likeliest variable — the wasm is the same program either way — but it is worth being exact about what
has and has not been held constant.

## Notes

Found by driving the migration rather than by reading either host. Neither implementation looks wrong
on its own; they differ, and only running the same program on both says so. `commandparity_test.wac`
compares commands across hosts and would be the natural place for a row, except that what differs
here is a *pipeline's* lifetime rather than a command's answer.
