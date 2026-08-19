# 0209 — ed25519 is five times slower than P-256, which is the wrong way round

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-19
- **Kind:** performance
- **Symptom:** no error

## Measured

Twenty operations each, inside wasm under the `wac` binary, on this machine:

| operation | per call |
| --- | ---: |
| `ed25519Sign` | **63ms** |
| `ed25519Verify` | **61ms** |
| `p256Sign` | 12ms |
| `p256Verify` | 13ms |

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

A relay validating a consensus, or a client checking a descriptor it just fetched, pays this per
signature and not per test.

## Notes

Worth measuring before changing anything: how much of the 63ms is `ptAdd` being asked to double, and
how much is the field layer. `packages/crypto/test/wac/bench_probe.wac` benchmarks the hashes and
ChaCha20 and has nothing asymmetric in it, which is why nobody had a number for this.
