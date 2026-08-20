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

## The branches are fixed — 2026-08-20 — and the layout is what is left

`scMul` adds on every bit and keeps the answer with a mask. `scAdd` does its reduction either way and
selects on `carry | !borrow`. `scReduce` is one conditional subtraction rather than a loop, which is
sound because both orders start `0xFF` and a value of the order's length is therefore below 2n. And
`cmpBE` reads every byte.

**`cmpBE` is the one no measurement caught.** It returned on the first byte that differed, so how many
bytes it read was a function of the value — and `curvePublicKey` and `ecdsaSign` both call it on the
secret to check it is below n. `p256PublicKey` measured *uniform over 8.19 million events* while that
was still there, because both secrets `ct.wac` compares differ from n in their **first** byte, so both
runs left the loop at i=0 and agreed. A differential is only as wide as its inputs; this one was fixed
by reading the code, and the fix is by construction rather than by measurement.

The three byte-level rewrites were model-checked exhaustively before being trusted — `cmpBE` against
lexicographic order over all 46,656 three-byte pairs from a six-value alphabet, `scAdd` and
`scReduce` against 30,000 random moduli and operands each at three lengths, zero mismatches — because
"the NIST vectors still pass" says nothing about the inputs the vectors do not contain.

`test_the_scalar_multiply_mod_the_order_does_not_vary_with_its_operand` guards it, and it guards
`scMul` rather than `p256Sign`: a signature is 93 million traced events and a journal that holds one
is over a gigabyte, where a single `scMul` is about fifty thousand. `p256_probe.wac` exports it for
that. Canaried — putting `if (bit == 1)` back fails the test and names `weierstrass.wac:321`.

### What it costs, and the part of it that is pure loss

A/B on one program, three rounds, with `ed25519Sign` as a control that does not touch this code:

| | before | after |
|---|---:|---:|
| `p256PublicKey` | 2.52ms | 2.50ms |
| `p256Sign` | 13.4ms | **24.9ms** |
| `p256Verify` | 16.0ms | **26.9ms** |
| `ed25519Sign` (control) | 2.4ms | 2.3ms |

Traced events for a signature: 35.8 million to 92.9 million, and the two runs now agree on the count.

**Verification has no secret in it at all**, so its 1.68× is bought for nothing: `ecdsaVerify` inverts
`s` and multiplies by `r` and the digest scalar, every one of which is on the wire. It is paid because
the alternative is a second implementation of the same arithmetic selected by whether the caller
thinks its operands are public, and that is how a fast path ends up on a secret. The right answer is
to make the constant-time version *faster than the variable-time one it replaced*, which the layout
change does — and X.509 chain verification is `packages/tls`'s hot path, so this is the strongest
argument for doing it soon rather than the weakest.

## The shape of the fix that remains

**The branch half is done; what is left is the layout**, and it is the whole of the remaining time:
the order as `i64[]` 32-bit limbs, like `fieldp.wac`, rather than `u8[]` big-endian bytes. Every pass
in `scAdd` and `scSelect` is currently 32 or 48 bytes where it could be 8 or 12 limbs, and `scMul` is
bit-serial where a limb layout makes it a schoolbook `n²` multiply — 64 products for P-256 against
256 rounds of a 32-byte add. That is where the 24.9ms goes and where it comes back from.

**The order is not a Solinas prime**, so `fieldp.wac`'s reduction does not carry over — that is
`reduceWide` folding `2^(32n) mod p`, and for the order there is no such short vector. Montgomery
multiplication is the usual answer and is what to price first.

## Notes

`packages/crypto/README.md`'s side-channel section carries the `p256Sign` row and says why the row
was missing. `test/wac/constanttime_test.wac` asserts the uniformity on
`scMul` through `p256_probe.wac` rather than on `p256Sign`, which is what makes it affordable — a
signature's journal is over a gigabyte and one `scMul` is fifty thousand events.
