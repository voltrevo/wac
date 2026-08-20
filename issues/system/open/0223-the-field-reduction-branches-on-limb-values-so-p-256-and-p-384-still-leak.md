# 0223 — the field reduction branches on limb values, so P-256 and P-384 still leak

- **Status:** open
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

`packages/crypto/test/wac/constanttime_test.wac` records this as a known leak, and asserts the *file*
rather than the line so that an edit above it is not a failure. It also asserts that nothing in
`weierstrass.wac` diverges, which is `0210`'s regression test.

`packages/crypto/README.md`'s side-channel table has the row and the event count.
