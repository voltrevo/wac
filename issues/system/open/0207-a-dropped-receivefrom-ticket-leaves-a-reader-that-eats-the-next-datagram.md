# 0207 — a dropped `receiveFrom` ticket leaves a reader that eats the next datagram

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-18
- **Kind:** bug
- **Symptom:** wrong answer — a datagram arrives, is read by nobody, and is gone

**Mine, and it arrived with the fix for [0206](../closed/0206-receivefrom-blocks-at-the-call-so-a-datagram-read-cannot-be-time-bounded.md).**
That made `Cap::ReceiveFrom` submit a ticket and do `recv_from` on a thread, so `waitAny` can bound
it. What it did not do is say what happens to the thread when the caller gives up: it stays blocked
on the socket, and the *next* datagram to arrive is taken by it and handed to `Tickets::complete`
for an id that is no longer live —

```rust
pub fn complete(&self, id: i32, answer: Answer) {
    let mut inner = self.inner.lock().unwrap();
    if !inner.live.remove(&id) {
        // Cancelled, or completed twice. Dropping the value is right for the first …
        return;
    }
```

— where it is dropped. The comment is right about a *cancelled computation* and wrong about a
datagram: nothing recomputes it, and the peer will not send it again.

## Reproduction

No server, no network beyond loopback: one socket sends to itself, so nothing outside the program
can explain the result.

```wac
import { Core, Cli, Datagram, Pending, Socket } from "../packages/platform/src/platform.wac";

export i32 main(Core core, Cli cli) {
  u8[] msg = u8[4](fill: 65);

  Socket a = cli.bindDatagram("127.0.0.1", 0).wait();          // control
  cli.sendTo(a.handle, "127.0.0.1", a.port, msg).wait();
  Pending<Datagram> p1 = cli.receiveFrom(a.handle);
  core.log(core.waitAny(i32[](p1.id), 2000) < 0 ? "NOTHING" : "got it");

  Socket b = cli.bindDatagram("127.0.0.1", 0).wait();          // one ticket dropped first
  Pending<Datagram> abandoned = cli.receiveFrom(b.handle);
  core.waitAny(i32[](abandoned.id), 300);                      // -1, nothing sent yet
  abandoned.drop(abandoned.id);
  cli.sendTo(b.handle, "127.0.0.1", b.port, msg).wait();
  Pending<Datagram> p2 = cli.receiveFrom(b.handle);
  core.log(core.waitAny(i32[](p2.id), 2000) < 0 ? "NOTHING" : "got it");
  return 0;
}
```

Expected: `got it` twice.
Actual:

```
── control: no dropped ticket
   got -> 4
── with one dropped ticket outstanding first
   abandoned wait -> -1
   got -> NOTHING — the abandoned reader took it
```

## Notes

**What makes it easy to miss.** The natural retry loop binds a *fresh* socket each time, and then
the abandoned reader is blocked on a socket that gets closed, so it errors out and takes nothing.
`packages/webrtc/test/wac/stun_test.wac` is written that way and passes; it was
`packages/webrtc/test/wac/dtls_test.wac`, which must keep one source port across a DTLS flight, that
found this. So the bug is invisible to exactly the pattern most callers reach for first.

**The rule callers need until this is fixed:** never drop a `receiveFrom` ticket and then reuse that
socket. Poll for readiness on throwaway sockets, and give the real exchange a deadline generous
enough that a timeout means failure rather than "try again".

**A sketch of the fix**, which is more than a line and is why this is filed rather than done:

- give each datagram socket a queue of arrived-but-unclaimed datagrams, cleared by `closeSocket`;
- `Tickets::complete` returns the answer back to the caller when the id was not live, instead of
  dropping it — and `drop_ticket` likewise, for the race where the datagram lands between the
  timeout and the drop;
- `Cap::ReceiveFrom` drains that queue first and only spawns a reader when it is empty, and its
  thread pushes into the queue whatever `complete` hands back.

The Deno host does not have this, because `submit(b, OP.RECEIVE_FROM, …)` is a request on a ring the
host answers in order rather than a thread parked in a syscall. So this is the native host's alone,
and the two disagree again — which is the same shape as 0206 and worth fixing for the same reason.
