# 0008 — WebRTC in wac

- **Status:** open — step 1 in progress
- **Opened:** 2026-08-14
- **Written by:** agent-b, from a request by the operator
- **Depends on:** [0007](0007-quic-and-the-datagram-capability.md) for the datagram capability, and
  `packages/crypto` and `packages/tls` for everything cryptographic.

## What we are aiming at

**A WebRTC data channel between a wac peer and a real one**, adjudicated by a foreign implementation
in both directions: our peer answering theirs, and theirs answering ours.

What that means concretely is five protocols stacked on one UDP socket, and the phrase "WebRTC" is
almost entirely those five rather than anything of its own:

    SDP            what the two ends tell each other out of band
    ICE + STUN     which address pair actually works, proved by sending on it
    DTLS 1.2       the key exchange, over a transport that loses and reorders
    SCTP           a reliable, message-oriented transport, inside DTLS
    DCEP           the two-message handshake that names a data channel

What it is **not**, and these are exclusions rather than omissions:

- **not media.** SRTP, codecs, jitter buffers and RTCP are the other half of WebRTC and none of it is
  needed to move bytes. A data channel is the part that makes this a *systems* package rather than a
  media one, and it is the part `packages/http` and `packages/tor` would actually use.
- **not TURN relaying in the first pass.** Host candidates on loopback prove the protocol; a relay
  proves a deployment. coturn is installed and can serve as one later, which is the argument for
  leaving the door open rather than for walking through it now.
- **not trickle ICE, not renegotiation, not simulcast.**

## The oracle question, answered by measurement before this was written

[0006](0006-candidates-for-what-to-build-next.md) sets the test: not "is it interesting" but *what
would say we got it wrong*, and *can that thing be run here, on demand, without a service we do not
control*. WebRTC has an unusually good answer and an unusually bad one, and it is worth being precise
about which is which.

**Neither runtime has any WebRTC at all.** `RTCPeerConnection` is `undefined` in Deno 2.9.1 and in
Node 22.23.1. So unlike QUIC — where Deno shipped quinn and the oracle was already installed — nothing
here can answer a WebRTC peer out of the box. That was the first thing checked, because a package with
no oracle is a package that measures itself.

**Two foreign implementations install and run, and both were driven before this sentence was
written.**

- **`aiortc` 1.15.0** (Python, `pip install aiortc`) — a complete WebRTC implementation: ICE, DTLS,
  SCTP, data channels, SDP. Its DTLS and SCTP modules import and its peer connection constructs. This
  is the analogue of quinn: an independent, mature implementation by people who have never seen ours,
  and it is what browsers are tested against.
- **`coturn` 4.6.1** (`apt install coturn`) — a real STUN and TURN server, and the thing an ICE agent
  meets in the wild.

The exchange that settles it, run on loopback in this container on 2026-08-14: coturn started on
`127.0.0.1:34780`, a Binding request sent from an ordinary UDP socket, and its answer parsed —

```
request  000100002112a44279b1289880f3f11a9f80d3bb
response 0101003c2112a44279b1289880f3f11a9f80d3bb
         0020000800 0198bd5e12a443    XOR-MAPPED-ADDRESS 127.0.0.1:47535
         0001000800 01b9af7f000001    MAPPED-ADDRESS     127.0.0.1:47535
         802b000800 0187dc7f000001    RESPONSE-ORIGIN    127.0.0.1:34780
         80220014 436f7475726e2d…     SOFTWARE           "Coturn-4.6.1 'Gorst'"
```

and the XOR-MAPPED-ADDRESS checks by hand: `0x98bd ^ 0x2112` is 47535, the port the socket was bound
to, and `0x5e12a443 ^ 0x2112a442` is `0x7f000001`.

**And the published vectors, which are better than either.** RFC 5769 prints four STUN messages byte
for byte with the passwords they were signed under, and a published constant beats a second
implementation's opinion because two implementations can share a mistake and a document cannot. The
domain was blocked when this note was first written; the operator opened it the same day, and all
four are now in `packages/webrtc/test/stun.test.ts` — extracted by a script rather than transcribed,
each verified self-consistent by its own header length before being trusted.

The running implementations stay, and the distinction is worth keeping: a vector says whether our
codec is right, and only a live peer says whether what we send is *accepted*. Step 1 passed all
three short-term-credential vectors on the first run after the domain opened, which is the sort of
thing worth recording precisely because it is not always how it goes.

## What already exists, and what is genuinely new

Most of the cryptography is done. `packages/crypto` has SHA-1 and HMAC (STUN's MESSAGE-INTEGRITY),
SHA-256, AES-GCM and AES-CTR, X25519, P-256, Ed25519 and RSA; `packages/tls` has X.509 parsing,
certificate verification and a TLS 1.3 handshake; `packages/quic` has the pattern for AEAD over a
datagram socket, and the `Datagram` capability landed with 0007.

The genuinely new work, in order of how much of it there is:

1. **SCTP.** A whole reliable transport — chunks, TSNs, cumulative and selective acknowledgement,
   fragmentation, the four-way INIT handshake with its cookie. It is a bigger protocol than QUIC's
   stream layer and it is the part with no prior art in this repository.
2. **DTLS 1.2.** Not TLS 1.3 with a different name: a different version, a record layer with explicit
   sequence numbers, a HelloVerifyRequest cookie round trip, and retransmission with backoff because
   the transport loses handshake flights. `packages/tls` supplies the primitives and almost none of
   the state machine.
3. **ICE.** Candidate gathering, the pairing and priority arithmetic, and connectivity checks that are
   STUN messages with `ICE-CONTROLLING`, `USE-CANDIDATE` and a short-term credential.
4. **STUN.** The smallest and the foundation of (3). Twenty-byte header, TLV attributes, XOR encoding,
   HMAC-SHA1 integrity and a CRC-32 fingerprint.
5. **SDP.** Text, and only the handful of lines a data channel needs: `ice-ufrag`, `ice-pwd`,
   `fingerprint`, `setup`, and the `m=application … webrtc-datachannel` line.

## The order it lands in

Each step is measured against a running peer before the next one starts, and each has a done-when
that is somebody else's implementation agreeing with ours.

1. **STUN messages.** Encode and parse; XOR-MAPPED-ADDRESS; MESSAGE-INTEGRITY over the length-adjusted
   header; FINGERPRINT. *Done when:* coturn answers our Binding request and we read its answer, and
   aioice parses a message we built and we parse one it built.
2. **ICE, host candidates only.** Pairing, priorities, connectivity checks with short-term
   credentials, the controlling role's nomination. *Done when:* aioice completes a connectivity check
   with us, in both roles.
3. **DTLS 1.2 handshake.** *Done when:* aiortc's DTLS transport completes with ours as the other end,
   both as client and as server, and the exported keying material matches.
4. **SCTP association.** INIT, cookie, DATA and SACK, one ordered reliable stream. *Done when:* an
   association is established with aiortc and a message crosses.
5. **DCEP and a data channel.** *Done when:* `RTCPeerConnection` in aiortc opens a channel to us and
   the string it sends comes back.
6. **SDP**, last, because it only describes what the first five already do.

## What would say we got it wrong

- **A step that passes against ourselves.** Every done-when above names a foreign peer for the reason
  `two implementations cannot see a shared mistake`: our encoder and our decoder agree perfectly when
  both are wrong.
- **Green on loopback and nothing else.** ICE exists because paths fail; if the connectivity checks
  are never *seen* to fail, the pairing logic is untested by construction. Step 2 needs a case where
  the first pair does not work.
- **A handshake that completes without authenticating.** The mistake `packages/quic` made and had
  fixed this same week: DTLS's whole job is to bind the certificate fingerprint in the SDP to the peer
  that answered, and a handshake that completes with anyone is worse than none, because it looks like
  it worked.
