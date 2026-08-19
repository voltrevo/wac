# 0206 — `receiveFrom` blocks at the call, so a datagram read cannot be time-bounded

- **Status:** closed — 2026-08-18, agent-b
- **Claimed by:** agent-b
- **Reported by:** agent-b
- **Date:** 2026-08-18
- **Kind:** bug
- **Symptom:** wrong answer — a program that asks for a bounded wait gets an unbounded one

`waitAny`'s own documentation says the deadline belongs to the wait rather than to each capability,
and that "this one parameter bounds `connect`, `accept`, `readFile` or a child's `exitCode` without
any of them knowing about it". That is true of those four and **not** of `receiveFrom`, which is the
one capability with no other way to stop waiting.

The native host computes it inline and only then builds the ticket, so there is no id to hand to
`waitAny` until the datagram has already arrived:

```rust
// native/v8/src/main.rs, Cap::ReceiveFrom
match sk.recv_from(&mut buf) {          // ← blocks here, on the calling thread
    Ok((n, from)) => { … }
}
match ticket_for(scope, "Datagram", answer) { … }   // ← ticket_for calls tickets.settled_now
```

`ticket_for` is the *already-finished* path. The host has `ticket_pending` for work that has not
finished, and `accept`, `recv`, `readFile`, `readDir` and `exitCode` all use it. `receiveFrom` is the
odd one out, and it is the one where it matters: a stream `recv` ends when the peer closes, and a
datagram read ends only when a datagram arrives — which may be never.

## Reproduction

```wac
import { Core, Cli, Datagram, Pending, Socket } from "../packages/platform/src/platform.wac";

export i32 main(Core core, Cli cli) {
  Socket s = cli.bindDatagram("127.0.0.1", 0).wait();
  Pending<Datagram> p = cli.receiveFrom(s.handle);        // never returns
  core.log("ticket created");                             // never printed
  i32 w = core.waitAny(i32[](p.id), 1000);
  core.log("waitAny -> " + (w < 0 ? "-1" : "0"));
  return 0;
}
```

`wac run --allow-net` on a socket nobody sends to.

Expected: `ticket created`, then `waitAny -> -1` after a second.
Actual: nothing after the bind; the program hangs for ever.

The same shape with `connect` to a closed port prints both lines and `waitAny` answers correctly, so
this is `receiveFrom` rather than the ticket machinery:

```
connect ticket created without blocking
waitAny -> 0
connect said: Connection refused (os error 111)
```

## Notes

Found while moving `packages/webrtc/test/stun.test.ts` to wac (`issues/system/0161`). That test
dials a local coturn, and there is nothing to poll for readiness — UDP has no handshake, so a socket
that is listening and one that is not both accept a `sendTo` silently, and the exchange *is* the
readiness check. With no way to bound the receive, a server that has not bound yet parks the test
for ever rather than failing it. The port is blocked on this and `stun.test.ts` stays host-side
meanwhile.

**A sleep-and-retry loop is not a workaround**, which is worth saying because it is the obvious one:
the datagram may arrive during any sleep, and the next `receiveFrom` then blocks on the *following*
one. There is no non-blocking read to pair with it, so the bound has to come from the host.

## Fixed

The first of the two candidates: `Cap::ReceiveFrom` now submits a ticket, does `recv_from` on a
thread and completes it — the same three lines `Cap::Recv` has. Nothing in `platform.wac` changed,
and the alternative (a socket read timeout) is the one `waitAny`'s documentation argues against:
"there is no `recvWithin`", because a deadline belongs to the wait.

The probe above now prints the same three lines under both hosts. `packages/quic/test/program.test.ts`,
`packages/platform/test/echod.test.ts` and `packages/tor`'s `relaycircuit_test.wac` are the datagram
users and all still pass, which is what says the *arriving* case still works — the thread is new, and
a fix that only ever answers "timed out" would satisfy the probe alone.

**The Deno host gets it right, so this is a divergence rather than a gap.** The same program, the
same argument, the two hosts:

```
$ wac run --allow-net .cache/probe/dg.wac
bound handle=ok
                                             ← hangs here for ever

$ deno run -A --unstable-net packages/platform/app.ts .cache/probe/dg.wac --allow-net
bound handle=ok
ticket id created; waiting 1000ms for a datagram nobody will send
waitAny returned -1 (timed out, correct)
dropped and closed
```

`provider.ts` routes `receiveFrom` through `submit(b, OP.RECEIVE_FROM, …)`, which is the same
asynchronous path `recv` and `accept` take, so the ticket is live and `waitAny` bounds it. That makes
the fix a matter of bringing the native host into line with a working implementation rather than
designing one — and it makes the bug worse than a missing feature, because a program that is correct
under one host parks under the other with nothing said.
