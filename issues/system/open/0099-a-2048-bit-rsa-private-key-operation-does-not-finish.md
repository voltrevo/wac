# 0099 — a 2048-bit RSA private-key operation does not finish in any time a test will wait

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-07
- **Kind:** performance
- **Symptom:** hangs

## Reproduction

`packages/tls/test/rsa_server_interop.test.ts` originally generated its fixture with
`openssl req -x509 -newkey rsa:2048`. Our TLS server has to sign one CertificateVerify with
that key, which is one `modPowSecret` over a 2048-bit modulus.

    tls: OpenSSL completes a handshake with our server's RSA certificate ...
      has been running for over (1m0s)
      has been running for over (2m0s)
      has been running for over (4m0s)

Killed at that point, so **four minutes is a lower bound rather than a measurement** — it may
be far worse and nobody has let it finish.

The same test with `rsa:1024`, which is what the file now uses:

    ok (69ms)

Expected: a 2048-bit private-key operation costs roughly eight times a 1024-bit one — the
modulus is twice as wide, so each multiplication is about 4x and there are 2x as many of
them. On 69ms that predicts well under a second.

Actual: more than 240s, which is over 3500x rather than 8x.

## Notes

The gap is much larger than the arithmetic accounts for, so the suspicion is not "big numbers
are slow" but something with a worse exponent or an allocation per limb somewhere in
`modPowSecret` — the constant-time path in `packages/crypto/src/rsa.wac`. `modPow`, the public
path, is not implicated by this measurement; only the secret-exponent one was exercised.

**Why it matters beyond a test fixture.** 1024-bit is what tor uses for link and identity keys,
so nothing in `packages/tor` is blocked. But 2048 is the minimum anyone else would pick, and a
TLS server here cannot use a 2048-bit certificate at all — not slowly, but not at all, because
no client waits that long. That is a real limit on `packages/tls` outside Tor, and it is
invisible from every test in the tree because they all use 1024.

Not filed against `packages/tor`: nothing there wants a 2048-bit key. Filed here rather than
fixed where I stood because it is a `packages/crypto` performance question with its own shape,
and issue 0095 (`sha256` is 13x off OpenSSL) suggests the bignum layer deserves looking at as
one piece rather than one call site at a time.
