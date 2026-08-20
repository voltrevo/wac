# 0224 — the scalar field mod n is byte-wise double-and-add, so ECDSA signing leaks and is slow

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-20
- **Kind:** bug
- **Symptom:** no error

## What it is

`packages/crypto/src/weierstrass.wac`'s arithmetic modulo the group *order* — a different field from
the coordinates, and not the one `issues/system/0210` and `issues/system/0223` were about — is
double-and-add over the bytes of its second operand, and it adds only when the bit is set:

```wac
u8[] scMul(Curve c, u8[] a, u8[] b) {
  i32 len = c.order.len();
  u8[] acc = u8[len]();
  u8[] addend = u8[len]();
  for (i32 i = 0; i < len; i++) { addend[i] = a[i]; }
  for (i32 i = 8 * len - 1; i >= 0; i--) {
    i32 bit = (b[i / 8] >> (7 - (i % 8))) & 1;
    if (bit == 1) { acc = scAdd(c, acc, addend); }     // <- weierstrass.wac:276
    addend = scAdd(c, addend, addend);
  }
  return acc;
}
```

That is the shape `0210` was filed about, in a different field. `scAdd`'s conditional subtraction
(`if (carry != 0 || cmpBE(out, n) >= 0)`), `scReduce`'s `while (cmpBE(out, c.order) >= 0)` loop and
`cmpBE`'s early return on the first differing byte are all the same kind of thing.

**Both secrets a signature has pass through the `b` position.** `ecdsaSign` calls
`scMul(c, r, priv)` — `b` is the private key — and `scInvert(c, k)`, whose squarings are
`scMul(c, base, base)` over a base derived from the nonce. A nonce leak is the worse of the two: a
partial one recovers the private key from signatures the attacker already holds.

## Measured

`packages/crypto/tools/ct.wac`, two valid P-256 private keys through `p256Sign` with the digest and
`k` held:

    events: 35,804,281 and 35,802,... per run — the two runs do not even agree on how many
    first divergence: branch at packages/crypto/src/weierstrass.wac:276

The differing event *counts* are the leak on their own: two runs of the same routine with different
private keys do different amounts of work.

## Why it was not seen until now

**There was no `p256Sign` row in the side-channel table.** `packages/crypto/tools/ct.wac` measured
`p256PublicKey`, which does not call `scMul` at all, so `scMul` was never in a trace that was
compared. `p256PublicKey` went uniform on 2026-08-20 and the table said P-256 was fine.

That is the interesting half of this. The routine most worth measuring was the one not measured, and
it was not a judgement call — the easy row went in first and nobody asked what the easy row covered.
`p256Sign` is in `ct.wac` now, at 35.8 million events a run, four times a public key's.

## It is also where P-256 signing's time goes, which `issues/system/0209` is still open about

0209's remaining question is "P-256 at 12ms". This is it. Measured on this machine, 40 operations
each, through the `wac` binary:

| | per call |
|---|---:|
| `p256PublicKey` | 2.5ms |
| `p256Ecdh` | 2.2ms |
| `p256Sign` | 13.7ms |
| `p256Verify` | 15.5ms |
| `ed25519PublicKey` | 1.1ms |
| `ed25519Sign` | 2.3ms |
| `ed25519Verify` | 2.2ms |
| `x25519Base` | 0.6ms |

A signature is 13.7ms against a 2.5ms scalar multiplication, so about eleven milliseconds are in the
order arithmetic — `scInvert` is Fermat, roughly 384 `scMul` calls, each 256 rounds of a 32-byte
`scAdd`, which is about three million byte operations per signature. The coordinates are 32-bit
limbs; the order is bytes.

So one rewrite answers both: the fix for the leak is also the fix for the factor of five over
ed25519. That is worth saying because the two would otherwise be scheduled against each other.

## The shape of the fix

Not a straight copy of `0210`'s. Making `scMul` always-add doubles the byte work, which would take a
signature from 13.7ms to something worse before the layout change brings it back — so the two halves
want doing together rather than in either order:

- the order as `i64[]` 32-bit limbs, like `fieldp.wac`, rather than `u8[]` big-endian bytes. This is
  the larger change and is what the time is;
- `scAdd`'s conditional subtraction as a mask-select on the carry, `cmpBE` as a branchless
  comparison, `scReduce` as one conditional subtraction rather than a loop — all of which
  `fieldp.wac` now has, and `selectInto` there is the helper;
- `scMul` always adding and selecting, once the above makes that affordable.

**The order is not a Solinas prime**, so `fieldp.wac`'s reduction does not carry over — that is
`reduceWide` folding `2^(32n) mod p`, and for the order there is no such short vector. Montgomery
multiplication is the usual answer and is what to price first.

## Notes

`packages/crypto/README.md`'s side-channel section carries the `p256Sign` row and says why the row
was missing. There is no known-leak test for it in `test/wac/constanttime_test.wac`, unlike `ghash`
and `aes`: two builds and two runs of 35.8 million events is about 30s, and that file is 9.1s today.
When this is fixed, the *uniformity* assertion is worth that cost; the leak assertion is not.
