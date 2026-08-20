# 0215 — a socket can only be closed outright, so a wac client cannot say it is done speaking

- **Status:** closed
- **Reported by:** agent-b
- **Date:** 2026-08-19
- **Kind:** missing feature
- **Symptom:** not implemented

## Reproduction

The exchange every request/response protocol over a raw socket needs, where the server
answers only once its input ends:

```wac
i32 s = cli.connect("127.0.0.1", port).wait();
cli.send(s, "one two three\n".toBytes());
// Now say "that is all", without saying "goodbye" — there is no call for it.
// cli.closeSocket(s) stops the socket in both directions, so the reply can never arrive.
u8[] reply = cli.recv(s).wait();     // parks: the peer is still waiting for EOF
```

Expected: a way to end the outbound direction and keep reading, the way `closeFeed` does
for a spawned child's standard input.

Actual: `Cli` has `connect`, `listen`, `accept`, `recv`, `send` and `closeSocket`, and
`closeSocket` is the only one that ends anything. `platform.wac:1802`'s `closeFeed` is
explicitly the *child* case and says so — "distinct from `closeSocket`, which stops the
child outright".

## Notes

**The argument for it is already written in the tree, one capability over.** `closeFeed`'s
doc comment says: *"A program that reads to the end before answering — `wc` is the obvious
one — needs the end to arrive while it is still running, and killing it instead means it
never speaks."* That is exactly the socket case, with the same example program. The
capability was added for children and the socket half was not.

Found porting `packages/platform/test/pipeline.test.ts` to wac (`issues/system/0161`). Its
second test — `inetd` accepting a connection and handing it to a `wc` child — connects,
writes, calls `conn.closeWrite()`, then reads the reply. The comment there says why:
*"`wc` writes nothing before EOF, so without this the exchange would return empty."* The
first test of that file moved; this one is the whole reason the file still has TypeScript
in it, and the TypeScript is not the subject — `Deno.Conn.closeWrite` is standing in for a
capability wac does not have.

So the blocked work is small and specific: with a half-close, `pipeline.test.ts` goes to
zero and one more example gets a wac-side driver.

`OP.CLOSE_SOCKET` is 26 (`host/ops.ts`), and the hosts that would need the other half are
`host/deno.ts`, `host/node.ts`, `native/` and `native/v8/`. Deno and Node both have it
(`closeWrite`, `socket.end()`); on the Rust side it is `TcpStream::shutdown(Shutdown::Write)`.
The browser host has no raw sockets, so it does not have to answer.

Not urgent for anything shipping — nothing in `packages/` needs it today, which is why it
is here rather than fixed in passing.

## Closed 2026-08-20 — `Cli.closeSend`

`fn[void(i32)] closeSend` on `Cli`, beside `closeSocket`. Ends the outbound direction and leaves the
socket readable, which is `closeFeed`'s guarantee for a child applied to the thing `closeFeed`'s own
doc comment was already describing.

**Its own opcode (`CLOSE_SEND`, 57) rather than a flag on `CLOSE_SOCKET`.** A host that did not know
about a new argument would read the call as an ordinary close, so the program would hang waiting for
a reply the host had just made unreachable. An unserved opcode fails and names itself, and the
failure a caller gets is about the call rather than about the socket.

Implemented in all five hosts: `deno.ts` (`closeWrite`), `node.ts` (`socket.end()`, through a new
optional `closeSend` on `NodeSock` so a launcher built before this does nothing rather than throwing),
`browser.ts` (refused by the same `deny("network access")` as `connect` — no raw sockets in a page,
and a program half-closing one it could never have opened should hear about the socket), and both
Rust hosts (`Shutdown::Write` against `CloseSocket`'s `Shutdown::Both`). Only a connected stream is
touched anywhere: a listener, a datagram socket and a child's queue are left alone rather than
half-closed by analogy.

`packages/platform/test/wac/pipeline_test.wac` has the case `pipeline.test.ts` was keeping the file
alive for, and **that file is deleted**. Canaried: replacing `closeSend` with `closeSocket` makes it
trap on `recv on something that is not a connected socket or a child`, so the test distinguishes the
half-close from the full one. A `closeSend` that did nothing would instead park for ever, since `wc`
answers only at EOF.

## Two things this cost, worth knowing before the next capability

**`std/platform.wac` is embedded in the compiler as generated text.** `packages/wacc/src/coretext.wac`
holds it as a string literal, written by `deno task gen:core`. Editing `std/platform.wac` and
reseeding changes nothing at all — the seed came out byte-identical, which was the tell. Run
`gen:core` first.

**Edit the whole capability before regenerating.** The struct field and `Cli.of`'s parameter list are
two places; changing one, running `gen:core` and reseeding bakes a `std/platform.wac` that cannot
compile itself into the compiler, and every build then fails on a file nobody touched.
`deno task seed:bootstrap` is the way back, exactly as CLAUDE.md says.

A hand-written world is where a new capability is noticed: `packages/sh/test/wac/probe.wac`'s own
comment says so, and it is one of the two `Cli.of` callers that needed the new argument. The other is
`packages/platform/src/frame.wac`, which passes it straight through — a frame narrows *which*
capabilities a child has, not what one of them means.
