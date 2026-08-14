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

## What to try next

1. **Verify our signature with a third implementation** — extract the exact signed bytes and the DER
   signature from a failing run and check them with `openssl dgst -verify` against the certificate's
   public key. That separates "the signature is invalid and OpenSSL is lenient" from "the signature
   is valid and BoringSSL wants something else".
2. **A non-DER difference**: BoringSSL is stricter than OpenSSL about DER — a needless leading zero,
   or a missing one — and `derInteger` is the place to look. A signature whose `r` or `s` has its top
   bit set is the case where the two disagree, so try many `k` values and see whether *some* are
   accepted.
3. **`extended_master_secret`.** libwebrtc has required it for some years; a peer that does not
   negotiate it may be refused. The alert would be an odd way to say so, but the ServerHello we send
   carries only `renegotiation_info`.
4. **The fixed ECDSA nonce.** `SIG_K` is a constant in the test. It is a valid nonce — OpenSSL
   verifies the result — but varying it is a one-line experiment and would settle (2).

## Why it is filed rather than fixed

Because the next step is measurement rather than a patch, and the evidence is worth writing down
before it is lost: the same signature satisfies one verifier and not the other, and that is a
sharper starting point than "the browser does not connect".
