# 0223 — the field reduction branches on limb values, so P-256 and P-384 still leak

- **Status:** closed
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-20
- **Kind:** bug
- **Symptom:** no error

## What it is

`packages/crypto/src/fieldp.wac`'s `reduceWide` skips a limb of the wide product when it happens to be
zero, and folds a carry a number of times that depends on the value:

```wac
for (i32 j = c.len() - 1; j >= n; j--) {
  i64 v = c[j];
  if (v != 0) {                                  // <- fieldp.wac:268
    c[j] = 0;
    i32 base = j - n;
    for (i32 k = 0; k < n; k++) {
      if (fv[k] != 0) { c[base + k] += fv[k] * v; }
    }
  }
}
…
i64 k = normalise(h);
while (k != 0) {
  i64[] src = k > 0 ? foldLimbs(n) : complementLimbs(n);
  …
}
```

Every one of those tests a value derived from the operands. In a scalar multiplication the operands are
the accumulator, which is a function of the secret scalar.

## Measured

`packages/crypto/tools/ct.wac`, two valid P-256 private keys through `p256PublicKey`:

    events: 6,266,534 per run
    first divergence: branch at packages/crypto/src/fieldp.wac:268
    the trace does not part anywhere in weierstrass.wac

## Why it was not seen before

**It was behind the ladder.** `issues/system/0210` was `jacMul` adding only when the scalar bit was set,
and `ctcompare` reports the *first* divergence — so while the two runs parted at the first differing
scalar bit, nothing downstream of that could be observed. Fixing the ladder is what made this visible,
which is the ordinary shape of a short-circuiting instrument: the second fault is unreachable while the
first is live.

That also means the impact `0210` describes is unchanged. Every P-256 and P-384 operation carries a
secret scalar — the private key in `curvePublicKey` and `curveEcdh`, the **nonce** in ECDSA signing,
where a partial leak recovers the key rather than merely revealing it — and in this repository that is
`packages/tls`'s certificate chains and `packages/ssh`'s host keys.

## Who else reaches it

`fieldp.wac` is the field arithmetic for both NIST curves. `packages/crypto/src/rsagen.wac` and
`rsa.wac` use `Big` rather than this, so RSA is a separate question and is not measured at all yet —
`modPowSecret` exists and nothing has traced it.

## Why this is harder than 0210 was

The ladder's fix was local: compute both answers, select one. This is the inner loop of every field
operation, and the obvious constant-time rewrite — always fold, always take the carry path — costs on
every multiply rather than once per bit. `x25519`'s `field25519.wac` is the shape to copy and the
comparison to make: it is uniform across 1.8 million events with a fixed ten-limb layout and no
data-dependent iteration count, and it is *faster* than this per operation. So the answer may be to make
`fieldp.wac` look like `field25519.wac` rather than to sprinkle selects through the current one.

Worth doing in the same pass: `normalise` and `foldVector` should be read for the same shape, and the
`k > 0 ? … : …` ternary is a branch — `spec/spec` counts `ternary-then` and `ternary-else` as branch
points, so a select has to be written as a mask.

## Notes

`packages/crypto/test/wac/constanttime_test.wac` recorded this as a known leak until it was fixed.
The test is now `test_p256_public_key_does_not_vary_with_the_private_key`, in the uniform section
with x25519 — and it needs a journal of 2^24 slots, because 8.19 million events do not fit the
compiler's default and `ctcompare` answers `truncated`, which is not a pass.

`packages/crypto/README.md`'s side-channel table has the row and the event count.

## Fixed — 2026-08-20

`p256PublicKey` is **uniform over 8,190,725 events**. Five changes, and the interesting thing is
that the expensive one predicted above was not needed:

- **`subInto`'s borrow** is `(d >> 63) & 1` instead of `d < 0 ? 1 : 0`. Same value, and not a branch.
- **`reduceOnce` does the subtraction either way** and keeps one of the two answers with a mask. It
  no longer calls `lessThan` at all: `subInto`'s borrow out already answers "is h below p", for the
  cost of the subtraction that was coming next anyway. The comparison it replaced was worse than a
  branch — its loop *returned early* on the first differing limb, so how many limbs it read was a
  function of the value.
- **`fpAdd` and `fpSub`** the same way, on the carry and the borrow.
- **`reduceWide`'s stage 1 folds every word**, rather than skipping the ones that happen to be zero.
  The inner `if (fv[k] != 0)` stays: `fv` is a function of the limb count alone, so it takes the same
  direction for every operand, and dropping it would double that loop for no secrecy.
- **`reduceWide`'s carry fold runs a fixed four passes**, and folds `fv[i] * k` directly. That last
  part is why this was cheaper than expected — `foldVector` *is* the fold as signed limbs, and `h`
  holds signed limbs between normalisations, so one line handles either sign of `k`. The old code
  converted `k` to a magnitude and picked between `fold` and `p - fold` because it was adding into an
  array it wanted to keep non-negative; `foldLimbs` and `complementLimbs` existed only for that
  choice and are gone with it.

**The bound on the passes is argued, and the argument is guarded.** Three is the argument written at
`reduceWide`; four is what runs; `if (k != 0) { trap; }` is after the loop. That trap was
canaried rather than assumed: `FOLD_ROUNDS` at 1 traps `nistcurve_test.wac` immediately and at 2 the
whole of it passes, so this corpus needs two passes and there is a margin of two.

**Not the rewrite this issue proposed.** It said the answer "may be to make `fieldp.wac` look like
`field25519.wac`", and that turned out to be unnecessary: the leaks were the conditional subtractions
and the fold loop, not the limb layout. The layout is still what makes `field25519.wac` faster, which
is a performance question and now the only one.

| | before | after |
|---|---:|---:|
| `p256PublicKey`, events per run | 6,266,534 | 8,190,725 |
| `p256PublicKey`, per call | 2.08ms | 2.37ms |
| `p256Sign`, per call | 12.9ms | 13.0ms |

Fourteen per cent, against the "costs on every multiply rather than once per bit" this issue warned
about. Signing does not move measurably, because the scalar multiplication is 2.4ms of it.

## And it revealed the next one, exactly as 0210 revealed this

Signing not moving is the tell. `issues/system/0224` is `scMul` — arithmetic modulo the group
*order*, byte-at-a-time double-and-add, adding only when the bit is set, which is `0210`'s defect in
a second field. It was invisible here because **the side-channel table had no `p256Sign` row**:
`p256PublicKey` never calls `scMul`. It has one now, and it says `weierstrass.wac:276`.

The RSA question above is still open and still unmeasured.
