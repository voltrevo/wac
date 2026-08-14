# 0151 — a ServerKeyExchange signature OpenSSL accepts and a browser refuses

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-14
- **Kind:** bug
- **Symptom:** wrong answer (a signature one verifier takes and another does not)

## What

`packages/webrtc`'s DTLS **server** role completes a handshake with `openssl s_client -dtls1_2`:
`packages/webrtc/test/dtlsserver.test.ts` runs the cookie exchange, sends ServerHello, Certificate,
a signed ServerKeyExchange and ServerHelloDone, verifies the client's Finished against its own
transcript and sends one back. That test passes.

The same code, the same certificate and the same signing construction, against Chromium 151:

- the browser sends a ClientHello and we answer with a HelloVerifyRequest;
- it **retries with our cookie**, so the cookie exchange works against libwebrtc;
- we send the same four messages;
- it answers with alert **`2/51`, `decrypt_error`**, which at that point in a TLS 1.2 handshake means
  the ServerKeyExchange signature did not verify, and sends no ClientKeyExchange.

`packages/webrtc/test/browser.test.ts` asserts all of the above, the alert included, so the day it
changes the test fails and points here.

## What has been ruled out

- **The certificate.** `packages/tls/test/data/ec_leaf.pem` is P-256 (`prime256v1`), its signature
  algorithm is `ecdsa-with-SHA256`, and the scheme we announce is `0x0403`
  (`ecdsa_secp256r1_sha256`), which matches.
- **The signature being simply wrong.** OpenSSL verifies it, and OpenSSL's client always checks the
  ServerKeyExchange signature.
- **The DER encoding, superficially.** It is a `SEQUENCE` of two `INTEGER`s, 71 bytes,
  `derwrite.wac`'s `derInteger` strips leading zeros and pads when the high bit is set.
- **The earlier failures**, which were ours and are fixed: a restarted `message_seq`, a restarted
  record sequence, and a missing `renegotiation_info`.

## Measured, 2026-08-14: the signature is valid, so it is not the signature

The first two candidates are gone. Our signature was verified by a **third path** — not
`s_client`'s handshake but `openssl dgst -sha256 -verify` against the certificate's public key,
directly on the bytes:

```
k#0: Verified OK | len 72 | r 33 (padded) s 33 (padded)
k#2: Verified OK | len 70 | r 32          s 32
k#4: Verified OK | len 71 | r 33 (padded) s 32
k#5: Verified OK | len 71 | r 32          s 33 (padded)
--- verified 8, failed 0; r padded 4/8, s padded 5/8 ---
```

Eight nonces, all four combinations of a padded and unpadded `r` and `s`, and every one verifies. So
`derwrite.wac`'s `derInteger` is right in both branches, the ECDSA arithmetic is right, and
**BoringSSL is refusing a valid signature.**

That moves the question from *how it is encoded* to **what is signed**, or to something else in the
flight that makes the browser compute a different input:

1. **The client random.** We take it from the *cookied* ClientHello, which is what the transcript
   uses. Chromium retransmits its **first** hello while waiting, so a version of this that recorded
   the random from whichever hello arrived last could be signing over the wrong 32 bytes — worth
   asserting the two are equal rather than assuming.
2. **`extended_master_secret`.** libwebrtc has required it for years and our ServerHello carries only
   `renegotiation_info`. It would be an odd way to report a missing extension, but BoringSSL's
   `decrypt_error` covers more ground than the name suggests.
3. **Chromium's own logs.** `--vmodule=*ssl*=3` under `DEBUG=pw:browser` prints BoringSSL's reason,
   and that is what settled `0150` in a minute after an afternoon of guessing. It is the cheapest
   remaining step and should be the next one.

## Why it is filed rather than fixed

Because the next step is measurement rather than a patch, and the evidence is worth writing down
before it is lost: the same signature satisfies one verifier and not the other, and that is a
sharper starting point than "the browser does not connect".
