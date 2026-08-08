# 0121 — `send` to a closed child feed reports success and drops the data

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
