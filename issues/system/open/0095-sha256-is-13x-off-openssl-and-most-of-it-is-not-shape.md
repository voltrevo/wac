# 0095 — `sha256` is 13x off OpenSSL, and most of that is not a shape problem

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-08-06
- **Kind:** performance
- **Symptom:** not implemented

Filed **with the measurement first**, because the obvious next move after 0035 is to give `sha256` the
treatment `chacha20` and `keccak` got, and the numbers say it is worth about a third of what those were
for several times the ugliness. Somebody should decide that deliberately rather than discover it.

## The figures predate two changes to the emitter — 2026-08-14

Not re-measured, because the machine has had three agents' suites on it all day and a throughput
number taken under load is worse than none. Flagged rather than left, since exactly this staleness
in `issues/system/0129` was what made its `wasm-opt` arithmetic misleading.

Two things have moved under these numbers since they were taken. `design/lang/0002` made every
`fn[…]` value a `{funcref, env}` pair, which grew `platform/example/wc.wac`'s module by 15.6%; and
`issues/lang/0127` changed what `as!` emits — `packages/crypto/src/sha1.wac` has fourteen `as!`
sites, though they are literal casts and measured byte-identical before and after, so that one is
expected to be neutral.

Whoever re-runs `deno task bench:hash` should do it on a quiet box and say so, and the interesting
number is not the 13x — which this issue already establishes is mostly the SHA extensions — but
whether the **2x shape gap** it identifies has moved.

**Checked for a regression later the same day**, when the load fell to 1.6 on five cores. Not a
quiet box and not offered as a precise figure — the question was only whether the two changes cost
anything large:

| | now | as recorded above |
|---|---|---|
| sha256 | 168–177 MB/s | 165 |
| node's sha256 | 2,153–2,261 | 2,182 |
| ratio | 12.3–13.0x | 13x |
| sha512 | 200–220 | 238 |
| keccak256 | 236–245 | 250 |

Nothing moved beyond what a load average of 1.6 explains, and sha512's shortfall is the one to
re-check first if anybody wants a real figure. So the emitter changes are **not** a regression here,
and the 2x shape-gap question this issue is really about is untouched — it still wants a quiet
machine and a decision rather than a measurement.

## Where it stands

`deno task bench:hash`, 4 MB, against `node:crypto`:

| | wac | node | |
| --- | --- | --- | --- |
| sha256 | 165 MB/s | 2182 MB/s | **13x** |
| sha512 | 238 MB/s | 1336 MB/s | 5.6x |
| keccak256 | 250 MB/s | 273 MB/s | 1.1x |
| chacha20 | 339 MB/s | 821 MB/s | 2.4x (node's includes Poly1305) |

**Most of the 13x is hardware.** OpenSSL uses the SHA extensions — `sha256rnds2` does two rounds in one
instruction — and no amount of restructuring reaches that from wasm, which has no equivalent. A scalar
SHA-256 without them runs 300-400 MB/s, so the shape gap is roughly **2x, not 13x**. SHA-512 has no such
extension, which is why it sits at 5.6x with the same code shape.

## Where the time actually goes

The two halves, each run over the same number of blocks (4 MB worth), best of nine:

```
schedule   9.4 ms    41%
rounds    13.2 ms    59%
sum       22.6 ms    — and the whole hash over 4 MB is ~23 ms, so this accounts for all of it
```

Method: two exports, one running only `w[t] = σ1(w[t-2]) + w[t-7] + σ0(w[t-15]) + w[t-16]` over 48 words
per block, the other running only the 64 rounds over a schedule that is already filled. Both compiled with
`wacCompile` and called on a raw instance.

## What the rewrite would be, and what it would cost

Both halves index arrays with a runtime `t`: `w[t-2]`, `w[t-7]`, `w[t-15]`, `w[t-16]`, `w[t]`, `K[t]`.
The known answer is a **sixteen-word rolling window in locals**, with the schedule folded into the round
loop — which requires the rounds written out in units of sixteen, since only then are the window indices
constants. `K[t]` only becomes an immediate if all sixty-four rounds are written out.

That is the first case where 0035's rule — *write out one repeating unit and keep the loop over units* —
gets expensive. ChaCha's unit is a double round (32 lines) and keccak's is a round (73 lines, and the file
did not grow overall). SHA-256's unit is **sixteen rounds with a rolling window**, or sixty-four rounds if
the constants are wanted as immediates. That is where a generator starts to look reasonable, and
`packages/bls`'s `tools/genfpkernel.py` is the precedent.

Estimate before anybody starts: removing the array traffic from both halves is worth **1.3-1.5x**, i.e.
165 → 210-250 MB/s. Real, and one sixth of the headline gap.

## Who cares

`sha256` is under `packages/ssz`'s Merkle proofs and therefore the light client, under TLS 1.3's transcript
and HKDF, and under SSH's. None of those hash megabytes: they hash 32- to 200-byte messages, where the
per-call overhead 0034 removed matters more than throughput. **The megabyte case is `box sha256sum` and
nothing else.**

Which is the real argument for leaving it: the packages that call it constantly want the small-message
path to be cheap, and that is already fixed. Do the rolling window if somebody wants the number, not
because the gap looks large.
