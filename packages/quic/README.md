# quic

QUIC version 1 — RFC 9000 and RFC 9001 — in wac. **Both sides agree on the Handshake secrets**: we
author a first flight, quinn answers, and its Handshake packet opens under keys derived here through
TLS's key schedule. design/system 0007 step 4, as of 2026-08-13.

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
version-1 peer sends a zero; `test/greased.test.ts` is that comment being wrong.

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

**A first flight of our own** — `test/wac/hello_probe.wac` puts `packages/tls`'s `clientHello`,
these parameters and an x25519 share **we hold the private half of** into a sealed Initial. quinn
answers it with an ACK and a ServerHello, so every byte on the wire is ours and the shared secret is
computable, which the borrowed version could never be. Canaried by removing the transport parameters
(all three tests fail) and by removing the ALPN (two do).

**`src/keys.wac`** — where QUIC stops deriving its own secrets and starts using TLS's. Initial keys
come from a connection id anyone on the path can read, so they authenticate a version and nothing
else; Handshake keys come out of the TLS key schedule, so they depend on a Diffie-Hellman exchange
and on every handshake byte both sides have seen.

The join between the two specifications is one sentence — take TLS's traffic secret and expand it
with `quic key`, `quic iv` and `quic hp` instead of TLS's own `key` and `iv` — and this file is that
sentence. Everything above it is `packages/tls`'s and everything below is protection `initial.wac`
already did, which is why `openAt` takes keys rather than deriving them.

**The check is that quinn's Handshake packet opens.** Those keys depend on the shared secret *and*
the transcript, so a wrong x25519, a transcript hashed over the wrong bytes, the client's traffic
secret where the server's belongs, or TLS's label instead of QUIC's each produce keys that are
well-formed and that quinn does not share — and the packet decrypts to nothing. Each of those four
was applied on purpose and each failed exactly the one test that makes the claim.

`packet.wac` gained `nextPacketAt` for this: a server's first flight coalesces an Initial and a
Handshake into one datagram (RFC 9000 §12.2), and a reader that stops at one packet per datagram
never sees the handshake at all.

## What does not exist yet

Answering. Nothing yet sends a Finished, so no connection completes and no 1-RTT keys exist. Then
streams and loss detection. The order they arrive in, and what each one's
oracle is, is in the design note rather than repeated here.

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
