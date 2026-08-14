# 0008 — WebRTC in wac

- **Status:** **the aim is met** — a browser opens a data channel to a wac peer and a message crosses
  both ways, 2026-08-14. All six steps have what that needed; what each still lacks is below.
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

### The oracle a browser would be, and why it is not one here

Chromium 151 is installed and its WebRTC works: it builds a data channel and produces an offer, and
`packages/webrtc/test/browser.test.ts` reads that offer with `src/sdp.wac`. libwebrtc is the
implementation that matters most — every other stack was written to talk to it — and its description
differs from aiortc's in ways worth reading off rather than assuming: `a=ice-options:trickle`, and a
`max-message-size` of 262144 where aiortc offers 65536.

**And it connects.** Chromium accepts our SDP answer, sends connectivity checks that `ice.wac`
validates and answers, and its ICE reaches `connected`. It then starts DTLS: we answer its
ClientHello with a HelloVerifyRequest and **it retries with our cookie**, so the cookie exchange
works against libwebrtc too. It verifies our certificate and our ECDSA signature, sends a
ClientKeyExchange, and its Finished checks against our transcript: **`connectionState` reaches
`connected`, so a browser has completed a DTLS 1.2 handshake with a wac peer.**

That took one bug worth remembering. Chromium's ClientHello is 1,413 bytes and arrives **fragmented**;
we parsed the fragment at offset 1,175 and signed over thirty-two bytes from the middle of it, which
is what `decrypt_error` was telling us. OpenSSL's `s_client` sends a hello small enough for one
datagram, so the server role passed against it and failed against a browser — a difference in the
peer's message size, not in anything either does. `issues/system/0151`, closed. The client half had
learned the same lesson from the other side hours earlier; **a fix belongs everywhere its shape
occurs**, and one direction of a protocol is not evidence about the other.

Getting there needed one thing that is worth writing down, because for an afternoon it looked like a
container without a network: **Chromium shows a page no local network interfaces at all unless it has
media permission.** `FilteringNetworkManager received permission status: denied`, gathering completes
with zero candidates, and none of `--allow-loopback-in-peer-connection`,
`--force-webrtc-ip-handling-policy=default` or disabling mDNS masking is relevant. A successful
`getUserMedia`, with a fake device, is the whole fix. `issues/system/0150` records it, closed.

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
2. **ICE, host candidates only.** ✅ **Done, 2026-08-14 — including against a browser.** `src/ice.wac` has the priority and
   pair-priority arithmetic, the candidate line, the check and the response, and the rule about which
   password signs which direction. `aioice.Connection(ice_controlling=True)` completes against us:
   it sends checks, we validate and answer them, and its `connect()` returns having nominated a pair
   with USE-CANDIDATE. The test counts the checks it accepted, because a `connect()` that returned
   without sending us one would have found some other path.

   *Not yet:* the controlled role in the other direction — we never *send* checks in anger — and no
   agent, so no timers, no retransmission and no check list that walks itself. `checkFor` builds a
   check and aioice validates it, which is the codec half; driving one is step 2b if the loop turns
   out to want it before DTLS.
3. **DTLS 1.2 handshake.** *Done when:* aiortc's DTLS transport completes with ours as the other end,
   both as client and as server, and the exported keying material matches.

   **The framing is in, 2026-08-14** — `src/dtls.wac`: records, handshake headers with their
   fragment offsets, the ClientHello and the cookie exchange. `openssl s_server -dtls1_2` answers our
   first ClientHello with a HelloVerifyRequest, accepts the cookie echoed in the second, and returns
   a ServerHello choosing the first suite we offered, followed by Certificate, ServerKeyExchange and
   ServerHelloDone. A cookie with one byte changed does not take the handshake forward, which is what
   says the server is checking them.

   **And the handshake completes, 2026-08-14.** `openssl s_server -dtls1_2` accepts our Finished and
   sends one we verify: ECDHE over x25519, the TLS 1.2 PRF (byte-identical to `openssl kdf
   TLS1-PRF`), AES-128-GCM records with the half-explicit nonce, and the transcript RFC 6347 §4.2.6
   defines — the cookied ClientHello onward, with the first hello and the HelloVerifyRequest left
   out. Acceptance is the only oracle for a transcript: no other tool will tell you what it should
   hash, and a wrong one shows up as `decrypt_error` and nothing else.

   Two things the flight taught, both now in the test: a handshake message is **fragmented** whenever
   it does not fit — OpenSSL splits the ServerKeyExchange as a matter of course, seventeen bytes then
   ninety-four — and the transcript hashes it **as if it never was**, one header with offset zero. A
   reader that took each fragment for a message saw a ServerKeyExchange whose curve parsed and whose
   public key was empty.

   **And the certificate is checked**, both ways: its SHA-256 fingerprint against what the signalling
   channel named — WebRTC has no PKI, so that comparison *is* the identity — and the
   ServerKeyExchange signature, which binds the ephemeral key to it. The second is the subtler one
   and the canary is what proves it fires: one bit of the server's point changed, and the signature
   must fail. Without it a genuine certificate sits beside an attacker's key and the handshake
   completes for them.

   **And the server role, 2026-08-14.** `openssl s_client -dtls1_2` completes a handshake with us:
   we issue the cookie, answer with ServerHello, Certificate, a signed ServerKeyExchange and
   ServerHelloDone, verify its Finished against our transcript and send ours. So both directions of
   the same handshake are adjudicated by the same foreign implementation.

   It is also the first place in this repository where wac **produces** an ECDSA signature that
   something else verifies — `x509.wac` has had the DER decoder for a long time and nothing had ever
   needed the encoder, because nothing had signed for TLS.

   Three mistakes on the way, each of which cost a cycle and each of which reported something other
   than itself:

   - **`message_seq` is one counter across the handshake**, and the HelloVerifyRequest spends 0. A
     ServerHello numbered 0 is a retransmission of a message already had, and OpenSSL says
     `unexpected message`.
   - **The record sequence is a second such counter.** Restarting it makes the ServerHello a replay,
     DTLS's window drops it silently, and the client reports `read timeout expired` — which points
     at the network.
   - **A ServerHello must carry `renegotiation_info`.** Every description of a minimal one says the
     extension block may be empty; OpenSSL refuses that with `unsafe legacy renegotiation disabled`,
     and so does a browser.

   *Still missing:* **retransmission** — a lost flight is not resent and the timer model is unwritten.

   **The oracle is checked and there are two.** OpenSSL 3.0.13 is installed and speaks DTLS on both
   sides; a handshake was completed on loopback on 2026-08-14 —
   `ECDHE-ECDSA-AES256-GCM-SHA384`, which is the suite WebRTC uses — with

       sleep 40 | openssl s_server -dtls1_2 -accept 127.0.0.1:PORT \
           -cert packages/tls/test/data/ec_leaf.pem -key packages/tls/test/data/ec_leaf.key

   The pipe is not decoration: **`s_server` reads stdin and exits on EOF**, so backgrounded without
   one it prints `ACCEPT` and `DONE` and is gone before a client arrives — which looks exactly like a
   server refusing the connection. That cost a cycle and a wrong hypothesis about the certificate
   type, so it is written down here rather than rediscovered.

   OpenSSL is the better oracle for the record layer and the handshake, being the implementation
   everything else is measured against; aiortc's `RTCDtlsTransport` is the one that also binds the
   certificate fingerprint the SDP carries, which is the WebRTC-specific half.
4. **SCTP association.** INIT, cookie, DATA and SACK, one ordered reliable stream. *Done when:* an
   association is established with aiortc and a message crosses.

   **The framing is in, 2026-08-14** — `src/sctp.wac`: the common header, chunks with their padding,
   CRC-32c, and the INIT and COOKIE-ECHO shapes. `aiortc.rtcsctptransport.parse_packet` reads our
   INIT and agrees about every field, and refuses one whose checksum we corrupt — including the
   big-endian spelling, which is the mistake worth pinning because **the checksum is the one field in
   SCTP that is not network order**.

   **DATA, SACK and DCEP followed the same day.** aiortc reads our DATA chunk field for field —
   TSN, stream, sequence, protocol identifier, and the B and E flags *both* set, which is the
   ordinary case and the one that is forgotten, since a chunk with neither is a middle fragment of a
   message that never ends. It reads our SACK, and it unpacks a DATA_CHANNEL_OPEN out of a DATA
   chunk under PPID 50, which is how RFC 8832 opens a channel: a data channel has no identifier
   beyond the SCTP stream it runs on, so opening one is a message rather than a negotiation.

   The empty-message identifiers are in for the reason they exist: SCTP cannot carry a zero-length
   DATA chunk, so an empty string goes as one padding byte under PPID 56. That is invisible until a
   peer sends `""`.

   What is missing is the **state machine** — nothing tracks TSNs, retransmits or reassembles — so
   every message a data channel needs can be built and read and nothing yet drives them.

   The checksum is **CRC-32c**, Castagnoli's polynomial, and not the CRC-32 `packages/gzip` already
   has. The two agree on nothing, which is the good kind of wrong: it fails on the first packet a
   real peer sees. Checked against `crc32c("123456789") = 0xE3069283` and against `google-crc32c`,
   the library aiortc itself depends on.
5. **DCEP and a data channel.** ✅ **Done, 2026-08-14, and against a browser rather than aiortc.**
   Chromium's `RTCPeerConnection` opens a channel called `chat` to us: it sends an SCTP INIT inside
   the DTLS connection, echoes the state cookie from our INIT-ACK, opens the channel with a
   DATA_CHANNEL_OPEN we answer, and its `open` event fires. It then sends `"hello from a browser"`,
   we read it out of a DATA chunk, send it back in one of ours, and its `message` handler receives
   it.

   So the whole stack runs end to end against libwebrtc: SDP, ICE, DTLS, SCTP, DCEP.

   Two counters were forgotten in turn, each losing a message with no error anywhere: our **TSN**,
   which the DATA_CHANNEL_ACK had already spent, and the per-stream **sequence number**, which it had
   also spent. An ordered receiver seeing a repeated SSN delivers nothing and says nothing. Both are
   per-stream, both advance independently, and the symptom of either is silence.
6. **SDP.** ✅ **Done, 2026-08-14** — and done early rather than last, because it is small and
   because it carries the two values the rest of the stack cannot work without: the ICE credentials
   and the DTLS fingerprint. `src/sdp.wac` builds the dozen lines a data channel needs and reads the
   attributes it cares about by name.

   Both directions are measured. aiortc's `SessionDescription.parse` reads our offer and gets the
   ufrag, the password, the fingerprint, the DTLS role, the SCTP port and the candidate out of it;
   and we read the SDP a real `RTCPeerConnection` generates with a data channel on it — which is the
   direction that finds omissions, because our own offer contains only what we knew to write.

   Deliberately *not* a general SDP implementation. The format is thirty years of accretion, almost
   all of it about media, and a parser covering the grammar would be nearly all dead code — which in
   a parser is where the bugs that matter live, since nothing exercises it and everything reaches it.

## What is here, and what is emphatically not

The aim — *a WebRTC data channel between a wac peer and a real one, adjudicated by a foreign
implementation* — is met, and it is worth being exact about what that does and does not mean.

**It means** a browser drives every layer of this stack and gets what it expects: an SDP answer it
parses, connectivity checks it accepts, a DTLS handshake it completes against our certificate and our
ECDSA signature, an SCTP association it establishes through a cookie exchange, and a data channel it
opens and sends on.

**It does not mean the package is finished.** What is missing is not features so much as the
machinery that makes a protocol survive a bad day:

- **Retransmission: both layers have it now**, and the two obey opposite rules, which is the part
  worth remembering.

  `Peer` keeps its last flight as **messages** and re-wraps them: a resent DTLS flight carries the
  *same* `message_seq` and *new* record sequence numbers, because the record layer's counter never
  repeats and a replay window drops anything that does.

  `Association` keeps its unacknowledged DATA chunks as **whole packets** and sends them again
  unchanged: a resent SCTP chunk keeps its **TSN**, because the TSN is the identity of the data and
  the receiver deduplicates on it — a chunk resent under a new one is delivered twice. That is the
  opposite of `packages/quic`, where a packet number is used once and reusing one repeats an AEAD
  nonce, so a retransmission there means the same *frames* in a *new* packet.

  Both are tested by making the loss rather than waiting for one: the DTLS flight is built and thrown
  away, and so is the first echo to a browser. Each recovers, and the browser's own SACK is what
  says the retransmission was delivered rather than discarded as a duplicate.
- **A timer, driven by the caller's clock.** `Association.due(now, rto)` answers the chunks whose
  retransmission timer has expired, doubling the interval per attempt to RFC 4960's sixty-second cap.
  Nothing in the package reads a clock — wac has no ambient capabilities — and that turns out to be a
  virtue rather than a constraint: a retransmission timer tested against a real clock is a slow test
  and a flaky one, and this is exercised by handing it numbers.

  `Peer.due` is the same rule for a DTLS flight, where the unit is the whole flight rather than a
  chunk: a handshake is alternating flights, and a peer missing any of one is waiting for all of it.

  And the interval is **measured** rather than handed over: `Association` keeps RFC 6298's smoothed
  round trip and its variation, and `rto()` is the average plus four times the wobble, floored at a
  second and capped at sixty. A **retransmitted chunk gives no sample** — Karn's rule, because its
  acknowledgement could be answering either transmission and taking the later one measures a trip
  that never happened. That is why `flightTries` is kept rather than just a timestamp.

  `test/timers.test.ts` covers all of it in **57 milliseconds**, because the clock is `1`, `2`,
  `1000`.
- **Large messages are fragmented and reassembled**, both ways: 40,000 bytes crosses to a browser
  and back, split across DATA chunks. Every chunk of one message shares a **stream sequence number**
  and takes its own **TSN** — the SSN identifies the message, the TSNs order and acknowledge the
  pieces, which is why they are separate counters.

  Finding that needed the same lesson a third time: **a packet holds several chunks.** A DTLS
  datagram holds several records, a DTLS flight spans several datagrams, and an SCTP packet bundles
  as many chunks as fit — and a reader that takes the first of any of them sees a fraction of what
  arrived. Handing a user the pieces of a message is not a corruption a checksum catches, because
  every piece is intact.
- ~~**No gap blocks in a SACK.**~~ Done, together with the fast retransmit that reads them, because
  neither is worth much alone: a receiver that cannot report a gap gives a sender nothing to act on,
  and a sender that ignores them learns nothing from a peer that does. `Association` now records
  every TSN that arrives above the cumulative point, reports the runs as offsets from it, and folds
  them in when the hole in front closes. On the sending side three SACKs still reporting a TSN
  missing resend it immediately — three rather than one, because reordering produces a gap too and
  resending on the first would double traffic on a path that lost nothing. Fast retransmit halves
  the window and resumes from there rather than dropping to one MTU: a gap is weaker evidence than a
  timeout, since a SACK naming later TSNs proves the path is still delivering.
- ~~**No congestion control.**~~ Done — `Association` now implements RFC 4960 §7.2. The window
  starts at 4,380 bytes, grows by the bytes acknowledged (capped at one MTU per acknowledgement)
  while below `ssthresh`, grows by one MTU per full window above it, and drops to one MTU with
  `ssthresh` halved on a retransmission timeout. **The window governs sending**: `sendLarge` builds
  and numbers every chunk but queues what does not fit, and `flush` releases more as room appears.
  That distinction is the whole point — a controller that computed a number nobody consulted would
  be worse than none, because it would read as congestion control in every summary of this package.
  `test/timers.test.ts` drives the rules on a numeric clock, and the browser test asserts the window
  opened during the 40 KB transfer rather than the message going out in one burst.

  Fast retransmit came with gap blocks in the change after this one; see the item above it.
- ~~**No connection teardown.**~~ RFC 4960 §9.2's three chunks are in: `shutdown()` sends SHUTDOWN
  carrying the cumulative TSN, a peer's SHUTDOWN is answered with SHUTDOWN_ACK, and an ACK is
  answered with SHUTDOWN_COMPLETE. The half that matters more than the chunks is that `send` and
  `sendLarge` return nothing once a shutdown has been agreed — an association that says it is
  finished and then puts DATA on the path makes the peer ABORT, which is a worse close than none.

  **And a browser does not use it.** That was written here as an open question and has since been
  measured: over a whole session Chromium sends exactly one chunk that is not DATA, SACK, INIT or
  COOKIE_ECHO, and it is **ABORT**. No SHUTDOWN, and no RE-CONFIG when the data channel itself is
  closed — closing the channel produced no chunk at all, and the abort came from the peer connection
  closing. `browser.test.ts` asserts the set of kinds, so a browser that starts sending the graceful
  exchange fails this and dates the paragraph.

  So the exchange is one we may *start*, and ABORT is the one we will be *handed* — which made
  ignoring ABORT a real gap rather than a tidy-up. It now closes the association, drops what was in
  flight rather than retransmitting at a peer that has gone, and is never answered (RFC 4960
  §8.5.1). It is kept distinct from an agreed shutdown because the two say different things to
  whatever is above: a shutdown says everything sent arrived, an abort says nothing about what did.

  The bytes of our own SHUTDOWN are checked against aiortc's `parse_packet`, which reads it as a
  `ShutdownChunk` with the right cumulative TSN and our reply as a `ShutdownCompleteChunk`.
- ~~**No consent freshness.**~~ `Consent` in `ice.wac` implements RFC 7675: a check every five
  seconds, consent gone after thirty with no valid response, and a response counting only for the
  transaction we asked about and only if it authenticates — the transaction id travelled in clear in
  our own request, so it proves nothing on its own. A single unanswered check deliberately does
  nothing, because otherwise ordinary packet loss would tear down working connections.

  This is the one rule here that is not for our benefit. ICE proves a peer wanted our packets when
  the connection was made; nothing after that proves it still does, and an address can be reassigned
  under us. It is what stops a WebRTC endpoint being usable as an amplifier aimed at somebody who
  never agreed to receive anything.

  The bytes are checked by aioice — `parse_message` with the peer password verifies our check and
  rejects one signed with a different key. **Chromium answers about one run in six**, which is
  `issues/system/0152` and is not asserted either way in the browser test, because one in six is a
  coin flip. What the browser test does assert is that the checks go out on the selected pair and
  that the timer is live.
- **No key update, no ICE restart.** Neither has come up in practice: WebRTC does not rekey DTLS
  1.2 in any implementation here, and an ICE restart needs renegotiation, which needs a signalling
  channel this package does not own.

**The SCTP association is now a struct in wac** — `Association` in `sctp.wac` owns the peer's tag,
the TSN, the per-stream sequence numbers and the cumulative point, and answers a packet with the
packets to send. The browser test drives its data channel through it. It was written because of the
two bugs above: a counter that must advance on every send belongs to the thing that sends, not to
whoever remembered.

wac has no mutable globals — `spec/tour.wac` says so, and the reason is that every piece of state
should be a parameter — so the association is threaded in and out rather than held. For this struct
that is the shape rather than a workaround: a caller holds one per peer and there is nowhere for a
second peer's counters to hide.

**And the DTLS state is a struct too** — `Peer` in `peer.wac` owns the reassembly, the transcript,
the keys, and both sequence counters, and answers a datagram with the datagrams to send. The browser
test now feeds it bytes and sends what comes back; between `Peer` and `Association` there is nothing
left in the test but the two lines that join them, and the data channel on top.

Every one of the three bugs that cost a debugging cycle in this package was state a caller was
keeping: a restarted record sequence, a restarted `message_seq`, and a ClientHello read as though it
were whole. They are the argument for both structs, and the reason each file says so at its top.

### The bug the flakiness was hiding

Worth recording because the symptom pointed the wrong way. The 40,000-byte transfer passed about half
the time and failed as a timeout, which reads as *slow*. It was not: `cumulativeTsn` was taking the
**highest TSN seen** rather than the highest **in order**.

Cumulative means *everything up to and including this arrived*. Reporting a higher number than is
true tells the peer that a chunk we never received has been delivered, so it never resends it and the
message it belonged to is never completed. That needs a reorder or a loss to show, which is why it
was intermittent, and why raising the timeout — the obvious response to a test that times out — would
have hidden a correctness bug behind a slower test.

## The layers, joined

`Session` in `src/session.wac` owns the DTLS peer, the SCTP association and the consent timer
together. `receive` takes a datagram and answers with the datagrams to send; `send` takes a message;
`tick` releases whatever the congestion window now allows. A caller supplies a socket and a clock.

This was written last and it should probably have been written earlier. Everything under it is a
codec or one layer's state machine, and joining them was left to whoever called — which was fine
while the only caller was a test, and meant that a program wanting a data channel had to
reimplement, correctly, every ordering rule this note records getting wrong. Chromium's whole
exchange runs through it now.

Two things it taught immediately, which is the argument for building a consumer at all:

- **The sender's address has to be a parameter.** A check response carries XOR-MAPPED-ADDRESS, which
  is how a peer behind a NAT learns its own reflexive address — the one field that cannot be derived
  from the request. A session holds no socket, so a session that filled it in itself would send a
  response that parses cleanly and says nothing.
- **The walk over a packet's chunks was in a test probe.** That is the single piece of this package
  nothing gets right by accident — the "a container holds several" mistake, made three times at
  three layers — and it was living where no program could reach it.

And one constraint worth recording because its error message says nothing about it: **structs do not
cross module instances**. Each `wacBind` is its own wasm instance, so a `Peer` built by the peer
probe cannot be handed to the session probe; the failure is `type incompatibility when transforming
from/to JS`. A probe that composes has to construct from bytes.

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
