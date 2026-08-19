# 0215 — a socket can only be closed outright, so a wac client cannot say it is done speaking

- **Status:** open
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
