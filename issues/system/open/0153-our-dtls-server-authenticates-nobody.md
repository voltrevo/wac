# 0153 — our DTLS server never asks for the peer's certificate, so it authenticates nobody

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-14
- **Kind:** missing feature
- **Symptom:** wrong answer

## Reproduction

`packages/webrtc/test/browser.test.ts` now asserts it directly. Over a complete session — ICE, DTLS,
SCTP, a data channel, 40,000 bytes both ways — the set of plaintext handshake messages Chromium
sends contains no `Certificate` (11) and no `CertificateVerify` (15).

Expected, for WebRTC: each end compares the certificate the other presented against the
`a=fingerprint` line the signalling channel carried. That comparison *is* the identity — there is no
PKI, the certificates are self-signed per session.

Actual: `Peer`'s server flight is ServerHello, Certificate, ServerKeyExchange, ServerHelloDone. A
DTLS server gets the peer's certificate only by asking for it with a `CertificateRequest`, and ours
does not ask. So the browser sends none, we hold none, and nothing anywhere in `packages/webrtc`
compares a peer certificate to a fingerprint.

## What this means

**A handshake with us completes with anybody who can reach the port and finish an anonymous ECDHE.**
Whoever answers our ServerHelloDone gets an established connection and a data channel. There is no
point at which the peer named in the SDP is distinguished from any other peer.

Worth being exact about the residual risk, because it is smaller than "no authentication at all"
sounds and still real:

- The ICE credentials are a shared secret from the offer, and connectivity checks are
  MESSAGE-INTEGRITY'd under them, so an off-path attacker who never saw the signalling cannot get as
  far as the DTLS handshake.
- So the exposure is an attacker who *has* the offer — a compromised or observed signalling channel
  — or one on the path. Against those, the fingerprint is precisely the defence that is missing, and
  it is the one WebRTC relies on.

The design note names this as a criterion for having got it wrong: *"a handshake that completes
without authenticating … a handshake that completes with anyone is worse than none, because it looks
like it worked."*

## Notes

**The README overclaimed and has been corrected in the same commit.** "The certificate is checked, in
the two ways WebRTC needs and neither of which is optional" was true of the *client* direction —
`handshake.test.ts` verifies a server's certificate fingerprint against OpenSSL's and checks the
ServerKeyExchange signature that binds the ephemeral key to it. But `Peer` is a DTLS *server*, and
the server role is what `Session`, the browser test and `example/answer.wac` all use. A reader took
a property of one direction for a property of the package. That is the part worth fixing first.

What the fix needs, and why it is more than one line:

1. `CertificateRequest` in the server's first flight, which changes the transcript every side hashes.
2. Parsing the client's `Certificate`, and its `CertificateVerify` — with the client's own signature
   over the handshake so far.
3. Comparing the leaf's SHA-256 against the fingerprint from the SDP. `fingerprintOf` already exists
   and is checked against OpenSSL, so this part is small.
4. Refusing the handshake when it does not match, which is a new failure path through `Peer` and
   `Session`.

### What an attempt at step 1 found

Adding `CertificateRequest` alone — the message, its place between ServerKeyExchange and
ServerHelloDone, and the transcript entry — works, and both `dtlsserver.test.ts` cases still pass.
But the second one goes from **26 seconds to 8 minutes 17**, which is not a slow test; it is the
handshake taking that long. The flight grows from four messages to five and something about the
larger flight provokes retransmission cycles with DTLS's exponential backoff.

So step 1 is not free, and the fix needs a fifth piece before the other four are worth writing:

0. **Work out why a five-message flight retransmits**, and fragment it across datagrams if that is
   what it needs. `Peer` currently emits one record per message and lets the caller send them; a
   flight that no longer fits a path MTU is the obvious suspect, and `dtls.wac` already has the
   fragment-offset machinery for handshake messages, so the pieces exist.

That was measured and then reverted rather than committed, because a working stack that takes eight
minutes to shake hands is worse than one that authenticates nobody and says so.

**A fingerprint comparison without step 2 is not authentication.** A certificate is public; an
attacker who has the offer also has the fingerprint and can present the very certificate it names.
What proves possession of the key is `CertificateVerify`. Implementing 1 and 3 alone would produce
something that looks authenticated and is not, which is the same shape as the hole `packages/quic`
had — see `design/system/0008` on the ServerKeyExchange signature.

The absence is asserted rather than described, so the browser test fails the moment a
CertificateRequest is added and this issue has to be revisited.
