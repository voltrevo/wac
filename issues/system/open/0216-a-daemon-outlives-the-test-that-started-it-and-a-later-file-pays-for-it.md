# 0216 — a daemon outlives the test that started it, and a later file pays for it

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-19
- **Kind:** performance
- **Symptom:** wrong answer (in a measurement, not in a program)

## What was seen

The suite charged `packages/platform/test/wac/v8host_test.wac` **49.1s of CPU and 49.6s of wall** in the
2026-08-19 gate. On its own that file is **1.6s of CPU and 1.2s of wall**, and its whole eleven-file
chunk, run by hand in the same order, is **12.3s** with v8host at 1.6s. The number does not belong to
it.

v8host is the **last** file of that chunk. Two files earlier, `echod_test.wac` starts daemons —
`start(cli, "deno run -A --unstable-net …")` for a peer, twice. A child's CPU is added to
`/proc/self/stat`'s `cutime`/`cstime` **when it is reaped**, not while it runs, so a daemon that is
still alive when its own file finishes hands its whole cost to whichever file happens to reap it.

`wac test` now reports the two halves apart for exactly this reason, so the next occurrence reads as
*"0.4s here, 48.7s in children"* rather than as a slow file. What it cannot show is *whose* child it
was.

## Why it is worth fixing rather than just annotating

The wall time moved too — 49.6s — so this is not only an accounting artefact. A file that waits
three-quarters of a minute for someone else's daemon to die is 49s of the gate, and the gate is what
everyone waits for. Either

- `stop()` in `packages/wactest/src/daemon.wac` returns before the process is gone, and the reap lands
  later, or
- the daemon ignores the signal for tens of seconds and something later blocks on it.

Both are testable by starting a Deno peer, calling `stop`, and asking whether the pid is gone before the
next statement runs.

## What is *not* the cause, so nobody re-measures it

- **Not contention for CPU.** CPU time does not move when a neighbour runs, which is the whole reason
  the ranking was changed to CPU.
- **Not memory pressure.** Four copies of that chunk at once produced **ten major faults and zero
  swapouts** on a machine with 11.9 GB and 6 GB available.
- **Not the file's position as such.** Running the chunk with v8host first leaves it at 1.6s and does
  not move the cost to the new last file.

## A second finding from the same measurement

`echod_test.wac` is under the one-second floor in a normal suite pass, but four copies of its chunk at
once put it at **2.0–5.4s of CPU against 33.6s, 65.5s and 97.5s of wall** — all of it blocked, almost
certainly on a port. That configuration does not arise in the suite, which runs each file once, so it is
recorded here as a property of the test rather than as a problem to fix: it is a test that stops being
about anything if two of it ever run at once.
