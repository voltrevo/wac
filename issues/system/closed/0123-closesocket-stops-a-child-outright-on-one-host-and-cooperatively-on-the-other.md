# 0123 — `closeSocket` stops a child outright on one host and cooperatively on the other

- **Status:** closed
- **Reported by:** agent-a
- **Date:** 2026-08-09
- **Kind:** bug
- **Symptom:** wrong answer

`platform.wac` says of `spawn` that "`closeSocket(handle)` stops it". Both hosts implement
something for that and they are not the same thing.

- **`host/deno.ts`** — `children.get(h)?.in.end(); children.get(h)?.kill()`. The worker is
  terminated. Whatever it was doing stops at that instant.
- **`native/src/main.rs`** — `c.stdin.finish(); c.stdout.finish(); c.stderr.finish()`, and the
  comment says so plainly: "Every queue is finished, so the child's next write answers false and
  it is written to notice." The thread keeps running until the child chooses to stop.

So the capability's guarantee is "terminated" on one host and "asked to stop" on the other, and
the shared contract states the stronger of the two.

## Why it has not shown up

Every program in this repo writes. `kill %1` on a background `seq 1 300000` ends it on both hosts
— measured, and `packages/platform/test/native_hostfs.test.ts` asserts it — because `seq`'s next
write fails and it returns. A child that *computed* without writing would run to completion on the
native host and be killed on the JavaScript one, and there is no applet here that does that, which
is why this is filed rather than demonstrated.

## Reproduction

None that this repo can run today. Writing one means an applet that loops without writing, which
would exist only to prove this, and design/0001 D6 is against building something whose purpose is
to look like a case.

## What it would take

wasmtime supports **epoch-based interruption**: `Config::epoch_interruption`, a ticker that calls
`Engine::increment_epoch`, and `Store::set_epoch_deadline` per instance. A deadline set to "now"
traps the guest wherever it is, which is what termination means for wasm. That is a real change to
the runtime's store setup and to how a trapped child is reported, and it wants deciding rather than
adding in passing — in particular whether a trapped child's exit status is distinguishable from one
that returned.

Until then the contract in `platform.wac` states the weaker guarantee, which is the honest one:
depend on the child's streams ending, not on the instant it stops.

## Notes

Found while making `kill %1` end a background job (design/0001 step 3's criterion). The signal
route could not reach a job at all — a spawned child is a separate instance with its own process
table, so the row this shell writes on is one nothing over there reads — and `closeSocket` is what
does reach it. Looking at what "stops it" means on each host is what turned this up.

## Closed — 2026-08-09

**The runtime interrupts the child now**, which is what the JavaScript hosts were already doing by
terminating a worker. `Config::epoch_interruption`, one ticker thread advancing the engine's epoch
every 5 ms, and a per-store deadline callback that turns a `stop` flag into a trap. `closeSocket`
sets the flag and finishes the queues: the flag is termination, and the queues are still what the
child's *parent* needs, since a reader parked on its output has to find out either way.

**The reproduction this said did not exist, exists** — `packages/platform/example/stop.wac`, in the
two-host differential. A child says one line, so the parent knows it reached the loop, and then
computes for ever without writing; the parent stops it and asks for its status. Both hosts print
`stopped: -1`. Reverting the flag alone leaves the native host spinning until the test's timeout,
which is what the canary run showed before this was committed.

**And a second half nobody had asked about**, found while writing the reproduction: *every* host
dropped the child at `closeSocket`, so the status could not be asked for afterwards. Deno and Node
threw "not a spawned worker" — which takes the parent down, on a call platform.wac describes as
ordinary — and the native runtime read the now-unknown handle as the *other* meaning of `exitCode`
and silently set the caller's own exit status to the handle number. All four hosts keep the child
now, and answer -1: "no status of its own". Stopping something and finding out it is gone is one
operation in two halves, and a supervisor needs both.

The trapped child's status is **-1**, the same as a terminated worker's, so nothing had to learn a
new number. What is still true: a *trap* and a clean return are not distinguishable to the parent,
because -1 is what both a killed worker and a stopped instance answer. That is deliberate — the
parent asked for the stop.
