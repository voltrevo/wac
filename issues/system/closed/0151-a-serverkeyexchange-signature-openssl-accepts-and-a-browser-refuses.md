# 0151 — a ServerKeyExchange signature OpenSSL accepts and a browser refuses

- **Status:** closed — we never reassembled the browser's ClientHello. 2026-08-14
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
3. **The curve we chose.** We answer with **x25519** because it is what our ClientHello offers as a
   client — but a *server* must choose from what the **peer** offered, and nothing here reads
   Chromium's `supported_groups` before deciding. If it does not offer x25519 for DTLS, the
   ServerKeyExchange is unparseable to it and `decrypt_error` is a plausible way to say so. This is
   the most likely remaining cause and the cheapest to check: read the extension and assert, rather
   than assume. `serverHello` picks a suite the same way and has the same gap.
4. **Chromium's own logs**, which settled `0150` in a minute. Harder to get at here than it was
   there: `DEBUG=pw:browser` truncates each line — the reason arrives as `TLS client read_se…`,
   enough to know it fails *at* the ServerKeyExchange and not why — and `--log-file` produced
   nothing, so the sandbox is refusing the write. Launching Chromium outside playwright, or giving
   it a writable directory, would fix that.

**A caution for whoever picks this up.** A scratch attempt to dump Chromium's ClientHello and read
its extensions mis-parsed — the version came out `6930` rather than `fefd`, so the offsets were
wrong, most likely because the hello is **fragmented** and the second fragment's payload is not a
message start. The extension list has therefore *not* been read yet. Do not take (3) as checked.

## The cause: a fragmented ClientHello, read as though it were whole

**Chromium's ClientHello is 1,413 bytes and does not fit in a datagram.** It arrives in fragments,
and the one this code parsed was at offset 1,175:

```
kind 1, message_seq 0, fragment_offset 1175, fragment_length 238, total_length 1413
```

So the "client random" we read was thirty-two bytes from the middle of the message, and the
ServerKeyExchange signature covered them. `decrypt_error` was exactly right: the signature was over
the wrong bytes. Nothing was wrong with the signing, the DER, the certificate or the curve.

**OpenSSL's `s_client` sends a hello small enough for one datagram**, which is why the server role
passed against it and failed against a browser — a difference in the *peer's* message size, not in
anything either implementation does with it.

The fix is the reassembly this package already had, applied where it was missing. The client half
learned the same lesson from the other side a few hours earlier — OpenSSL fragments its
ServerKeyExchange and the first version of the client test walked straight past the `whole` flag —
and the server half was written without carrying it over. The lesson is not "reassemble handshake
messages"; it is that **a fix belongs everywhere the shape occurs**, and one direction of a protocol
is not evidence about the other.

## What it unblocked

With the hello reassembled, Chromium accepts our flight, sends a ClientKeyExchange, and its Finished
verifies against our transcript. `RTCPeerConnection.connectionState` reaches **`connected`** — ICE
and DTLS both up. **A browser now completes a DTLS 1.2 handshake with a wac peer**, with our
certificate and our ECDSA signature.

The boundary is now SCTP, which has every message and no state machine, so no data channel opens on
the secure transport. `packages/webrtc/test/browser.test.ts` asserts that boundary too.
