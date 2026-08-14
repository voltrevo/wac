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

### And then what the browser actually sends

Logging every plaintext handshake record Chromium sends, with the request added, settles it:

    kind=1  (ClientHello)       1200, 1200, 263, 271 bytes — fragmented, as before
    kind=11 (Certificate)        313 bytes  ×10
    kind=15 (CertificateVerify)  100 bytes  ×10
    kind=16 (ClientKeyExchange)   58 bytes  ×10

all three of the second flight arriving together in one 546-byte datagram, ten times over.

**So the CertificateRequest is accepted and answered.** Chromium reads it, picks a certificate,
signs the handshake and sends all three messages. The request body is not the problem, the flight
fits one datagram so there is no MTU problem, and the message sequence numbers are not the problem
either. Two of the three candidates listed above are eliminated and the third never applied.

The ten retransmissions are the tell: **we receive that flight and answer nothing.** Chromium then
waits, which is why it sits at `connecting` and raises no alert — there is nothing to complain
about, it simply never hears back.

### And it sends the rest of the flight too

The record kinds, rather than only the handshake ones, answer the remaining fork — did Chromium stop
before its Finished, or does it send one we fail to verify?

    type=20 (ChangeCipherSpec)          14 bytes  ×10
    type=22 (Finished, encrypted)       61 bytes  ×10
    type=22 (Certificate)              313 bytes  ×10
    type=22 (CertificateVerify)        100 bytes  ×10
    type=22 (ClientKeyExchange)         58 bytes  ×10
    type=22 (ClientHello)   1200, 1200, 263, 271  — fragmented, as before

**Chromium completes its whole flight**, ChangeCipherSpec and Finished included, and repeats all of
it ten times. We receive every record and answer none of it.

So `Peer` reaches the client's Finished and does not accept it. That is the only step left where
silence is the failure mode: an unverifiable Finished produces no reply and no alert, which is
precisely what both ends show.

### Step 0, as narrow as the evidence makes it

0. **Find out why the client's Finished does not verify once its Certificate and CertificateVerify
   are in the transcript.** Everything either side sends is accounted for; what is left is what we
   hash. `verifyData` runs over every handshake message in wire order, and the client's flight now
   contributes two more.

   **Two candidates can be ranked from the numbers already above, without another run.** The three
   client messages are 313 + 100 + 58 bytes of body, which with a 13-byte record header each is 510
   — and they arrived in a datagram of 546. ChangeCipherSpec (14) and the encrypted Finished (61)
   would have needed 585, so those came in a *separate* datagram. All three are therefore folded in
   before the Finished is ever checked, and the order they are folded in is arrival order, which is
   send order, which is what the peer hashed. Neither "a message missing when we verify" nor "folded
   in the wrong order" survives that arithmetic.

   **And the third candidate does not survive either**, which took no measuring at all — only
   noticing what the *working* handshake already does. `remember` rebuilds each message with
   `handshake(kind, seq, body)` rather than keeping the arrived bytes, and that path is already
   exercised today by two wire messages: the ClientHello, which Chromium fragments across four
   records (1200, 1200, 263, 271) and which is reassembled and re-headered before being folded in,
   and the ClientKeyExchange. Both go through `remember`, and the handshake verifies. So the
   reconstruction is correct for wire messages, fragmented and not.

   What that leaves is what actually changed, which is the **server's own half** of the transcript:
   a new message 13, and ServerHelloDone moving from message_seq 4 to 5. Those are the two entries
   no working handshake has ever exercised. Look there first — at the CertificateRequest body
   against RFC 5246 §7.4.4 byte for byte, and at whether anything else in `Peer` assumes the
   server's flight is four messages or that Done is seq 4.

   **Correction, and it restores the first candidate.** The datagram arithmetic above proves those
   three messages *arrived* before the Finished was checked. It does not prove `Peer` folded them
   into the transcript, and those are different claims — the logging that showed them was in the
   test, reading the socket, not inside `Peer`. So "a message missing at verification time" is back
   on the list, and reading the code gives it two concrete mechanisms that nothing measured
   excludes:

   - `handshakeRecord` drops a message silently when reassembly returns empty:
     `u8[] body = this.reassemble(...); if (body.len() == 0) { return out; }`. Every way
     `reassemble` can fail is a message that vanishes with no diagnostic, which is exactly the
     observed shape.
   - `reassemble` finds a slot **by `seq` alone**, ignoring `kind`, and `partialCount` only ever
     grows — nothing is freed when a message completes. `Partial[8]` is enough for the handshake as
     it stands, and the client's flight gains two more messages when a certificate is requested. It
     is worth checking what the client's message_seq numbering actually is before assuming eight is
     still enough, and worth noting that a table that never frees is a bound on the connection
     rather than on the flight.

   The way to settle it is the probe that was attempted and abandoned: expose what `Peer` folded in,
   in order, and read it after a failed handshake. That attempt failed on the binding rather than on
   the idea — an `i32[]` return that did not come back through `wacBind` — and is worth retrying.

   A note on how this list got here, because it is the useful part. Three candidates, ranked by
   plausibility, then by evidence, then re-ranked twice more — and one of the re-rankings, the one
   that struck out this candidate, was itself an over-reading of what the evidence covered. Every
   inversion came from concluding one step past what had actually been measured.

   None of these needs a browser to test. The transcript is a byte string, and a wrong one can be
   found by comparing ours against what OpenSSL hashes for the same exchange — which is a faster
   loop than either of the runs above.

Reverted rather than committed. A stack that a browser will not shake hands with is worse than one
that authenticates nobody and says so.

**A fingerprint comparison without step 2 is not authentication.** A certificate is public; an
attacker who has the offer also has the fingerprint and can present the very certificate it names.
What proves possession of the key is `CertificateVerify`. Implementing 1 and 3 alone would produce
something that looks authenticated and is not, which is the same shape as the hole `packages/quic`
had — see `design/system/0008` on the ServerKeyExchange signature.

The absence is asserted rather than described, so the browser test fails the moment a
CertificateRequest is added and this issue has to be revisited.
