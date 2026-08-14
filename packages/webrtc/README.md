# webrtc

WebRTC in wac — the data channel half, following `design/system/0008`.

The design note is [0008 — WebRTC in wac](../../design/system/0008-webrtc-in-wac.md); the summary
line above carries no link because `MAP.md` quotes it verbatim from the repository root, where a
path relative to this directory points at nothing.

**Status: step 1 of six.** STUN messages are done and measured against two foreign implementations.
Everything above them — ICE, DTLS, SCTP, data channels, SDP — is not written yet.

    src/stun.wac      RFC 5389 messages: header, attributes, XOR-MAPPED-ADDRESS,
                      MESSAGE-INTEGRITY (HMAC-SHA1), FINGERPRINT (CRC-32)

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
