# webrtc

WebRTC in wac — the data channel half, following `design/system/0008`.

The design note is [0008 — WebRTC in wac](../../design/system/0008-webrtc-in-wac.md); the summary
line above carries no link because `MAP.md` quotes it verbatim from the repository root, where a
path relative to this directory points at nothing.

**A browser opens a data channel to this package and a message crosses both ways.** Chromium's
`RTCPeerConnection` completes SDP, ICE, DTLS, the SCTP association and DCEP against it, sends
`"hello from a browser"`, and receives our echo.

That is the aim of `design/system/0008` met — and it is a long way from a package you would deploy.

**Both layers resend what is lost.** A DTLS flight and an SCTP message are each thrown away in a
test and each recovers, the second against a real browser. Both keep a retransmission timer on a
clock the caller supplies — nothing here reads one — and SCTP measures the round trip it uses,
by RFC 6298 with Karn's rule.

**And SCTP paces what it sends.** A 40,000-byte message crosses to a browser and back, split across
chunks and reassembled, and it goes out over several round trips rather than in one burst: the
congestion window starts at 4,380 bytes, grows by what is acknowledged while it is below the
threshold and by one MTU per window above it, and collapses to one MTU on a timeout. The window
governs sending rather than merely being computed — chunks past it are built, numbered and queued,
and released as acknowledgements arrive. `test/timers.test.ts` drives those rules on a numeric
clock; the browser test asserts the window actually opened during the 40 KB transfer, which is what
distinguishes pacing from a counter nobody consults.

**And a single loss costs a single retransmission.** A SACK reports the runs that arrived above the
cumulative point as gap blocks, so a peer resends the hole rather than everything after it; and
three SACKs still reporting a TSN missing resend it at once instead of waiting out the timer. That
response is gentler than a timeout's — the window halves rather than collapsing — because a SACK
naming later TSNs is proof the path is still delivering.

Both state machines are structs in wac — `Peer` for the DTLS handshake and `Association` for SCTP —
so a program feeds datagrams in and sends what comes back.

**The certificate is checked**, in the two ways WebRTC needs and neither of which is optional. Its
SHA-256 fingerprint is what an SDP's `a=fingerprint` line names — there is no PKI here, the
certificate is self-signed per session, so the signalling channel *is* the identity. And the
ServerKeyExchange signature binds the ephemeral key to that certificate: without it the certificate
can be genuine while the point beside it is an attacker's, which is the subtler half and the same
shape as the hole `packages/quic` had until this week.

**Both DTLS roles work**: OpenSSL completes a handshake with us as the client and as the server. The
server half is where wac first produces an ECDSA signature something else verifies. What is still
missing is **retransmission** — a lost flight is not resent. SCTP has every message a data channel needs and **no state machine**: nothing tracks TSNs,
retransmits, or reassembles a fragmented message, so the pieces are all there and nothing yet drives
them. That is the next increment, and it is the one where the whole stack finally runs end to end
against `aiortc.RTCPeerConnection`.

    src/stun.wac      RFC 5389 messages: header, attributes, XOR-MAPPED-ADDRESS,
                      MESSAGE-INTEGRITY (HMAC-SHA1), FINGERPRINT (CRC-32)
    src/ice.wac       RFC 8445: candidate and pair priorities, the candidate line,
                      connectivity checks and their responses
    src/dtls.wac      RFC 6347 framing: records with epoch and sequence, handshake
                      headers with fragment offsets, ClientHello and the cookie,
                      ServerKeyExchange and ClientKeyExchange
    src/dtlskeys.wac  the TLS 1.2 key schedule — PRF, master secret, key block,
                      Finished — and AEAD records with the half-explicit nonce
    src/sctp.wac      RFC 4960: the common header, chunks, CRC-32c, INIT and
                      COOKIE-ECHO, DATA and SACK, and RFC 8832's DCEP messages
    src/sdp.wac       RFC 8866, the dozen lines a data channel needs: ICE
                      credentials, the DTLS fingerprint, and the m= line
    src/peer.wac      the DTLS server handshake as a struct: reassembly, the
                      transcript, the keys, and both sequence counters

## The oracle, which is the whole point

Neither Deno nor Node has any WebRTC — `RTCPeerConnection` is `undefined` in both — so this package
cannot be adjudicated by the runtime the way `packages/quic` is by Deno's quinn. Two foreign
implementations are installed instead, and every test in `test/` asks one of them rather than asking
us twice:

- **coturn 4.6.1** (`apt install coturn`) — a real STUN/TURN server. The tests start one on a
  loopback port and exchange datagrams with it.
- **aioice 0.10.2** (`pip install aiortc`) — the STUN implementation inside `aiortc`, driven through
  `python3 -c`. It signs messages we verify and verifies messages we sign.

If either is missing the tests fail rather than skip. A skip that prints nothing reads as coverage.

**Chromium**, through playwright at `~/pw`, is the one that matters: libwebrtc is what every other
WebRTC stack was written to talk to. **A browser opens a data channel to us**: it accepts our SDP answer, completes
ICE, retries its ClientHello with a cookie we issued, verifies our certificate and our ECDSA
signature, establishes an SCTP association through our INIT-ACK's state cookie, opens a channel by
name, and exchanges a message.

A browser needs one thing that is not obvious: **a page without media permission is shown no local
network interfaces at all**, so ICE gathers nothing and it looks exactly like a container with no
network. A successful `getUserMedia` — with a fake device — is what unlocks it. `test/browser.test.ts`
explains it at length because an afternoon went into finding it.

**RFC 5769's published vectors are better than either**, because two implementations can share a
mistake and a document cannot, so those go first: four messages byte for byte with the passwords they
were signed under, including an IPv6 XOR-MAPPED-ADDRESS and a non-ASCII padded username. They were
fetched and extracted by a script rather than transcribed, and each one's header length plus twenty
equals the bytes extracted — which is the check that the extraction was faithful.

The live implementations stay, because a vector says nothing about whether a running peer accepts
what we send.

## What is deliberately not here

**Media.** SRTP, codecs, jitter buffers and RTCP are the other half of WebRTC and none of it is
needed to move bytes between two peers. The data channel is the part a systems package wants.

**TURN relaying.** coturn can serve as a relay when ICE needs one; host candidates on loopback are
what the first pass proves.

## Running it

    deno test -A --unstable-net packages/webrtc/
