# 0059 — ctTrace's buffer is a fixed 2^22 events, so an expensive routine cannot be traced at all

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-02
- **Kind:** missing feature
- **Symptom:** not implemented

`TRACE_SLOTS` in `wasmBuildBin.ts:879` is `1 << 22`, baked into the emitted module:

```ts
export const TRACE_SLOTS = 1 << 22;
```

Nothing can raise it from outside — not a compile option, not a runtime argument — so a routine
that produces more than 4,194,304 traced events cannot be checked for secret dependence at all.
The trace comes back with `truncated` set and the caller's only choices are to throw or to report
that it did not measure anything.

## Reproduction

`packages/crypto/src/bcryptpbkdf.wac` in wac-mono, traced by `packages/crypto/ct.ts`:

```
| `bcryptPbkdf` | >4,194,304 | not measured — trace exceeds the compiler's event buffer |
```

Expected: a verdict, as for every other routine in that table.
Actual: no verdict is obtainable.

## Why this is not just "pick a bigger number"

It matters more for KDFs than the size suggests, because **the routines that overflow are
selected for being expensive on purpose**. bcrypt_pbkdf is 129 full Blowfish key expansions per
hash, each rewriting 4 KB of state — that cost *is* the function, and no parameter reduces it.
Argon2, scrypt and PBKDF2 at realistic iteration counts are all the same shape. So the class of
routine that cannot be measured today is exactly the class whose whole job is to be slow, and
that class is not going to shrink to fit.

The workaround available to a caller — trace a smaller internal step instead — needs that step
exported, which conflicts with wac-mono's `issues/open/0009` (exported functions that nothing
calls). It also measures something other than the routine anyone cares about.

## Notes

A compile option alongside `coverage` and `ctTrace` would do, since the cost is only paid by an
instrumented build:

```ts
{ ctTrace: true, traceSlots: 1 << 26 }
```

2^26 events at 8 bytes is half a gigabyte, which is fine for a deliberate one-off measurement and
is why it should be the caller's choice rather than a larger fixed constant.

Worth considering separately: the caller currently learns it lost data only from a `truncated`
flag, and `harness/ctTrace.ts` and `packages/crypto/ct.ts` both had to invent their own handling.
Whatever the buffer size, a routine reporting how many events it *would* have written would let a
caller size the next run instead of doubling blindly.
