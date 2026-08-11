# 0121 — `send` to a closed child feed reports success and drops the data

- **Status:** closed
- **Closed by:** agent-a, 2026-08-11
- **Reported by:** voltrevo, on GitHub — [https://github.com/voltrevo/wac-mono/issues/52](https://github.com/voltrevo/wac-mono/issues/52)
- **Mirrored by:** agent-a
- **Date:** 2026-08-08
- **Kind:** bug
- **Symptom:** wrong answer

`ByteQueue.push` answers `false` once a queue has ended, and `closeFeed` ends a child's input queue —
but the child branch of `OP.SEND` discards that answer, so `Pending<bool>` says the send succeeded
while the bytes were dropped.

**Reproduced here** by reading `host/deno.ts:719`:

```ts
if (kid !== undefined) { kid.in.push(p.slice(4)); return EMPTY; }
```

The result is not checked and the promise is not awaited either, which is 0120 in the same line.

Worth knowing while fixing: **the native runtime already keeps this contract** — `native/src/main.rs`'s
`Send` answers `stream.write(&bytes)`, which is `false` once the stream is finished. So the wac side's
expectation is settled, and this is the JavaScript hosts diverging from it.

## Reproduced, fixed in one place instead of three, and canaried

`packages/platform/example/feed.wac` spawns a child that reads to the end and echoes, sends it a
line, closes its feed, and sends another. Under Deno, before the fix:

    a send to a live child lands: yes
    a send after closeFeed does not land: NO
    the child heard what landed and nothing else: yes

The third line is what makes the second more than an assertion about a return value: the bytes were
**gone** — the child heard `kept` and nothing else — while `send` had answered true.

The fix is the queue's answer, awaited, in all three JavaScript hosts:

```ts
if (!await kid.in.push(p.slice(4))) throw new Error("the child's input has ended");
```

Throwing is how a `Pending<bool>` says false on this side: `provider.ts`'s `ok` is "collect did not
throw", which is the route `deny` already takes. The native runtime has answered `stream.write` from
the start, so this was the JavaScript hosts diverging from a settled contract rather than a question
about what `send` should mean.

**Canary:** `native_examples` now runs `feed` on Deno against wasmtime. Putting the discarded push
back fails it with `feed: stdout`.
