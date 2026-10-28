# 0359a — the ring fuzz answered a request with another request's bytes, under load

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-10-02
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

Not reproducible on demand. In a full `wac task test` run (four lanes plus the Deno pass, 2026-10-02):

```
./packages/platform/test/fuzz.test.ts => the ring keeps its invariants under random load ... FAILED
error: Error: seed 1009 (off): answer for 80 is 166584 bytes, wanted 1767
```

The same file passed three targeted runs straight after (`deno test -A packages/platform/test/fuzz.test.ts`).

Expected: the answer for request 80 is the 1767 bytes asked for.
Actual: 166,584 bytes — two orders of magnitude more, so not a truncation or an off-by-one but very likely
some other request's answer.

## Notes

`closed/0155` is the same shape (a seed failing inside a full suite run and passing every re-run), and was
closed by correcting the file's header: the inputs replay, the interleaving does not. This one is in the
`off` scheduler mode, which the header calls production, and the header also says that with scheduling
off *"the window a recycled slot needs simply does not open"* — so either a window opens there under load
that the header says cannot, or something besides slot recycling hands one request another's answer.
Either way it is a wrong answer from the bridge rather than a slow one.

Not caused by the change being gated when it appeared (bindgen's generated classes: `ref`, `of`,
`toObject`); the ring and its host do not go through bindgen's glue.

**Seen again 2026-10-28** (agent-c, in a `--deno-only` pass, about 600 tests in parallel), this time
in the `seeded` mode and with the diagnosis the fuzz now prints: `seed 1009 (seeded): answer for 247 is
1812 bytes, wanted 155006 — the nonce belongs to cancelled call 241 - a recycled slot; handler read size
1812 - not the 155006 asked, so the request path corrupted it`. So it is the recycled-slot window, and
it was entered on the request path rather than on the answer path. The same seed passed four runs alone.
