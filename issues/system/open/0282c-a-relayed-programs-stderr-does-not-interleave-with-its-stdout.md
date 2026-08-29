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
