# 0209 — ed25519 is five times slower than P-256, which is the wrong way round

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-19
- **Kind:** performance
- **Symptom:** no error

## Answered for ed25519, 2026-08-19 — and the answer was not the curve

`ptAdd` called `curveD2()`, which called `curveD()`, which computed `-121665 * inverse(121666)` — **a
modular inversion, about 250 field multiplications, on every point addition**, where the addition's
own arithmetic is nine. Profiled: a `ptAdd` was 287µs against ~5µs of field work, and a scalar
multiplication 33ms.

`d` and `2d` are literal limbs now, held against the derivation by
`packages/crypto/test/wac/ed25519const_test.wac`:

| | before | after |
| --- | ---: | ---: |
| `ed25519Sign` | 63ms | **2.6ms** |
| `ed25519Verify` | 61ms | **2.55ms** |
| `packages/tor/test/wac/hsdescbuild_test.wac` | 8.4s | **0.96s** |
| `packages/crypto/test/wac/curve25519_test.wac` | 4.5s | **1.6s** |

So the ordering below is no longer inverted, and what remains of this issue is the two rows it does
not explain: **P-256 at 12ms and RSA at 117ms**. `packages/tor/test/wac/consensus_test.wac` did not
move at all, which fits — a consensus is signed with RSA.

## Answered for P-256 too, 2026-08-20 — and it is not the curve either

The row above says "P-256 at 12ms". It is `scMul`, the multiplication modulo the group *order*, which
is double-and-add over the **bytes** of its operand where the coordinates are 32-bit limbs. `scInvert`
is Fermat, so a signature runs it about 384 times, each 256 rounds of a 32-byte `scAdd` — roughly
three million byte operations per signature.

Measured on this machine, 40 operations each, after `issues/system/0210` and `issues/system/0223`:

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

**The scalar multiplication is 2.5ms of a 13.7ms signature**, so the curve is not where signing's time
goes and never was — eleven milliseconds are the order arithmetic. Those figures are from before the
fix below; they are what pointed at it.

`issues/system/0224` is that code, and it is a **leak** as well as slow: `scMul` adding only when the
bit is set is `0210`'s defect in a second field, over the private key and the nonce. One rewrite is
both fixes, which is why they should not be scheduled against each other.

`issues/system/0224` is that code, and it was a **leak** as well as slow: `scMul` adding only when the
bit was set is `0210`'s defect in a second field, over the private key and the nonce. It is fixed, and
the fix went the right way — Montgomery multiplication over 32-bit limbs is **5.5× faster than the
variable-time byte version**, so `p256Sign` is 2.4ms against `ed25519Sign`'s 2.3ms. The ordering this
issue is named after is no longer inverted in either direction; the two are the same speed.

So what remains of this issue is **RSA at 117ms**, and as of 2026-08-20 something has looked at it —
from the side-channel end rather than the performance end, but they turn out to name the same place.
`modPowSecret` with two 1024-bit exponents parts at `packages/bignum/src/big.wac:68`, which is
`trim`'s `while` over leading zero limbs, at event 25,728 of 17.4 million.

`trim` running a variable number of iterations is *why* it leaks and is also a hint about the cost:
every `mul` and `divmod` result is trimmed, and `modPowSecret` does four of those per exponent bit —
1024 bits, so about four thousand big-integer operations per signature, each with a normalisation pass
whose length depends on the operand. Nobody has profiled it, so that is a lead rather than an answer.
There is no CRT either, which `rsa.wac`'s header notes would be roughly four times faster.

The original measurement follows.

## Measured

Twenty operations each, inside wasm under the `wac` binary, on this machine:

| operation | per call |
| --- | ---: |
| `ed25519Sign` | **63ms** |
| `ed25519Verify` | **61ms** |
| `p256Sign` | 12ms |
| `p256Verify` | 13ms |
| `rsaSignPkcs1`, 2048-bit | 117ms |
| `rsaVerifyPkcs1`, 2048-bit, e=65537 | <1ms |

**Most of the ordering has an answer, and it is `issues/system/0210`.** P-256's `jacMul` adds only
when the scalar bit is set; ed25519's `ptMul` always adds and selects. So P-256 is doing about half
the point additions — and leaking the scalar through control flow, which is why 0210 is a bug rather
than a note. Fixing that will move P-256 toward ed25519's number rather than the other way round, and
what is left below is what remains after that is accounted for.

**The ordering is the finding.** Every other implementation has ed25519 several times *faster* than
P-256 — a prime-order twisted Edwards curve with complete addition formulas against a short Weierstrass
curve needing a modular inversion — and here it is five times slower. That is not a property of the
curves, so it is a property of this code.

The absolute numbers are the other half. `openssl speed` on this machine, measured rather than
remembered — OpenSSL 3.0.13, the same cores:

| | sign/s | verify/s | per call |
| --- | ---: | ---: | --- |
| ecdsa (nistp256) | 54 639 | 18 304 | 18µs / 55µs |
| EdDSA (Ed25519) | 33 227 | 12 222 | 30µs / 82µs |

So this is **~2100× OpenSSL on ed25519 signing and ~740× on verifying**, against ~660× and ~240× for
P-256. Some of that is wasm with no field-arithmetic intrinsics and no assembly, and it is the same
handicap for both curves — the gap *between* them is not explained by it. (Note that OpenSSL on this
machine also has P-256 signing faster than ed25519, which is its assembly rather than the curves; the
verify ordering is the usual one.)

## Where to look

`packages/crypto/src/ed25519.wac`. `ptAdd` is the general addition formula and `ptDouble` is written as
`ptAdd(p, p)` — a doubling done through the general formula costs the multiplications the doubling
formula does not need, and it is on the hot path of every scalar multiplication. A signature is one
fixed-base multiplication; a verification is a double-scalar one, and there is no sign of either being
specialised: no precomputed table for the base point, and no joint form for the two-scalar case.

`packages/crypto/src/p256.wac` reaches its 12ms through `curvePublicKey`/`fieldp.wac`, which suggests
the field layer there got attention this one did not.

## What it costs today

Everything that signs or verifies, which in this repository is most of `packages/tor`, `packages/ssh`
and the certificate half of `packages/tls`. It is visible in the test suite because that is where the
operations are counted:

- `packages/tor/test/wac/hsdescbuild_test.wac` — 8s, and a hidden-service descriptor build is ~700ms
  of it, which is about ten ed25519 operations: the identity certificate, one certificate pair per
  introduction point, and the outer signature.
- `packages/tls/test/wac/certtamper_test.wac` — 5.5s for 456 chain verifications, at P-256 speed. Had
  the fixtures been ed25519 it would have been 28s.
- `packages/crypto/test/wac/rsa_test.wac` — ~5s, of which the node oracle is a few hundred
  milliseconds: a 2048-bit private-key operation is 117ms here against about 0.6ms in OpenSSL, and
  the file signs six times. RSA is a different implementation from the two curves and lands in the
  same place, which is what makes this a package-wide property rather than one routine's problem.

A relay validating a consensus, or a client checking a descriptor it just fetched, pays this per
signature and not per test.

## Notes

Worth measuring before changing anything: how much of the 63ms is `ptAdd` being asked to double, and
how much is the field layer. `packages/crypto/test/wac/bench_probe.wac` benchmarks the hashes and
ChaCha20 and has nothing asymmetric in it, which is why nobody had a number for this.
