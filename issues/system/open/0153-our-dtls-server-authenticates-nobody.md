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
ServerHelloDone, and the transcript entry — **breaks the handshake with Chromium**. The peer
connection reaches `connecting` and stays there until the test gives up, with no DTLS alert and
nothing in the state log: it simply stops. Everything before DTLS is unaffected; ICE still completes.

Measured with OpenSSL first, which was misleading and is recorded here so nobody repeats the
inference. `openssl s_client` still completes, so both `dtlsserver.test.ts` cases still *pass* — but
the resend case goes from 26 seconds to 8 minutes 17, which is the handshake taking that long rather
than a slow test. Read alone that suggests a retransmission or MTU problem. Read next to the browser
result it looks more like both peers disliking the flight, one by stalling and one by grinding
through retransmissions until it got there anyway.

So there is a step 0, and it is diagnosis rather than construction:

0. **Find out what is wrong with the flight**, with *Chromium* as the oracle rather than OpenSSL —
   the browser is the implementation that refuses outright, and an implementation that refuses is a
   better oracle than one that struggles on. Candidates, none checked: the CertificateRequest body
   itself (`01 40 00 02 04 03 00 00` — one certificate type `ecdsa_sign`, one signature algorithm
   `sha256/ecdsa`, no authorities, which is what RFC 5246 §7.4.4 asks for and may still not be what
   libwebrtc accepts); the flight no longer fitting a path MTU, `dtls.wac` having fragment-offset
   machinery that nothing here drives; or the message sequence numbers, since ServerHelloDone moves
   from 4 to 5 and every later number with it.

Reverted rather than committed. A stack that a browser will not shake hands with is worse than one
that authenticates nobody and says so.

**A fingerprint comparison without step 2 is not authentication.** A certificate is public; an
attacker who has the offer also has the fingerprint and can present the very certificate it names.
What proves possession of the key is `CertificateVerify`. Implementing 1 and 3 alone would produce
something that looks authenticated and is not, which is the same shape as the hole `packages/quic`
had — see `design/system/0008` on the ServerKeyExchange signature.

The absence is asserted rather than described, so the browser test fails the moment a
CertificateRequest is added and this issue has to be revisited.
