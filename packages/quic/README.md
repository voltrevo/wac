# quic

QUIC version 1 — RFC 9000 and RFC 9001 — in wac. **A wac program completes a handshake with a real
QUIC server**, over a socket of its own, with a key it generated. Two datagrams out: our Initial
carrying a ClientHello we wrote, and a Handshake carrying our Finished. Deno's `accept()` yields a
connection. design/system 0007 step 4, done 2026-08-13.

    deno task app:build packages/quic/example/handshake.wac --allow-net -o handshake.js
    deno run -A --unstable-net handshake.js 127.0.0.1 4433 localhost

`src/client.wac` is the client — through the handshake and into the application epoch, where
`openShort` reads the 1-RTT packets a server sends once it has accepted — and `example/handshake.wac`
is the program; `test/program.test.ts`
runs it against quinn on both the Deno host and the one with no JavaScript in it. The library was
finished before either existed, and writing the program is what found the two things missing from
it — a client that could not have a fresh key, because it recomputed its ClientHello rather than
remembering it, and a platform where no program could open a datagram socket at all.

```wac
import { Varint, decode, encode, encodedLength } from "../quic/src/varint.wac";

Varint v = decode(bytes, 0);          // v.size is 0 when the input ends mid-encoding
i32 n = encode(out, 0, 494878333 as i64);
```

The direction is [design/system 0007](../../design/system/0007-quic-and-the-datagram-capability.md),
which has the decisions, the order of work and a state of play. This file says only what exists.

## What exists

**`src/varint.wac`** — the variable-length integer of RFC 9000 §16, which almost every other field
in QUIC is built out of: frame types, stream ids, offsets, lengths. Checked against §A.1's four
published encodings and round-tripped at every boundary of the four widths.

Two properties are worth knowing before using it:

- **The encoding is not canonical.** 37 is `25` and is also `4025`, and the RFC permits both — "the
  encoding is not required to use the minimum number of bytes". `decode(encode(v))` is `v`;
  `encode(decode(b))` is *not* `b`, and nothing here asserts that it is.
- **Truncation is not an error.** A varint that runs off the end answers a size of 0 rather than a
  value, because a datagram trimmed to the path's limit legitimately ends mid-frame. "This packet
  stops here" and "this packet is malformed" are different answers and the caller decides which.

**`src/packet.wac`** — the long header, as far as anyone can read it without keys: version, packet
type, both connection ids, an Initial's token, and where the packet number begins. Checked against a
**real Initial minted from Deno's QUIC client each run**, not a checked-in blob, so it notices when
quinn changes what it sends.

The short header is the shape that surprises: it carries one connection id and *no length for it*,
because the receiver chose the id and is expected to know. `parseShortDcid` therefore takes the
length as an argument. There is no signature that could work without one, and that is the point.

**Both take a `greased` argument for the same reason.** RFC 9000 calls bit 0x40 the *fixed bit* and
says a packet without it is not a valid version-1 packet; RFC 9287 then makes it negotiable, so an
endpoint that advertised `grease_quic_bit` may be sent a zero there. A real Deno QUIC server greases
**about two replies in three** — measured, 13 of 20 — so refusing a cleared bit outright drops most
of what a server sends. Whether a zero is acceptable is connection state, not a property of the
packet, so the caller answers. This file said the opposite until 2026-08-13, in a comment claiming no
version-1 peer sends a zero; `test/wac/greased_test.wac` is that comment being wrong.

**`src/initial.wac`** — the keys that protect an Initial, and opening one. RFC 9001 §5.2's
derivation, header protection, and AES-128-GCM.

The check that matters is that **quinn's own first flight decrypts to a TLS ClientHello**. A key that
is wrong in one bit produces bytes exactly as random-looking as a right one, so there is nothing to
inspect and nothing to reason about: either the peer's packet opens or it does not. One passing
assertion establishes the salt, the four labels, the header-protection sample offset, the nonce
construction, and that the AAD is the *unmasked* header — every one of them load-bearing.

The derivation also matches RFC 9001 §A.1's published vectors exactly, which is how the transcribed
salt stopped being a hypothesis:

    secret  c00cf151ca5be075ed0ebfb5c80323c42d6b7db67881289af4008f1f6c357aea
    key     1f369613dd76d5467730efcbe3b1a22d
    iv      fa044b2f42a3fd3b46fb255c
    hp      9f50449e04a0e810283a1e9933adedd2

An Initial's keys are derivable by anyone on the path — the connection id is public and the salt is
in the RFC — so this is a version and tamper check rather than confidentiality. That is what makes it
testable at all.

**`src/frame.wac`** — the frames inside a decrypted payload, and the CRYPTO stream they add up to.
The five an Initial may carry, which RFC 9000 §17.2.2 fixes: PADDING, PING, ACK, CRYPTO and
CONNECTION_CLOSE.

The check is that **quinn's Initial decrypts to a ClientHello `packages/tls` recognises** — 32-byte
random, TLS 1.3 offered, a key share it knows, `TLS_AES_128_GCM_SHA256`. A frame walk that read one
length wrong produces bytes that are not a handshake message at all, and there is nothing to
eyeball: a decrypted payload and garbage look the same.

Two things the shape of the reader is about:

- **Stopping is two different answers.** *Incomplete* is the datagram ending mid-frame, which is
  ordinary — a sender pads to the path limit. *Unknown* is a type nobody here knows, which is a
  protocol violation, and it must stop the walk rather than skip: a frame's length lives inside its
  own encoding, so there is nothing to skip over. Both report a size of 0, so a caller that does not
  care can loop on the size alone.
- **The CRYPTO stream is reassembled by offset, not by arrival.** A ClientHello can be larger than a
  datagram, so the handshake stream is cut across packets and may arrive out of order. Only the
  contiguous prefix from offset 0 is handed back, because TLS is a stream and a message is not there
  until its bytes are.

**Sealing, in `src/initial.wac`** — `sealClientInitial` builds a client Initial: one CRYPTO frame,
PADDING to RFC 9000 §14.1's 1200 bytes, the long header, AES-128-GCM over the payload with that
header as AAD, and header protection last.

**The oracle is that a real server answers.** A QUIC server drops what it cannot open in silence —
answering an unauthenticated datagram would be a reflection attack — so a wrong nonce, a wrong tag, a
mask applied in the wrong order or a length field off by one all produce nothing at all. What comes
back instead is an Initial addressed to the source id we sent from, carrying an ACK and a
**ServerHello**, which `openServerInitial` then opens under the id the client invented.

Three things that turned out to be load-bearing, each canaried by breaking it:

- **1199 bytes is not 1200.** One byte under the anti-amplification minimum and the server never
  replies. Our own reader opens the short packet perfectly, which is the clearest statement of why
  reading back what you wrote is not a test.
- **The AEAD is keyed by direction.** Sealing with the server's keys instead of the client's
  produces a packet that is well-formed in every visible way and is silence on the wire.
- **A borrowed ClientHello constrains the source id.** It carries `initial_source_connection_id`,
  and a server checks the header agrees; invent one and quinn answers `TRANSPORT_PARAMETER_ERROR`
  with the reason `CID authentication failure`. That refusal is asserted too, because a server that
  refuses for the right reason is a server that really read what we sent.

**`src/params.wac`** — QUIC's transport parameters, which travel in TLS extension 57 rather than in
any QUIC packet, so that the handshake authenticates them. Each is a varint id, a varint length and
that many bytes.

One is mandatory and it is the one that bites: `initial_source_connection_id` must equal the source
id in the packet carrying the ClientHello, and a server checks. That check is why a *borrowed*
handshake can only be sent from the id its author used, and the test that proves the parameters are
read rather than carried sends a flight differing in nothing else and gets
`TRANSPORT_PARAMETER_ERROR` back.

**A first flight of our own** — `src/client.wac` puts `packages/tls`'s `clientHello`,
these parameters and an x25519 share **we hold the private half of** into a sealed Initial. quinn
answers it with an ACK and a ServerHello, so every byte on the wire is ours and the shared secret is
computable, which the borrowed version could never be. Canaried by removing the transport parameters
(all three tests fail) and by removing the ALPN (two do). `test/wac/hello_probe.wac` is that client
with its scalar and client random pinned to constants, which is what makes those comparisons
reproducible — and which is why the freshness of a real client's key is checked by
`test/program.test.ts` instead, where two runs of the program must differ.

**A bidirectional stream, both directions.** `Client.streamPacket` seals a STREAM frame into a 1-RTT
packet and quinn's own application API yields the bytes on stream 0; an echo server written against
Deno's QUIC API answers, and `Client.streamBytes` reads that back out of the packet carrying it —
`test/wac/stream_test.wac`. Reassembly is by offset rather than arrival order, which `table3.test.ts`
drives with frames out of order, with a gap, and with another stream's frames mixed in.

**And the mirror: a real QUIC client completes a handshake with our server.** `src/server.wac` reads
a client's Initial and answers with one datagram carrying an Initial and a Handshake packet — the
ServerHello, EncryptedExtensions with transport parameters and ALPN, the Certificate, an RSA-PSS
CertificateVerify and the Finished. `Deno.connectQuic` resolves against it — and then opens a bidirectional stream, which the server
reads out of a 1-RTT packet and answers on. design/system 0007 step 6.

**A dropped datagram is survived.** `src/connection.wac` holds what was sent, what was acknowledged
and what to send again. Frames are retransmitted and packets are not — a packet number is used once,
since the AEAD nonce comes from it — so a resend is the same frames in a new packet. The test drops
the first packet and sends only the retransmission.

**And acknowledgements.** `writeAck` is the writing half of a reader that could already walk every
range, and it refuses a range reaching below packet zero — a peer that believes a lost packet arrived
never resends it, so a too-generous ACK loses data rather than being rejected. The server accepting
one is proven by the connection outliving it: an over-generous ACK is a `PROTOCOL_VIOLATION`. The connection
*state* is what is missing: no packet-number counter, no acknowledgements, no retransmission, so the
number is passed in and one lost datagram ends the exchange. design/system 0007 step 5.

**`src/frame.wac`** — RFC 9000 table 3, both columns. Every frame type reads at its documented
length, and `nextIn` takes the epoch, because table 3 also says which packet types may carry each
frame: PADDING and PING everywhere, ACK and CRYPTO everywhere but 0-RTT, HANDSHAKE_DONE in 1-RTT
alone, and the rest only where an application layer exists. `NotPermitted` is a separate answer from
`Unknown` — a frame that is real but not allowed here is the peer's fault, and one nobody knows is
ours. Hand-encoded cases for the whole table in `test/table3.test.ts`, walked end to end.

**`src/keys.wac`** — where QUIC stops deriving its own secrets and starts using TLS's. Initial keys
come from a connection id anyone on the path can read, so they authenticate a version and nothing
else; Handshake keys come out of the TLS key schedule, so they depend on a Diffie-Hellman exchange
and on every handshake byte both sides have seen.

The join between the two specifications is one sentence — take TLS's traffic secret and expand it
with `quic key`, `quic iv` and `quic hp` instead of TLS's own `key` and `iv` — and this file is that
sentence. Everything above it is `packages/tls`'s and everything below is protection `initial.wac`
already did, which is why `openAt` takes keys rather than deriving them.

**And the server's Finished verifies**, which is stronger. Opening the packet says the *keys* match;
a Finished is an HMAC over every handshake message so far, keyed by a secret only a peer that did the
same Diffie-Hellman can compute, so verifying it says the **transcripts** match — every message, in
the same order, hashed over exactly the same bytes, with the boundary in the same place. The boundary
is the part that is off by one: a Finished authenticates what came before it and cannot include
itself, so the transcript runs from our ClientHello through the server's CertificateVerify and stops.

The whole server flight — EncryptedExtensions, Certificate, CertificateVerify, Finished, 658 bytes —
arrives in that one packet, because it fits inside the 1200 a server may send before it has validated
our address. A larger certificate would not, and reassembly by offset is what will carry that.

**The check is that quinn's Handshake packet opens.** Those keys depend on the shared secret *and*
the transcript, so a wrong x25519, a transcript hashed over the wrong bytes, the client's traffic
secret where the server's belongs, or TLS's label instead of QUIC's each produce keys that are
well-formed and that quinn does not share — and the packet decrypts to nothing. Each of those four
was applied on purpose and each failed exactly the one test that makes the claim.

`packet.wac` gained `nextPacketAt` for this: a server's first flight coalesces an Initial and a
Handshake into one datagram (RFC 9000 §12.2), and a reader that stops at one packet per datagram
never sees the handshake at all.

**`sealLong`** seals any long-header packet, which is what lets a Handshake packet reuse every line
of the Initial's protection. It differs by one field — only an Initial carries a token length — and
by padding: RFC 9000 §14.1 pads a datagram carrying an *Initial*, so our Finished packet is eighty
bytes rather than twelve hundred.

**The oracle is `accept()` resolving.** A `QuicListener` yields a connection when the handshake
completes and never otherwise, which makes it a sharper instrument than anything before it: the
tests above check our arithmetic against bytes the server sent, so a mistake made consistently in
both directions could survive them. Here quinn does the checking with its own code.

Two deliberate failures stand beside it, so the pass cannot be read as luck: a Finished addressed to
the id we invented rather than the one the server chose completes nothing — a connection is
identified by the id its *receiver* picked — and a Finished with one bit of its `verify_data`
flipped completes nothing either, having been resealed so the packet still authenticates and only
the HMAC is wrong.

## What does not exist yet

Not the application epoch, and not streams — this section said both until 2026-08-14 and they landed
that day. What is missing is **state and time**, which is a different kind of thing from a packet
shape and is why it did not come with them:

- **A connection, on the server side.** `src/server.wac` builds bytes from bytes, as the client did
  before `connection.wac`. A server needs one connection per peer and has nowhere to put it.
- **A loss-detection timer.** RFC 9002's probe timeout is a smoothed round-trip and a variance
  estimate; `connection.wac` has neither, so a caller decides when to give up on a packet and calls
  `resend`. That is honest about where the decision lives and it is not loss detection.
- **Congestion control.** Nothing counts bytes in flight or slows down. Invisible on loopback, and on
  a real path it is the difference between a connection and a problem.
- ~~A record of the largest packet number processed.~~ **Done**: `Connection.receive` opens a packet,
  decodes its number against the largest **processed**, and moves the window only if it opened. Not
  "received" — a packet that failed authentication tells you nothing, and letting one move the window
  lets a stranger move it with noise. The test flips one ciphertext byte and asserts the window did
  not move.
- **Retry and address validation.** The server answers every packet immediately, which is safe on
  loopback and is the shape that amplifies an attack at a spoofed address anywhere else.
- **`Connection.of` still asks nothing.** `Connection.checked` is the constructor that verifies
  before it hands anything back, and it is the one a program should use; `of` remains for tests and
  for the server side, where there is no certificate to check. So the hole is now a choice a caller
  can make wrongly rather than one it makes by default — which is better and is not the same as
  closed.
- **Key update, 0-RTT, session tickets, HelloRetryRequest.** A client offering a group we do not have
  gets nothing; the only group is x25519.

The order these arrive in, and what each one's oracle is, is in the design note rather than repeated
here.

## The oracle

**Deno's QUIC**, which is quinn and rustls underneath and is already installed: it both listens and
connects, so our client can be adjudicated by their server and their client by our server. Measured
offline in this container on 2026-08-12 before any of this was written — a loopback handshake with
ALPN and a bidirectional stream.

The server half is reachable without writing a packet yet: replaying a genuine Initial at a
`Deno.QuicEndpoint` makes it answer, because the Initial keys come from a connection id the sender
chose and the ClientHello inside is well-formed whoever produced it. The handshake cannot be
*completed* that way and does not need to be — the reply is what is being read. That is how the
greased fixed bit above was found, and it needs a certificate, which is why it is the one test here
that reaches into `packages/tls/test/data`.

Real packets can be minted rather than transcribed: pointing Deno's QUIC client at a plain UDP socket
hands over a genuine v1 Initial, 1200 bytes with a 20-byte connection id. So the early steps need no
RFC text in the container and no network.

## What it stands on

`packages/platform`'s datagram capability — `bindDatagram`, `receiveFrom`, `sendTo` — which was
step 1 of the design note and is built on every host that can honour it. `packages/tls` supplies the
handshake messages and the key schedule; QUIC replaces its record layer and uses the rest.
