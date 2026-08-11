# 0099 — a 2048-bit RSA private-key operation does not finish in any time a test will wait

- **Status:** closed — fixed 2026-08-11 by agent-a
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

## It was not the arithmetic. `encodeConn` trapped on a 256-byte modulus.

Measured first, because the report's own numbers said the arithmetic could not account for it — 3500x
where 8x was predicted. `packages/crypto/test/wac/rsa_probe.wac` gained `modExpSecret`, the secret
path at the host boundary, and the curve is exactly what the arithmetic predicts:

| modulus | `modPowSecret` | `modPow` |
|---:|---:|---:|
| 256 | 1 ms | 1 ms |
| 512 | 2 ms | 2 ms |
| 1024 | 7 ms | 7 ms |
| 1536 | 21 ms | 21 ms |
| **2048** | **47 ms** | 47 ms |

47 ms, against a "lower bound" of four minutes. So the hang was never the signature — and the second
measurement said what it was instead: the ten-minute run burned **3 seconds of CPU**. Nothing was
computing.

`tlsServerInitRsa` never returned, and it does nothing but pack the connection state:

    Uncaught RuntimeError: unreachable
      at wire$Writer$vec8
      at server$encodeConn
      at server$tlsServerInitRsa

`encodeConn` wrote `rsaN`, `rsaE` and `rsaD` behind a **one-byte length prefix**. A 2048-bit modulus
is 256 bytes, and `vec8` traps above 255 — as it should; the field was the wrong width. Every RSA key
at or above the size anyone outside Tor would choose failed before the handshake had read a byte, and
the three fields are the only ones in that state whose length is a *key's* rather than a hash's. They
are `vec16` now.

**Why it looked like a hang.** The test's driver loop ended in `catch { /* the client hung up */ }`,
which caught our own trap. The server stopped reading; OpenSSL waited for a ServerHello that would
never come; both ends sat there until something killed them. A trap that arrives as silence is worse
than a crash, and it cost this issue its diagnosis. Both TLS interop drivers now rethrow
`WebAssembly.RuntimeError` — Deno's report of a wac `trap`, which nothing a socket does produces.

## Now

`packages/tls/test/rsa_server_interop.test.ts` runs **both** sizes against OpenSSL, since 1024 alone
is what hid this:

    tls: OpenSSL completes a handshake with our server's 1024-bit RSA certificate ... ok (344ms)
    tls: OpenSSL completes a handshake with our server's 2048-bit RSA certificate ... ok (218ms)

Canaried by putting `vec8` back: **135 ms, `RuntimeError: unreachable`** — the fix demonstrated, and
the swallowing fix demonstrated with it, because that is what turns four minutes of nothing into a
failure that names its own line.

## What this leaves standing

The performance question the issue also raised is untouched and still true: there is no CRT, so a
private-key operation is a full-width exponentiation, and 0095's suspicion that the bignum layer
deserves looking at as one piece is not answered by this. What is no longer true is that
`packages/tls` cannot serve a 2048-bit certificate. It can, in 218 ms end to end.
