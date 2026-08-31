# 0312 — an abandoned `spawn` leaves a child nothing can reach, and that may be right

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** design question
- **Symptom:** a running process no code holds a handle to — measured, both hosts

## Measured

The child waits, then writes a file. Dropping the `Pending<Child>` without collecting it:

| | the child |
|---|---|
| abandoned | **ran on** — wrote its file |
| control — collected, then `closeSocket` | stopped |

## Why this is filed and the other four were fixed

`issues/system/0310b` swept the capabilities that hand a consumed thing to a ticket that may be gone,
and fixed five. This is the sixth by that description and the first where the fix is not obvious.

`closeSocket` on a child's handle **stops the child outright** — the host's own comment says so — so
the handle owns the child. On that reading, dropping the only `Pending` that carries it leaves a
process nothing can reach, wait for, or stop, which is exactly what an abandoned `connect` did before
it was made to close.

**But fire-and-forget is a real pattern, and this is how it is spelled.** `cli.spawnSelf(args, …)` as
a statement, result ignored, starts a child and walks away. Killing on drop would make that
impossible to write — and it is not a strange thing to want.

That is the difference from `connect`. There, the `Pending` carries the only reference to a socket
and there is no use for a connection you never read or write, so closing is the only honest act. Here
the child is useful precisely without a handle.

## The two answers

1. **The handle owns the child.** Dropping the `Pending` stops it, and fire-and-forget needs a way
   to say so — `Cli.spawnDetached`, or a flag beside `inheritIn`/`inheritOut`. Consistent with
   `closeSocket` and with `connect`, and it makes "nobody can reach this" impossible by construction.
2. **A spawn is a fact, not a resource.** Starting a child is something that *happened*; the handle
   is only how you talk to it afterwards. Then this is not a leak and the issue is a documentation
   one — `std/platform.wac` should say that an uncollected spawn still runs.

The first costs a new capability; the second costs nothing and leaves a way to make unreachable
processes. `design/system/0001`'s no-ambient-authority line reads to me as favouring the first, but
that is the operator's to settle rather than mine.

## Not a hazard while it is open

The child is unreachable but not unbounded: it exits on its own, and `wac` waits for its workers at
exit. Nothing here leaks across runs.
