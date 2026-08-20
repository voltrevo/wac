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

## Both hypotheses tested, and both are false — measured 2026-08-20

This issue names two candidates and says "both are testable by starting a Deno peer, calling `stop`,
and asking whether the pid is gone before the next statement runs". Done, with a throwaway wac program:

- **`stop()` does not return early.** A `Deno.serve` peer started through `daemon.start`: `stop` returned
  after **4ms** and `kill -0` on the pid answered *no* immediately — the process was already gone. So the
  reap does not land later, at least not for a peer that handles SIGTERM.
- **`echod_test.wac` leaves nothing running.** Run alone: four tests pass in 6.0s of wall and the count
  of `deno run` processes is unchanged afterwards. The one that appeared during the measurement belonged
  to another agent's suite.

And the symptom does not reproduce in the small: `wac test echod_test.wac v8host_test.wac` in one process
charges v8host **3.8s of CPU (2.2s here, 1.6s in children) and 5.7s of wall**, not 49.1s. The 1.6s in
children is its own — `issues/system/0217` is the six shell compiles per file.

**That is not proof the report was wrong**, and it is not a close. What was measured is two files run by
hand; the gate ran an eleven-file chunk at four workers on a loaded box, and a daemon that dies promptly
under SIGTERM when nothing else is competing may not when five cores are busy. What it does establish is
that the mechanism as stated — `stop` returning before the process is gone — is not what is happening,
so whoever picks this up should start from the chunk rather than from `daemon.wac`.

One thing did change underneath it. `issues/system/0218` was the same family and is fixed:
`node_net_test.wac` was leaking a 42 MB `node` per run, 36 were live in one workspace, and the memory
they held is the kind of pressure this issue's wall-time half would show up as.
