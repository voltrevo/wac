# 0210 — the Weierstrass ladder branches on the secret scalar, so P-256 and P-384 leak it

- **Status:** closed
- **Reported by:** agent-c
- **Date:** 2026-08-19
- **Kind:** bug
- **Symptom:** no error

## What it is

`packages/crypto/src/weierstrass.wac`'s `jacMul` is double-and-add with the addition taken only when
the bit is set:

```wac
export Jac jacMul(Curve c, u8[] scalar, Jac p) {
  Jac acc = jacInfinity(c);
  i32 bits = 8 * byteLen(c);
  for (i32 i = 0; i < bits; i++) {
    acc = jacDouble(c, acc);
    i32 bit = (scalar[i / 8] >> (7 - (i % 8))) & 1;
    if (bit == 1) { acc = jacAdd(c, acc, p); }     // ← weierstrass.wac:120
  }
  return acc;
}
```

The work done, and the time it takes, is a function of the scalar's Hamming weight and of *which* bits
are set. `packages/crypto/src/ed25519.wac`'s `ptMul` is the same algorithm written the other way — it
always adds and then `feSelect`s the result on the bit — so the two are a matched pair showing what
the difference costs.

## Measured, by this repository's own instrument

`harness/ctTrace.ts` records every branch and every memory index, per source line. Two valid P-256
private keys through `p256PublicKey`:

    events: 1,974,551 and 2,097,151 (the second overflows the journal)
    first divergence: branch at packages/crypto/src/weierstrass.wac:120
    divergent sites: that line, and only that line

The verdict does not depend on the truncation: the traces part at the first differing bit.

`packages/crypto/test/wac/constanttime_test.wac` now records it in the same shape as the `ghash` and `aes`
leaks — asserted *as* a leak, so a fix fails the test and forces the README's table to change with it.

## Who reaches it

Every P-256 and P-384 operation, with a secret scalar in each case:

- `curvePublicKey(c, priv)` — the private key.
- `curveEcdh(c, priv, peer)` — the private key.
- ECDSA signing — the **nonce**, where a partial leak recovers the key rather than merely revealing
  it. This is the one that turns a timing observation into a compromise, and it is the reason this is
  filed as a bug rather than as a documented limitation.

In this repository that is `packages/tls`'s certificate chains and `packages/ssh`'s host keys.

## Why nobody had noticed

The side-channel table in `packages/crypto/README.md` had **no asymmetric row at all**. It listed
sha256, chachaBlock, poly1305, x25519Base, ghash, aes and bcryptPbkdf; the absence of P-256 read as
"not applicable" rather than "never measured". `test/wac/constanttime_test.wac` matched the table, so
nothing was checking it and nothing said so.

Found from the other end: `issues/system/0209` asked why `ed25519Sign` is 63ms where `p256Sign` is
12ms, and the answer to *that* is partly this — one always adds and the other does not.

## The fix, and what it costs

The shape `ptMul` already uses: compute the sum unconditionally, then select between `acc` and `acc +
p` on the bit with a constant-time select over the limbs. `packages/crypto/src/ct.wac` has the
primitives; `feSelect`'s equivalent for `fpMul`'s representation is what is needed.

It roughly doubles the additions, so expect P-256 to land near ed25519's current cost — which is the
honest trade and is what "not for production" currently stands in for. A windowed table with a
constant-time scan would take some of it back, and is a second step rather than part of this one.

Worth doing in the same pass: `jacAdd` and `jacDouble` are separate formulas, and a fixed sequence
that always calls both is only constant-time if neither of *them* branches on the point's value. The
trace above says the only divergence is at line 120 today, which is evidence for the inputs tested
rather than a proof; re-running it after the change is the check.

## Fixed — 2026-08-20

`jacMul` adds on every bit and keeps the answer with a constant-time select:

```wac
acc = jacDouble(c, acc);
i32 bit = (scalar[i / 8] >> (7 - (i % 8))) & 1;
acc = jacSelect(acc, jacAdd(c, acc, p), bit);
```

That alone was not enough, and the rest is what this issue's last paragraph asked for. `jacAdd` had
four `if`s — either operand the identity, the two equal, the two negations — and each tested a value
derived from `p`, which in the ladder is the accumulator and therefore the secret. They are computed and
selected now:

- **two need nothing.** When the points are negations, `h` is zero and `z3 = Z1·Z2·h` is zero, which is
  the identity and the right answer. When either operand is the identity its `Z` is zero, so `z3` is
  zero again — the identity, and the *wrong* answer, which the last two selects put right.
- **the doubling case is computed on every call**, because the general formula divides by `h` in effect
  and `h` is zero there. That is the cost.

`jacDouble`'s own identity guard went too: `z3` is `2YZ`, zero whenever `Z` is, so the formula answers
the identity for the identity without being told.

`fieldp.wac` gains `fpIsZeroBit`, `fpEqualsBit` and `fpSelect` — 0/1 values and a mask, not `a == b ? 1
: 0`, because a ternary is a branch: `spec/spec` counts `ternary-then` and `ternary-else` as branch
points and the tool records every branch.

### It cost far less than this issue predicted

"It roughly doubles the additions, so expect P-256 to land near ed25519's current cost." The events per
run did roughly double — 3,065,278 to **6,266,534** — and the time did not follow:

| | before | after |
|---|---:|---:|
| `p256PublicKey` | 1.3ms | 2.0ms |
| `p256Sign` | 12.1ms | 13.1ms |

Signing barely moves because the ladder is a sixth of it. `ed25519Sign` is 2.4ms, so P-256 signing stays
about five times ed25519's rather than landing beside it — and *where the other five sixths of
`p256Sign` go* is not measured, which is a thread worth pulling.

### And it revealed the leak behind it

The trace no longer parts anywhere in `weierstrass.wac`. It still parts, at `reduceWide` in
`fieldp.wac`, which skips a limb when it happens to be zero. **That was always there**: `ctcompare`
reports the first divergence, and while the ladder parted at the first differing scalar bit nothing
behind it could be seen. Filed as `issues/system/0223`; the impact this issue describes — every P-256
and P-384 operation, and the ECDSA nonce — is unchanged until that one is fixed, so this is a closed bug
rather than a solved problem.

`packages/crypto/test/wac/constanttime_test.wac` asserts the new state in both directions: that nothing
in `weierstrass.wac` diverges, and that `fieldp.wac` does. The first is the regression test for this
fix; the second is the known leak, and it names the *file* rather than the line, because a line number
in a test is an entry that drifts.
