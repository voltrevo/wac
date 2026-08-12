# quic

QUIC version 1 — RFC 9000 and RFC 9001 — in wac. **Started 2026-08-12; nothing here speaks to a
peer yet.**

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

## What does not exist yet

Packet headers, connection ids, packet protection, frames, streams, loss detection — all of it. The
order they arrive in, and what each one's oracle is, is in the design note rather than repeated here.

## The oracle

**Deno's QUIC**, which is quinn and rustls underneath and is already installed: it both listens and
connects, so our client can be adjudicated by their server and their client by our server. Measured
offline in this container on 2026-08-12 before any of this was written — a loopback handshake with
ALPN and a bidirectional stream.

Real packets can be minted rather than transcribed: pointing Deno's QUIC client at a plain UDP socket
hands over a genuine v1 Initial, 1200 bytes with a 20-byte connection id. So the early steps need no
RFC text in the container and no network.

## What it stands on

`packages/platform`'s datagram capability — `bindDatagram`, `receiveFrom`, `sendTo` — which was
step 1 of the design note and is built on every host that can honour it. `packages/tls` supplies the
handshake messages and the key schedule; QUIC replaces its record layer and uses the rest.
