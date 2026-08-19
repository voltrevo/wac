# 0007 — QUIC, and the datagram capability it needs first

- **Status:** done — all six steps, 2026-08-13
- **Opened:** 2026-08-12
- **Written by:** agent-a, from a decision with the operator
- **Depends on:** [0001](0001-a-self-contained-system.md)'s capability surface, and `packages/tls`
  for the half of QUIC that is TLS.

## What we are aiming at

A QUIC version 1 client and server written in wac, adjudicated by a foreign implementation **in both
directions**: our client completing a connection to theirs, and their client to our server.

What it is **not**, and these are exclusions rather than omissions:

- **not HTTP/3.** That is a layer above, with its own framing and its own QPACK. It is the obvious
  next thing and it is not this thing.
- **not a congestion-control study.** One honest, simple controller. A stub that ignores loss is
  worse than nothing because it works perfectly on loopback and falls over on a real path, which is
  the failure mode this repository is least able to see.
- **not 0-RTT, connection migration or stateless retry in the first pass** — but see D5, because the
  connection-ID handling has to leave room for them rather than assume they never arrive.

## Why this one, and what would say we got it wrong

[0006](0006-candidates-for-what-to-build-next.md) sets the test: not "is it interesting" but *what
would say we got it wrong*, and *can that thing be run here, on demand, without a service we do not
control*. It also files QUIC under **blocked on a decision** — there is no datagram capability, and
adding one is a question about the surface rather than a Tuesday's work.

The oracle question is answered, and it was answered by measurement before any of this was written.

**Deno 2.9.1 carries a whole QUIC stack** — `connectQuic`, `QuicEndpoint`, `QuicListener`,
`QuicConn`, and the stream types — which is quinn and rustls underneath: an independent, mature
implementation by people who have never seen ours. It is already installed. On 2026-08-12 a server
and a client stood up on loopback in this container, completed a handshake, negotiated ALPN and
exchanged a bidirectional stream:

```
listening on 127.0.0.1:33538
client got: pong:ping
alpn: probe
```

It took three tries, and the failures are worth keeping because each is a thing we will hit again:
`localhost` resolved past an endpoint bound to `127.0.0.1` and the handshake timed out; then
`certificate_unknown`; then `CaUsedAsEndEntity`, because rustls will not accept a leaf as its own
trust anchor. A CA and a leaf signed by it fixed it.

**And fixtures can be minted rather than transcribed.** Pointing Deno's QUIC client at a plain UDP
socket hands over its first flight:

```
datagram bytes: 1200
first 32: cf 00 00 00 01 14 5c 8e dc 72 a3 6a 87 a7 ba 35 …
long header: true  fixed bit: true  type: 0 (Initial)   version: 00000001
```

A real QUIC v1 Initial — 1200 bytes because of the anti-amplification minimum, a 20-byte destination
connection ID. So the early steps have an oracle that needs no RFC text in the container and no
network: we can produce genuine packets from a genuine implementation whenever we want one.

## Decisions

### D1 — the oracle is Deno's QUIC, in both directions, and it is not the specification

Two implementations agreeing is worth a great deal and is not proof: they can share a
misunderstanding, which is exactly what `packages/box`'s `wc` did with itself until a real `wc`
was asked (issues/system 0143). Where we and quinn disagree, **the RFC decides and the disagreement
gets written down** rather than resolved by moving our behaviour until the test passes. That is the
same discipline `packages/tls` follows against OpenSSL and rustls.

### D2 — the capability is a datagram socket, not connected UDP

`Cli` has `connect`, `listen`, `accept`, `recv`, `send`, `closeSocket`, and every one of them is a
stream. The addition is a datagram socket: bind to an address, receive a payload **with the peer it
came from**, send a payload **to a peer named per message**.

The cheaper-looking alternative is to reuse the stream calls with a UDP flag, so a `connect` fixes
the peer and `recv`/`send` carry payloads. It is rejected for a reason specific to QUIC rather than
on taste: **a server answers many peers from one socket**, and a QUIC connection is identified by its
connection ID rather than by its address, so a peer's address may legitimately *change mid-connection*.
A connected socket cannot represent either, and the second one is not an edge case — it is what
migration is.

Per host, since a capability is only as portable as its worst host:

| host | what it costs |
| --- | --- |
| `host/deno.ts` | `Deno.listenDatagram`, which needs `--unstable-net`; the build already varies the launcher by grant, and `tools/runTests.ts` needs it too |
| `host/node.ts` | `node:dgram`, stable |
| `native/` (wasmtime) | a Rust `UdpSocket`, plus an `Outcome`, a `Kind`, a `make_datagram` and a registration in the pending-kind table |
| `native/v8` | the same again in that host's own shapes — `Sock::Datagram`, `Answer::Datagram`, `build_datagram` |
| `host/browser.ts` | **refused**, joining `connect`/`listen`/`accept` |

**There are two native hosts and they are not interchangeable**, which this table said wrongly until
2026-08-12: it listed `native/v8` alone and the order of work below said "the three hosts". The one
that matters for the invariant is `native/` — `conformance.test.ts`'s check that "every capability
the language declares, the host with no JavaScript supplies" reads `native/src/main.rs`, so
implementing V8's arms does not satisfy it. `native/v8` is where the direction is going
(design/lang 0003 makes V8 the primary platform) and `native/` is what the suite checks today. A
capability needs both, and finding that out by writing one and watching the ledger fail is a waste
of an afternoon.

The browser refusal needs no new argument: that file already refuses TCP because "a page has no TCP…
pretending otherwise would give an application a `connect` that works for one protocol and silently
fails for the rest". A page has no UDP either. WebTransport is QUIC over HTTP/3 offered as a service,
which is the opposite of what this is for.

### D3 — no new grant, and the audit surface still changes

`Grants` is `{ read, write, env, net }` — one coarse bit for the network. A datagram capability sits
under `net` and adds no confinement axis, so this is **not** the shape of
[0137](../../issues/system/open/0137-a-symlink-capability-needs-a-confinement-rule-before-an-implementation.md),
where the object's contents are a path and the rule is unstated.

What does change is what a granted program can do without asking again. A TCP peer is fixed by a
`connect` that the host performs; a datagram peer is named per message, and unsolicited datagrams
arrive from anyone who knows the port. Neither is new authority — a program with `net` could already
connect anywhere — but it is a different audit surface, and the sealed-session path
([0116](../../issues/system/closed/0116-a-spawned-stage-gets-the-hosts-world-not-the-sessions.md))
must hand a child the same world for datagrams as it does for streams rather than defaulting to the
host's.

### D4 — TLS comes from `packages/tls`, minus its record layer

QUIC carries TLS 1.3 handshake messages in CRYPTO frames and derives its own packet keys with the
TLS key schedule. Usually this means taking a TLS implementation apart. Ours is already apart:

- `src/handshake.wac` builds and parses **handshake messages** as byte arrays — `handshakeMessage`,
  `serverHello`, `certificate`, `certificateVerify`, `finished`, `parseClientHello`;
- `src/keyschedule.wac` exposes `expandLabel`, `deriveSecret`, `earlySecret`, `handshakeSecret`,
  `masterSecret`, which is exactly the machinery QUIC's key derivation is expressed in;
- `src/record.wac` is the part QUIC replaces, and nothing above depends on it.

So the largest-looking risk is the one already paid for. What remains genuinely new is the packet
protection: header protection is a mask derived from the sample of the ciphertext, and it has no
analogue in TLS records.

### D5 — version 1 only, and connection IDs are carried rather than assumed away

`00000001`. Any other version is refused rather than negotiated. But **connection IDs are modelled
properly from the first packet parse**, because they are what makes a QUIC connection independent of
its address — and a first pass that keys connections by address would have to be unpicked to add
migration, retry or a load balancer later. Carrying the ID costs nothing now and forecloses nothing.

## Order of work

Each step's *done* is a differential against Deno, not a demonstration.

1. **The datagram capability.** `Cli` gains bind/receive/send-to across the four hosts that can
   honour it — Deno, Node, and both native ones — refused in the browser. **Done when** a wac program echoes datagrams and a Deno peer
   agrees, both directions, in the suite.
2. **Packet shapes.** Long and short headers, connection IDs, variable-length integers, packet
   numbers. **Done when** every captured fixture parses to the same fields Deno's own reading of it
   would give, and a malformed one is refused rather than half-read.
3. **Initial keys, header protection, AEAD.** **Done when** we can unprotect a captured Initial from
   Deno *and* protect one that Deno accepts. This is the first step where being wrong is invisible
   without the oracle, because a wrong key produces bytes that look exactly as random as right ones.
4. **CRYPTO frames and the handshake.** **Done when** our client completes a handshake with Deno's
   server and both sides agree on the traffic secrets.
5. **Streams, flow control, acknowledgements, loss detection.** **Done when** a bidirectional stream
   echoes in both directions and survives deliberately dropped datagrams.
6. **The mirror.** Deno's client against our server. **Done when** step 4 and 5's tests pass with the
   roles swapped.

## State of play

| step | state |
| --- | --- |
| 0. an oracle, and fixtures | **done, before anything was written.** Deno's QUIC handshakes on loopback offline; its client's Initial packet is capturable as a fixture. |
| 1. datagram capability | **done — a wac program echoes datagrams and Deno's own UDP agrees, on every host that can honour it.** `Cli` declares `bindDatagram`, `receiveFrom` and `sendTo`; `Datagram` carries the payload and its sender in one answer; `example/echod.wac` is the server and `echod.test.ts` drives it from Deno's UDP on Deno, Node and the V8 host, with the wasmtime host checked by hand. The block was [issues/lang 0109](../../issues/lang/closed/0109-sixteen-callback-slots-per-signature-is-not-far-past-what-an-api-asks-for.md), closed by registering one funcref slot per *capability* rather than per `Pending<T>`: that class went from 16 of 16 to 1, so the three fields cost no slot pressure at all. What they do cost is **+8.1% of module on every program** — `wc` 156,159 → 168,866 bytes, 42 → 45 callback signatures — whether or not it ever sends a datagram, which is [issues/system 0147](../../issues/system/open/0147-every-program-pays-for-every-capability-on-cli.md). |
| 2. packet shapes | **done.** Version, type, both connection ids, an Initial's token and where the packet number begins, checked against a real quinn Initial minted each run; malformed and truncated headers refused rather than half-read. Short headers take their id length as an argument, because the packet does not carry one. Retry and version negotiation are done too: `retryIntegrityOk` verifies **RFC 9001 §A.4's own published Retry packet**, which is the sharpest oracle in this package — the tag's key and nonce are fixed and public, so a wrong implementation would have to match the RFC's bytes by accident. A tag proves the sender saw the client's original destination connection id, not that it is anybody in particular, so the test that flips one byte of that id is the one that says what the check is worth. Version negotiation is recognised by its *version* rather than its type, because its type bits are random by instruction, and a reserved version goes first in the test so nothing can pass by taking `versions[0]`. |
| 3. initial keys and packet protection | **done, and it is the step that proves the rest.** `src/initial.wac` derives RFC 9001 §5.2's keys — matching §A.1's published vectors byte for byte — removes header protection and opens the packet with AES-128-GCM. **quinn's own Initial decrypts to a TLS ClientHello**, which is one assertion establishing the salt, the labels, the sample offset, the nonce and the AAD together. Protecting one that Deno accepts is not done: that needs a client, which is step 4. |
| 4. CRYPTO frames and the handshake | **done — a real QUIC server completes a handshake with this client.** Two datagrams: an Initial carrying a ClientHello we wrote, and a Handshake carrying our Finished; Deno's `accept()` yields a connection. Both sides agree on the Handshake secrets — quinn's Handshake packet opens under keys derived here, and its Finished verifies against our transcript. The application epoch is next: the server moves to short-header packets on completion and nothing here reads one | **It is now a program**: `example/handshake.wac` binds its own datagram socket, generates its own scalar and connection ids, verifies the server's Finished before answering, and exits 0 only when a short-header packet comes back — run against quinn on the Deno host and on the V8 host by `test/wac/program_test.wac`. Writing it is what found that the client could not have a fresh key: every step recomputed the ClientHello from `(dcid, scid, serverName)`, which is a function only while the scalar and the random are constants, so `src/client.wac` now holds the message it sent. **The application epoch is read too**: `openShort` opens quinn's first 1-RTT packet under keys taken from the master secret at the transcript through the server's Finished, and `test/wac/application_test.wac` asserts it opens, that the key phase reads 0, and that a wrong id length opens nothing. AES-128-GCM's tag is 128 bits, so "it opened" is every derivation in that epoch at once.
| 5. streams and loss detection | **done — a stream echoes both ways and survives a dropped datagram.** All of RFC 9000 table 3 reads — STREAM with its four spellings of offset, length and fin; the flow-control and blocked frames; NEW_CONNECTION_ID, PATH_CHALLENGE/RESPONSE, HANDSHAKE_DONE — and, for the first time, table 3's *other* column: which packet types may carry each frame. `nextIn` takes the epoch and `NotPermitted` is its own answer, distinct from `Unknown`, because "you may not say that yet" and "I do not know what that is" are different accusations. An application-level CONNECTION_CLOSE in an Initial used to be accepted. `test/table3.test.ts` is the whole table hand-encoded from §19, walked end to end so one wrong length derails the frame after it. **Acknowledgements go out too**: `writeAck` is the writing half of a reader that could already parse every ACK range, `shortPacketNumber` recovers what a server's packet was numbered, and `test/wac/stream_test.wac` sends an ACK and then a second stream — because RFC 9000 §19.3 makes an over-generous ACK a PROTOCOL_VIOLATION, so the connection outliving it is the assertion. Canaried by acknowledging a thousand packets past what arrived: the first stream lands, the second never does. And `connection.wac` is the state: what was sent, what was acknowledged, what to send again. Frames are retransmitted and packets are not — RFC 9000 §13.3 — so a resend puts the same frames in a **new** packet with a new number, because the nonce comes from the number and reusing one loses the key rather than the packet. `test/wac/stream_test.wac` drops the first packet on the floor and sends only the retransmission; the server's application gets the bytes and cannot tell. Canaried by reusing the number, which the test catches as the two packets being byte-identical. `test/wac/connection_test.wac` drives the accounting a server cannot see: numbering, liveness, that a resend retires the record it copied, and that repeated resends do not grow the outstanding count. What is not started is the rest: sending, retransmitting, acknowledging and the windows. | `sealShort` writes what `openShort` reads, and `Client.streamPacket` puts a STREAM frame in a 1-RTT packet: `test/wac/stream_test.wac` opens stream 0 to quinn and **quinn's own application API hands the bytes back**, which needs the packet authenticated, the frame parsed, the stream id legal and flow control satisfied. And back: an echo server written against Deno's own QUIC API upper-cases what we send, and `Client.streamBytes` reads it out of the 1-RTT packet that carries it — reassembled **by offset**, driven with frames out of order and with a gap in `table3.test.ts`, because a fourteen-byte echo arrives in one frame and would never exercise either. **Acknowledgements go out too**: `writeAck` is the writing half of a reader that could already parse every ACK range, `shortPacketNumber` recovers what a server's packet was numbered, and `test/wac/stream_test.wac` sends an ACK and then a second stream — because RFC 9000 §19.3 makes an over-generous ACK a PROTOCOL_VIOLATION, so the connection outliving it is the assertion. Canaried by acknowledging a thousand packets past what arrived: the first stream lands, the second never does. And `connection.wac` is the state: what was sent, what was acknowledged, what to send again. Frames are retransmitted and packets are not — RFC 9000 §13.3 — so a resend puts the same frames in a **new** packet with a new number, because the nonce comes from the number and reusing one loses the key rather than the packet. `test/wac/stream_test.wac` drops the first packet on the floor and sends only the retransmission; the server's application gets the bytes and cannot tell. Canaried by reusing the number, which the test catches as the two packets being byte-identical. `test/wac/connection_test.wac` drives the accounting a server cannot see: numbering, liveness, that a resend retires the record it copied, and that repeated resends do not grow the outstanding count. What is not started is the rest — no packet-number counter, no acknowledgements, no retransmission — so the caller passes the number in, and one lost datagram still ends the exchange. **Packet numbers decode**, though: `decodePacketNumber` is RFC 9000 §A.3, checked against the RFC's own worked example and at both corrections — a candidate more than half a window behind has wrapped and belongs a window higher, one more than half a window ahead has not and belongs a window lower. A receiver still has nowhere to keep the largest it has processed, which is what the function needs handed to it. That is the second half of this step's done-when, and it is the half that needs a connection rather than a packet.

Two things the application epoch found, recorded because neither was visible from the library side:

- **A packet that failed authentication trapped instead of being discarded.** Every reader in
  `initial.wac` documents "empty on any failure — ... a tag that does not verify", and all of them
  reached `gcmDecrypt`, which traps on a bad tag *by design* — an AEAD whose failure can be ignored
  is the classic misuse. That is right for a primitive and wrong for QUIC: RFC 9001 §9 requires an
  endpoint to discard an unauthenticatable packet and carry on, because anyone who can reach the
  four-tuple can send one. `unprotect` now checks the tag itself, in constant time, and the primitive
  keeps its trap for everyone else. `test/wac/tamper_test.wac`. It survived this long because every other
  test in the package feeds the reader packets that are *right*.
- **It is not a class.** `packages/tls`'s `recordOpen` and `packages/ssh`'s ciphers trap too, and both
  say so — and both run over TCP, where RFC 8446 makes a bad MAC a fatal alert. QUIC was the one place
  where the contract was claimed and not delivered, and the one protocol whose RFC requires the
  opposite.

| 6. the mirror | **done — a real QUIC client handshakes with a server written here, opens a stream on it, and reads the answer.** `src/server.wac` reads a client's Initial, answers with a coalesced Initial+Handshake datagram — ServerHello, EncryptedExtensions with transport parameters *and* ALPN, Certificate, an RSA-PSS CertificateVerify and Finished — and `Deno.connectQuic` resolves against it. Every piece already existed in `packages/tls` and `initial.wac`; what was missing was the assembly. Three things it found, each of which passed everything before it: the client's key share carries its **group tagged in front of the key** and the server's does not, so 34 bytes were read as a 32-byte key and the flight silently answered nothing; a QUIC server that selects no ALPN is closed by the client with `no_application_protocol`, whatever else it got right; and one self-signed certificate cannot be both CA and end entity — rustls says `CaUsedAsEndEntity`, so the test generates a CA and a leaf. Canaried by echoing the wrong `original_destination_connection_id`, which the client refuses as a CID authentication failure. Then step 5's test with the roles swapped: the client opens a bidirectional stream, our server reads it out of a 1-RTT packet and answers on the same stream, and the client reads that — which is a different set of keys, taken at a different point in the transcript, in a packet shape with no length and an id length only the receiver knows. Canaried by sealing the answer under the client's direction rather than the server's, which the client cannot open. What is *not* done is a server with connection state: the packet number is passed in, nothing is retransmitted, and no Retry means it answers every packet immediately. |

## Open questions

- **Which congestion controller is the minimum honest one?** Loopback will never punish the wrong
  answer, so this needs a test that drops datagrams on purpose — which is a thing the datagram
  capability makes easy to build and is worth building early rather than late.
- **Does a sealed session get datagrams at all?** D3 says it must not gain them by default. Whether
  it should be able to gain them deliberately is a question for whoever owns sealing.
- **Where does the ALPN string come from?** A QUIC connection negotiates one, and with no HTTP/3 there
  is nothing standard to offer. The tests can invent one; a real peer will want `h3`, which is a
  promise we cannot keep yet.
