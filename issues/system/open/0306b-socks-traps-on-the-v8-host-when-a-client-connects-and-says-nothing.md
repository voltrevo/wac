# 0306 — `socks` traps on the native v8 host when a client connects and says nothing

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** `wac: packages/tor/src/socks.wac trapped`, and the proxy is gone. Intermittent — about
  one run in four or five, so a single clean run means nothing.

## It is the async proxy on the v8 host, and it is intermittent

**No `$trap$message`**, which narrows it: ordinary wac runtime traps — bounds, null — carry text, so
this is not one of those. And the rate is the single most important fact about it, and the one I did
not have when this was filed.

| arm | trapped |
|---|---|
| async proxy, **v8** host with `0304b`'s fix | 2 of 9 |
| async proxy, **v8** host without it | 2 of 6 |
| async proxy, **Deno** host | 0 of 6 |
| async proxy, **wasmtime** host | 0 of 6 |

**So it is the v8 host.** Twelve clean runs on the two other hosts against roughly one in four on
this one is about 3% by chance. The same module, the same `socks.wac`, the same network: two hosts
carry it and one traps. That moves this off the wac code, which is where it was filed.

Testing the wasmtime arm needed its seed rebuilt — its binary carried one from before `Core`/`Cli`,
which is the gap recorded as "could not ask" when `issues/system/0304b` was closed.
`./bootstrap.sh --host wasmtime` is the price, and it is now paid.

## Correction: `0304b` is not involved, and the first version of this issue said it was

This was filed as the interaction of two changes — the async rewrite and `0304b`'s close fix —
on the strength of four controls that were **one run each**. Against a failure that fires about
20% of the time, a single clean run says nothing, and "no trap without the fix" was a coin landing
heads. Repeated, the two v8 arms are indistinguishable.

That mattered beyond bookkeeping: the mitigation offered was to revert `0304b`, which would have
removed a real fix for a bug it has nothing to do with and left this one exactly where it is.

## What is ruled out, by reduction rather than by argument

A standalone server with the proxy's shape does **not** trap, run repeatedly: an `async` accept pump,
one pump per client, a `Vec<Client>` with `swapRemove`, a `gone` flag, `main` driving `core.drainFor`,
and a pump that closes *other* parked pumps' sockets from inside its own continuation. It is in
`packages/platform/test/wac/` while this is open.

Also ruled out: a nested `waitAny` inside a continuation — `startCircuit` only does
`randomBytes().wait()`; and fixed-size machine state — `asyncsynth` allocates a machine's cells
per call, not from a program-wide table.

## Reproduction

`packages/tor/test/wac/socksnet_test.wac` with a block that opens a TCP connection to the proxy port,
sends nothing, and closes it. Everything before that in the case passes — the network stands up, a
stream is carried, `stream 1 ended: done` is logged — and the trap follows.

That block is **not committed**, because it would make the shared suite red for a bug that is
written down here. The trap is reachable from the pushed tree; it is the test for it that is not.

## What to do next

The Deno host does not trap, so it cannot name the frame. The wasmtime host in `native/` would, and
its binary carries a seed built before `Core`/`Cli`, so `./bootstrap.sh --host wasmtime` is the
price of a real stack.

The other thread worth pulling is the missing `$trap$message`. Whatever traps is not going through
the path that sets one, which is a much smaller search than "somewhere in the proxy".
