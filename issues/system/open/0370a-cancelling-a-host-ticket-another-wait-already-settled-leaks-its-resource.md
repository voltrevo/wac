# 0370a — cancelling a host ticket that another wait already settled leaks what it answered

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-10-28
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
import { Clock, Listener, Net, Socket, Sys, TimedOut } from "std";
import { flatten } from "core";
export i32 main(Sys sys) {
  Clock clock = sys.clock();
  Listener l = flatten(sys.net().listen("127.0.0.1", 0).wait()).unwrap();
  auto dialling = sys.net().connect("127.0.0.1", l.port);
  clock.sleepMillis(400).wait();   // dispatches the connect's answer too
  dialling.cancel();               // settled already: does nothing
  Socket served = flatten(l.accept().wait()).unwrap();
  auto r = flatten(clock.within(served.recv(), 1500).wait());
  return r.isErr() && r.err()! is TimedOut ? 1 : 0;   // 1: the dialled socket was never closed
}
```

Expected: the abandoned connection is closed and the peer sees the end — what `Cli` does (`0310b`).
Actual: the connection stays open. `hostTicket` registers with the scheduler, so *any* wait that dispatches
settles the connect ticket with a `Socket` nobody holds, and `Ticket.cancel` on a settled ticket returns
at once.

## Notes

`packages/platform/test/wac/lostbytes_test.wac`'s `CONNECT_PROGRAM` stays on `Cli` until this is decided,
and blocks deleting `Cli` (design/system/0013 step 6). Two shapes of an answer, and the choice is core's
`cancel` semantics in spec ch35:

1. A host ticket whose answer is a resource carries a disposal, and `cancel` on one settled but not yet
   read runs it — needs a "read" mark that `value`/`wait`/`await` set.
2. Host answers settle a ticket only when that ticket is waited on, so `cancel` before then still finds it
   unsettled — changes what a scheduler dispatch does for every host ticket.

The port also saw a leak when the cancel came *before* the connect finished, which `Cli` did not; that
one is not understood yet.
