# 0282 — a relayed program's standard error does not interleave with its standard output

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-29
- **Kind:** bug
- **Symptom:** wrong answer — the right bytes on each stream, in the wrong order between them

## Reproduction

```
$ wac app packages/sh/src/sh.wac -o wacsh --allow-read --allow-write --allow-env
$ env -i LC_ALL=C PATH=… bash -c '"$0" -c "$1" >"$2" 2>&1' ./wacsh 'echo one; nope; echo two' out
$ cat out
one
two
sh: nope: command not found
```

Expected — and what bash, and the same shell through `wac run`, both give:

```
one
sh: nope: command not found
two
```

Each stream carries the right bytes. What is wrong is their order *relative to each other*, which is
only observable when both are sent to one place — a terminal, or `2>&1`.

## Where it comes from

`wac app` runs its program as a child and relays two streams, in `relay`
(`packages/wac/src/runprog.wac`). The loop waits on both with `waitAny` and services whichever
answers — and when both are ready it takes standard output first, because that is the branch it tests
first. So a diagnostic written between two lines of output arrives after both.

`wac run` does not relay: the native binary instantiates the module in its own process and the program
writes to the real descriptors, so the kernel keeps the order. That is why the same shell gives the
right answer one way and the wrong one the other, from the same binary.

`relay`'s own header states the difference it *does* claim:

> This is the same bytes on each stream and the same status, which is what `commandparity_test.wac`
> compares, and it is not the same thing — a program wanting a terminal sees a pipe here.

That is accurate and incomplete: it names the bytes and the status, and interleaving is neither.

## Why it matters

Interleaving is not cosmetic for a shell. `packages/sh/test/differential.test.ts` compares this
against bash directly — *"standard error interleaves with standard output, as bash does"* — and it is
the reason that file cannot move onto `wac app` for `design/system/0009`, which is how this was found.

More generally it is what anyone reading a build log depends on: a diagnostic that names the step it
belongs to is useful, and the same diagnostic at the end of the run is not.

## What a fix has to deal with

The order is lost at the boundary rather than in the loop. A child writes into **two queues**, and
nothing records which write happened first — so the relay cannot recover an order that was never
carried. Reordering the branches in `relay` would change which stream wins, not preserve anything.

So it needs either one ordered channel carrying both streams with a tag per chunk, or a sequence
number the relay can sort by. Both are a change to what a child hands its parent rather than to the
relay, which is why this is filed rather than patched.

## Notes

Eighth host-route divergence found on 2026-08-29 by moving tests onto `wac app` for
`design/system/0009`. Unlike the others it is not a difference *between hosts* — every host that
relays has it — so `issues/system/0279c`'s ledger would not catch it either: the opcodes involved,
`WRITE_STDOUT` and `WRITE_STDERR`, are compared, and each is correct on its own.

## A third option: let the child inherit the parent's output, as it already inherits its input

The two fixes above both change what a child *hands* its parent — framing, or a sequence number.
There is a third that removes the hand-off, and the evidence for it is in the call site.

`runBytes` spawns like this (`packages/wac/src/runprog.wac`):

    Child kid = cli.spawn(wasm, args, grants, "", true, false).wait();
                                                   ^^^^ inheritIn

So the launcher **already gives the child its own standard input** rather than a queue, for the
reasons `spawn`'s documentation gives: an inherited stream is read as it goes and is shared between
children, which is *"the difference between modelling a process and imitating one"*. The output side
has no equivalent — both `spawn` and `spawnSelf` end `(…, cwd, inheritIn, serveFs)` and neither says
anything about stdout or stderr.

That asymmetry is where this bug lives. Input is inherited, so the kernel keeps it right. Output goes
through two queues, so ordering became this code's problem and it gets it wrong.

### On the Rust hosts it is close to a one-line change

`emit_bytes` (`native/v8/src/main.rs:1442`) already tries, in order: the innermost frame, then an
`openOutput` redirect, then **the parent's queue**, then the process's real stream. A child whose
`child_out`/`child_err` were simply never installed falls through to that last step.

And a child here is *"a thread with its own V8 isolate"* — not a separate process. So both of its
streams reach the real descriptors from the same process, in the order the `write` calls happen.
Interleaving is then preserved by the same mechanism that makes `wac run` correct, rather than
reconstructed.

This is the same shape as the input-side fix made on 2026-08-29 (`0285c`): the ordering of the
alternatives in one function, with the parent's queue in the wrong place in it.

### First, a correction to the diagnosis above

*"Nothing records which write happened first — so the relay cannot recover an order that was never
carried."* The second half is right about the **relay** and wrong about the **host**. The order is
not missing; it is discarded, one layer lower, and by every host for the same reason.

- Rust: a child is a thread with its own isolate, and its `emit_bytes` calls reach `child_out` /
  `child_err` in program order.
- JavaScript: `startWorld(bridge.sab, args, out, input, err, …)` — `children.ts:464` — runs a
  responder on the host thread over a **synchronous** SAB bridge, so the child's writes arrive there
  sequenced too, and are then appended to `out` or `err`.

In both cases the sequencing exists at the moment the bytes enter the parent's plumbing, and is lost
because that plumbing is two queues. So the fix is not *carrying an order that was never taken* — it
is *not throwing away one already in hand*, which is a much cheaper thing to arrange and makes
option 2's sequence number a counter the host already has, rather than a protocol.

### What that leaves for the JavaScript hosts

A child there is a worker and workers have no descriptors, so the *"write the real stream"* step has
to happen on the host thread. Per the correction above that is where the responder already is, and
where the writes already arrive in order — so it writes them out as they come instead of sorting
them into `out` and `err`. No tag, no ring, no wire format.

So the wac-level answer is one flag on every host: it states the intent — *my output is my parent's
output* — and each host keeps it where it already has the ordering.

### The launcher still has everything it needs without the streams

Worth checking rather than assuming, because "inherit the output" sounds like it costs you the child.
It does not: `relay` ends with `cli.exitCode(kid.handle).wait()`, so the status comes from the
**handle** and not from the streams ending. And `Cap::ExitCode` is *"the child's ticket, not a
poll — a parent may ask before the child has started; blocking on the ticket is the answer"*.

So `runBytes` under this option is the spawn and then that one line, with no loop at all:

    Child kid = cli.spawn(wasm, args, grants, "", true, false, /* inheritOut */ true).wait();
    …
    return cli.exitCode(kid.handle).wait();

### Why it would be exact rather than approximate

`relay` does two things with the bytes: writes each to the matching real stream, and stops the child
when a write fails (`0278c`). Inheriting gives the first for nothing and turns the second into a
failed write in the child itself, which is what `wac run` already relies on. Nothing else reads them
— `relay` returns the exit code and no caller inspects content.

It also closes the gap `relay`'s header names as the one place the two implementations *"differ in
kind rather than in code"*.

### What it costs

- A parameter on `spawn`/`spawnSelf` in `std/platform.wac` and in every host — a flag with a sibling
  to copy, not a wire format.
- Existing call sites keep today's behaviour by passing false; three in `packages/wac` would pass
  true — `runprog.wac`'s `runBytes`, and `wac.wac:1849` and `:2168`.
- A shell must keep the queues, since pipelines and redirections need the parent to hold the bytes.
  Per-spawn, for the same reason `inheritIn` is.

### What is not established

Not prototyped, on any host. The Rust claim rests on reading `emit_bytes` and the `Cap::Spawn`
comment; the JavaScript claim rests on `startWorld`'s signature and the bridge being synchronous. In
particular I have **not** checked that a host thread writing the real descriptors from inside the
responder is safe where the parent may also be writing them.

There is also a question this option does not answer and the other two do: what a parent that
*wants* the bytes should get. A shell needs the queues, so interleaving stays wrong for
`packages/sh` pipelines whatever happens here. This fixes the launcher, which is what
`differential.test.ts` and `design/system/0009` need; it is not a general answer to "two streams,
one order".

## Attempted 2026-08-29, and blocked on `issues/lang/0291c`

The third option above was implemented in full — `inheritOut` on `spawn`, both Rust hosts, the three
JavaScript hosts, all eleven call sites — and the mechanism works. A throwaway prototype that simply
never installed the child's queues, so `emit_bytes` fell through to the real streams, gave:

    before   11 runs in 20 printed `one two mid`
    after     0 runs in 20

and the same prototype broke `seq 1 3 | wc -l` into printing `1 2 3` and counting `0`, which confirms
the other half: it has to be per-spawn, exactly as `inheritIn` is, and a shell must pass false.

**It cannot land in that shape**, because a seventh parameter on a capability makes wacc drop the
module's entry point with no diagnostic — `issues/lang/0291c`, which this work found and which was
confirmed by reverting every behaviour change and keeping only the parameter. Six is the widest
capability in the tree, so `spawn` would have been the first with seven.

The way through is to stay at six by folding the two flags into one `i32`, which is what the
neighbouring parameter already does — `grants` is `GRANT_READ | GRANT_WRITE | …`, not five bools. So
`inheritIn: bool` becomes `inherit: i32` carrying `INHERIT_IN | INHERIT_OUT`. That is a change to
every caller and to the `spawn` payload's wire format, and it is not a contortion around the bug: it
is the shape the signature already uses one argument earlier.

Also found on the way, and worth knowing before repeating this: `packages/wac/src/grants.wac`'s
`noSpawn` and `packages/sh/test/wac/probe.wac`'s `fakeSpawn` are stored *into* the capability field,
so their parameter lists have to track `spawn`'s exactly. Nothing checks that — `issues/lang/0290c`
— and getting it wrong emits an invalid module rather than a diagnostic. `noSpawn`'s last parameter
is also misnamed `inheritErr`; it has always been `serveFs`.
