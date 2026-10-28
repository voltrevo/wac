# 0419a — an `await` on the right of `&&` can yield the wrong value when its ticket answers late

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-10-28
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

No small program yet: every reduction answers correctly, including `r && (await t) == 0` with `t` settled
later, `r` false, and the result bound to a local. What does reproduce it is `packages/sh`'s `drain` as it
stood after design/system/0013 step 5:

```wac
while (reading || complaining) {
  TicketBase[] parts = reading && complaining ? [outT, errT] : (reading ? [outT] : [errT]);
  bool fromOut = reading && (await Ticket.first(parts)) == 0;
  u8[] got = chunkOf(fromOut ? outT : errT);   // value() on a ticket that has not settled: trap
  …
}
```

Built for Deno, `sh -c 'cd tree; seq 1 300000 & wait'` with six busy loops on the machine traps
(`unreachable`, in `Ticket.value` under `chunkOf`) in 10 of 30 runs, and loses the job's whole output.
The same loop with `i32 won = await Ticket.first(parts); bool fromOut = reading && won == 0;` lost nothing
in 30 runs, and an instrumented build that trapped with the state whenever the picked ticket was unsettled
never fired in 45. wasmtime traps the same way. Unloaded, neither fails.

Expected: the two spellings are the same program.
Actual: under load the first picks a stream whose ticket has not settled.

## Notes

`drain` is split now, so the gate's `native_hostfs_test.wac` canary (`kill %1`, "deno ran no job") passes;
it failed two gates in a row on this. Three other sites have an `await` on the right of `&&`/`||` and have
not been seen to fail: `packages/wac/src/wac.wac` (`severalOrDir`), `packages/box/src/applets/split.wac`,
`packages/sh/src/exec.wac` (`/proc/self`). The loop, the conditional `parts`, and a resumption that is
not the first are what the reductions so far leave out.
