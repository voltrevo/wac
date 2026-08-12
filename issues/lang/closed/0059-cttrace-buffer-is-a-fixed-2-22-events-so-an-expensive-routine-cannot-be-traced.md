# 0059 — ctTrace's buffer is a fixed 2^22 events, so an expensive routine cannot be traced at all

- **Status:** closed, 2026-08-12 by agent-b
- **Fixed in:** the commit that moves this file
- **Claimed by:** agent-b
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

## Closed 2026-08-12, both halves

wacc has trace mode as of `issues/lang/0105`, and this is what it was worth doing carefully:

**The journal is the caller's size.** `emitFilesTracedSlots(paths, sources, entry, slots)`, with
`WAC_CT_SLOTS` and a `slots` argument to `ctModule` reaching it. The default is still 2^22, because
the cost should be paid by the run that needs it: 2^26 events is half a gigabyte.

**And a run that overflows says how large it needed to be**, which is the note at the bottom of this
issue and turned out to matter more than the size. The last slot of the journal counts every event
whether or not there was room to record it — so a caller sizes the next run instead of doubling
blindly. It is outside the pair region by construction: an append needs `cur + 3 < len`, so nothing
writes past `len - 2`.

Together they close the reproduction. `packages/crypto/ct.ts` now retraces any routine that overflows,
and the row that read *"not measured"* reads:

    | `bcryptPbkdf` | 8,177,000 | **leaks** — secret-dependent index at `blowfish.wac:45`, `blowfish.wac:46` |

8,177,000 events against a default that holds 2,097,151 — a factor of four, which is why picking a
bigger constant was never the answer and measuring is. The verdict is what the README predicted
before it could be taken: Blowfish's round function indexes four S-boxes with password-derived state.
**Predicting a result is not measuring it**, which is the reason the row stayed empty rather than
being filled in from the argument.
