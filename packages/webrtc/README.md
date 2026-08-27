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

**SCTP paces what it sends.** A 40,000-byte message crosses to a browser and back, split across
chunks and reassembled, and it goes out over several round trips rather than in one burst: the
congestion window starts at 4,380 bytes, grows by what is acknowledged while it is below the
threshold and by one MTU per window above it, and collapses to one MTU on a timeout. The window
governs sending rather than merely being computed — chunks past it are built, numbered and queued,
and released as acknowledgements arrive. `test/wac/timers_test.wac` drives those rules on a numeric
clock; the browser test asserts the window actually opened during the 40 KB transfer, which is what
distinguishes pacing from a counter nobody consults.

**A single loss costs a single retransmission.** A SACK reports the runs that arrived above the
cumulative point as gap blocks, so a peer resends the hole rather than everything after it; and
three SACKs still reporting a TSN missing resend it at once instead of waiting out the timer. That
response is gentler than a timeout's — the window halves rather than collapsing — because a SACK
naming later TSNs is proof the path is still delivering.

**It closes, in both of the ways that happen.** SCTP's three-chunk shutdown is implemented in
both directions, checked against aiortc's parser, and an association that has agreed one refuses to
send anything further — saying you are finished and then sending is what makes a peer abort. But a
browser does not use it: Chromium closes with an **ABORT**, which the browser test now measures
rather than assumes. So that is handled too — it closes the association and drops what was in
flight, instead of retransmitting at a peer that has gone.

**A candidate pair is seen to fail.** The answer advertises two candidates with the better one
dead, so Chromium tries it, fails, and falls back — with the dead port bound and silent so the test
can count the checks that arrive there. Without that count a browser which ignored the bad candidate
would pass identically.

**Permission to send is renewed, not assumed.** RFC 7675 consent freshness: a check every five
seconds, consent gone after thirty without a valid response, and a single lost check deliberately
harmless. This is the one rule here that protects somebody else — an address that was a peer's can
be reassigned, and a sender that never rechecks keeps delivering to whoever holds it now. The
browser answers every check, which the test takes from Chromium's own `getStats()` rather than by
counting what our socket happened to read — the two are not the same number, and mistaking one for
the other cost `issues/system/0152` a while.

**The layers are joined.** `Session` in `src/session.wac` owns the DTLS peer, the SCTP
association and the consent timer together: `receive` takes a datagram and answers with the
datagrams to send, `send` takes a message, `tick` releases whatever the congestion window now
allows. A caller supplies a socket and a clock and nothing else — which datagram is a check and
which is DTLS, where an application record sits inside one, that a packet holds several chunks, that
DCEP's open must be answered before anything flows, and that a large message is a run of DATA
chunks are all decisions this package should be making, and every one of them has been got wrong
here at least once.

**Chromium's whole exchange now goes through it** — SDP, ICE, DTLS, the association, DCEP, 40,000
bytes both ways, a dropped message recovered, the window opening and the abort at the end — so the
composition is measured by the same oracle as the protocol. The browser test keeps decrypting the
records a second time, purely to observe, because a test that only asked "did a channel open" would
stop being able to say that a browser really sent an INIT and echoed a cookie.

**There is a program.** `example/answer.wac` reads a peer's SDP offer on standard input, makes
its own P-256 identity, prints the answer, and runs the data channel — every message echoed back:

    wac task app:build packages/webrtc/example/answer.wac --allow-net -o answer.js
    deno run -A --unstable-net answer.js 127.0.0.1 45678 < offer.sdp

`test/wac/example_test.wac` runs it: aiortc parses what it prints as an `application` section over
`UDP/DTLS/SCTP`, DTLS role `server`, with a 95-character sha-256 fingerprint and one host candidate
— and then a connectivity check sent to the port it bound comes back answered under the password it
advertised, which is what says the description and the socket agree rather than only that it
started. Writing it is what found that a
program could not have an identity at all — WebRTC certificates are self-signed per session and a
data channel negotiates ECDHE_ECDSA, so `packages/tls` grew `selfSignedP256` — and it found
`issues/lang/0123` — wacc checked the arity of a call through a funcref field but not the argument
types, so a swapped argument to a host capability reached nobody until the module refused to
instantiate. Since every platform capability is a funcref field, that was the call shape a program
uses most and the checker looked at least. Fixed and closed.

Both state machines are structs in wac — `Peer` for the DTLS handshake and `Association` for SCTP —
so a program feeds datagrams in and sends what comes back.

**Both ends of the handshake are authenticated**, which is four separate checks and none of them is
optional. There is no PKI here: certificates are self-signed per session, so the `a=fingerprint`
line in the SDP is the entire statement of who the peer is, and the signalling channel *is* the
identity.

Answering a peer, which is what `Session` and the example program do:

- `Peer` sends a **CertificateRequest**, without which the peer sends no certificate and there is
  nothing to check. It answers with its Certificate and CertificateVerify.
- The **CertificateVerify signature** is verified against the certificate it presented, over the
  handshake up to that point. This is what makes the fingerprint worth comparing: a certificate is
  public, so anyone holding the offer holds the one it names and could present it — what cannot be
  replayed is a signature over *this* handshake with the key inside it. A peer that produces none is
  refused, and `openssl s_client` run without `-cert` fails to connect, which is how that refusal is
  measured rather than described.
- `Session` then **enforces the fingerprint**: it carries nothing until the certificate the peer
  presented is the one the SDP promised. An empty expected fingerprint means refuse, because a
  session with nothing to compare against cannot tell the peer it was told about from anyone else.
  Changing one byte of it stops the SCTP association establishing at all, which is how that is known
  to be a gate and not a getter.

Calling a peer, which `handshake.test.ts` covers: the server's fingerprint against the SDP's, and
the **ServerKeyExchange signature**, which binds the ephemeral key to that certificate — without it
the certificate can be genuine while the point beside it is an attacker's.

**Both DTLS roles work**: OpenSSL completes a handshake with us as the client and as the server. The
server half is where wac first produces an ECDSA signature something else verifies.

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
