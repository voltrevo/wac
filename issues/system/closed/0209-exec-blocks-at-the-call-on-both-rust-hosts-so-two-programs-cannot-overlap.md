# 0209 — `exec` blocks at the call on both Rust hosts, so two programs cannot overlap

- **Status:** closed — fixed in the commit that filed this
- **Claimed by:** agent-b
- **Reported by:** agent-b
- **Date:** 2026-08-19
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
export i32 main(Core core, Cli cli) {
  i64 t0 = core.nowMillis().wait();
  Pending<Exec>[] jobs = Pending<Exec>[3](fill: cli.exec("/bin/sh", string[]("-c", "true"), u8[0]()));
  for (i32 i = 0; i < 3; i++) {
    jobs[i] = cli.exec("/bin/sh", string[]("-c", "sleep 1; echo done"), u8[0]());
  }
  i64 t1 = core.nowMillis().wait();
  core.log("submitting three took " + itoa((t1 - t0) as~ i32) + "ms");
  for (i32 i = 0; i < 3; i++) { jobs[i].wait(); }
  core.log("waiting for them took " + itoa((core.nowMillis().wait() - t1) as~ i32) + "ms");
  return 0;
}
```

Three hosts, same program:

| host | submitting | waiting |
|---|---|---|
| Deno (`packages/platform/host/deno.ts`) | 8ms | 1001ms |
| v8 (`native/v8` — what `wac run` and `wac test` use) | **3012ms** | 1ms |
| wasmtime (`native` — `wacland`) | **3007ms** | 0ms |

Expected: a capability call returns a ticket and the work happens behind it, so three one-second
sleeps submitted together finish in about a second.

Actual: on both Rust hosts `exec` runs the child to completion *inside the call* and hands back a
ticket that is already answered. The caller blocks before it has an id.

## Why it matters beyond the timing

`waitAny`'s own documentation in `platform.wac` says the deadline belongs to the wait rather than to
each capability. That is only true if the capability returns before the work is done — so on these two
hosts `waitAny` could not bound an `exec` at all, and neither could anything built on it.

And it is a two-host divergence that nothing detected. A program that runs two things at once is
correct under the Deno host and silently serial under the other two; `packages/platform/test/
conformance.test.ts` is the ledger for exactly this class and its entry for `EXEC` did not distinguish
"the same answer" from "the same answer in the same way".

**Found by trying to write something that needed it.** `native_examples.test.ts` runs its fourteen
cases three at a time, deliberately, with a paragraph explaining why; porting it to wac meant asking
whether wac could express that, and the answer was no — for a reason that turned out to be a defect
rather than a property of the language.

This is the same fault as [0206](0206-receivefrom-blocks-at-the-call-so-a-datagram-read-cannot-be-time-bounded.md),
in a different capability, found the same way and fixed the same way. Two of the thirty-five
capabilities had it; the rest were not audited, and that is the follow-up worth doing.

## The fix

Submit the ticket, do the spawn/drain/wait on a thread, complete the ticket when the child ends —
which is what `accept`, `recv` and `receiveFrom` already do on both hosts. The grant refusal stays
immediate, because there is nothing to wait for.

`packages/platform/test/wac/exec_test.wac` gains
`test_two_execs_can_be_in_flight_at_once`, which asserts the submit loop takes under a second and the
whole thing under 2.5s. Watched failing against the reverted host first: *"submitting three
one-second sleeps took 3006ms, so `exec` blocked at the call rather than at the wait"*.

The bounds are loose on purpose. What is being tested is that the three overlap at all, and a bound
tight enough to be exact would fail on a machine three agents share. It fails at 3s either way, which
is the only number that matters.
