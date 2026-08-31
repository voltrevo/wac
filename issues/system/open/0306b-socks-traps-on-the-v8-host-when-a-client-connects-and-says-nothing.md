# 0306 — `socks` traps on the native v8 host when a client connects and says nothing

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** `wac: packages/tor/src/socks.wac trapped`, and the proxy is gone. One TCP connection
  that is accepted and closed without sending a byte is enough.

## Both halves are mine and both landed today

This is the interaction of two changes, neither wrong on its own:

- `socks.wac` became three `async` pumps, so a client's read is parked in its own pump and the
  proxy closes client sockets while that read is outstanding;
- `issues/system/0304b` made `closeSocket` on the native v8 host actually reach a peer that has a
  read parked, by shutting the connection down instead of dropping one of two descriptors.

## Four controls, which is what makes it a real finding rather than a guess

| proxy | host | result |
|---|---|---|
| synchronous (before the rewrite) | v8 **with** the fix | passes |
| async | v8 **without** the fix | no trap — fails the old way, deadline waits |
| async | **Deno** | passes the whole case, three streams and two clients |
| **async** | **v8 with the fix** | **traps** |

So it is neither change alone, and it is not the wac logic: the same module is fine on another host.

## What is ruled out

**Not "closing a socket with a read parked".** That was the obvious mechanism and the attempted fix
— a nullable `Pending<Read>` on `Client`, taken back with both `Core.cancel(id)` and
`Pending.cancel()` before the close — does not stop it. In the failing path the *client* closes
first, so the pump resumes from `End` and closes a socket with nothing outstanding.

**Not the client cap.** `MAX_CLIENTS` is 32 and one connection reproduces it.

**Not the backpressure poll.** That branch never runs at one client.

## Reproduction

`packages/tor/test/wac/socksnet_test.wac` with a block that opens a TCP connection to the proxy port,
sends nothing, and closes it. Everything before that in the case passes — the network stands up, a
stream is carried, `stream 1 ended: done` is logged — and the trap follows.

That block is **not committed**, because it would make the shared suite red for a bug that is
written down here. The trap is reachable from the pushed tree; it is the test for it that is not.

## What to do next

The trap is in the guest, so the guest is where the frame is. The Deno host prints a stack that
names the function where the native one prints `trapped` and stops — running the built proxy under
`.cache/built-wac-deno-cli/wac-deno-cli` was how the host difference was found in the first place, so
the same route with a *deliberately trapping* input should name it.

Failing that, the honest fallback is to revert one of the two changes and say which: the async proxy
is worth more than the close fix, and the close fix is worth more than a proxy that traps.
