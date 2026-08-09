# 0123 — `closeSocket` stops a child outright on one host and cooperatively on the other

- **Status:** open
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
