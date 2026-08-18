#!/usr/bin/env python3
# aiortc's SCTP parser and google-crc32c, as one oracle for `src/sctp.wac`.
#
# **These are the reference, not the test.** aiortc's `rtcsctptransport` is a full SCTP
# implementation written by somebody who never saw this code, and `google_crc32c` is the C library
# aiortc itself depends on. Our own encoder and our own decoder agree perfectly when both are wrong,
# so every claim about the wire is put to one of these.
#
# What each can see is different, and both are needed:
#
#   - **`google_crc32c`** gives a checksum a *value*, which has a right answer that does not depend
#     on anyone's parser. The published vector `crc32c("123456789") = 0xE3069283` is the same one
#     every implementation is checked against.
#   - **`parse_packet`** verifies the checksum before it will look at a chunk and raises when it
#     disagrees — so a packet it parses is one whose CRC it recomputed independently, over the same
#     bytes, with the field zeroed the same way. That is more than the vector proves, because the
#     vector says nothing about *where* the checksum goes, what it covers, or that it is written
#     little-endian while every other field in SCTP is network order.
#
# ## One process, not one per case
#
# The host-side version spawned `python3 -c` twelve times, once per question. Through `Cli.exec` a
# call costs a process, so this reads every question at once and answers `FAIL …` per disagreement
# with `DONE <n>` last — the protocol in `packages/wactest/src/oracle.wac`.
#
# Every numeric field crosses as **hex**, because a verification tag is unsigned 32-bit and the wac
# side holds it in an `i32`: `0xDEADBEEF` is negative there and positive here, and a decimal
# comparison would fail on a value both sides agree about. Hex has no sign to disagree over.
#
#   crc32c    <data-hex> <ours-hex>
#   refused   <packet-hex>                          — FAIL if aiortc accepts it
#   initchunk <packet-hex> <src> <dst> <tag-hex> <initiate-hex> <rwnd> <out> <in> <tsn-hex>
#   cookie    <packet-hex> <cookie-hex>
#   datachunk <packet-hex> <tsn-hex> <sid> <sseq> <ppid> <flags> <payload-hex>
#   sackchunk <packet-hex> <cum-hex> <rwnd> <gaps> <dups>
#   dcep      <packet-hex> <ppid> <msgtype> <chantype> <label>
#   sackbody  <body-hex> <cum-hex> <rwnd> <dups> <gaps>      gaps as `2-4,6-6` or `-` for none
#   chunkkind <packet-hex> <TypeName> [<cumulative-hex>]

import binascii
import sys

import google_crc32c
from aiortc.rtcsctptransport import SackChunk, parse_packet

out = []


def say(s):
    if len(out) < 20:
        out.append("FAIL " + s)


def u32(text):
    """A hex field as the unsigned integer aiortc reports."""
    return int(text, 16) & 0xFFFFFFFF


def one_chunk(packet_hex):
    """`(source, dest, tag, chunk)` for a packet with exactly one chunk."""
    src, dst, tag, chunks = parse_packet(binascii.unhexlify(packet_hex))
    if len(chunks) != 1:
        raise ValueError("expected one chunk, got %d" % len(chunks))
    return src, dst, tag, chunks[0]


def eq(what, got, want):
    if got != want:
        say("%s: aiortc says %r, we said %r" % (what, got, want))
        return False
    return True


lines = [l for l in sys.stdin.read().split("\n") if l]

for line in lines:
    parts = line.split(" ")
    op = parts[0]
    try:
        if op == "crc32c":
            data_hex, ours_hex = parts[1], parts[2]
            theirs = google_crc32c.value(binascii.unhexlify(data_hex))
            eq("crc32c(%s)" % (data_hex or "empty"), theirs, u32(ours_hex))

        elif op == "refused":
            try:
                parse_packet(binascii.unhexlify(parts[1]))
                say("aiortc accepted a packet we corrupted, so parsing proves nothing")
            except Exception:
                pass

        elif op == "initchunk":
            src, dst, tag, c = one_chunk(parts[1])
            eq("INIT source port", src, int(parts[2]))
            eq("INIT dest port", dst, int(parts[3]))
            eq("INIT verification tag", tag, u32(parts[4]))
            eq("INIT chunk type", type(c).__name__, "InitChunk")
            eq("INIT initiate tag", c.initiate_tag, u32(parts[5]))
            eq("INIT advertised rwnd", c.advertised_rwnd, int(parts[6]))
            eq("INIT outbound streams", c.outbound_streams, int(parts[7]))
            eq("INIT inbound streams", c.inbound_streams, int(parts[8]))
            eq("INIT initial TSN", c.initial_tsn, u32(parts[9]))

        elif op == "cookie":
            _, _, _, c = one_chunk(parts[1])
            eq("COOKIE-ECHO chunk type", type(c).__name__, "CookieEchoChunk")
            # The padding is in the packet and not in the chunk's length — the same rule STUN has
            # and the same place to get it wrong, so a cookie that came back longer would say so.
            eq("the cookie, padding excluded", binascii.hexlify(c.body).decode(), parts[2])

        elif op == "datachunk":
            _, _, _, c = one_chunk(parts[1])
            eq("DATA chunk type", type(c).__name__, "DataChunk")
            eq("DATA tsn", c.tsn, u32(parts[2]))
            eq("DATA stream id", c.stream_id, int(parts[3]))
            eq("DATA stream seq", c.stream_seq, int(parts[4]))
            eq("DATA ppid", c.protocol, int(parts[5]))
            # **Both flags, which is the ordinary case and the one that is forgotten.** A chunk with
            # neither B nor E is a middle fragment of a message that never ends, and a receiver
            # holds it forever.
            eq("DATA flags", c.flags, int(parts[6]))
            eq("DATA payload", binascii.hexlify(c.user_data).decode(), parts[7])

        elif op == "sackchunk":
            _, _, _, c = one_chunk(parts[1])
            eq("SACK chunk type", type(c).__name__, "SackChunk")
            eq("SACK cumulative tsn", c.cumulative_tsn, u32(parts[2]))
            eq("SACK advertised rwnd", c.advertised_rwnd, int(parts[3]))
            eq("SACK gap count", len(c.gaps), int(parts[4]))
            eq("SACK duplicate count", len(c.duplicates), int(parts[5]))

        elif op == "dcep":
            import struct
            _, _, _, c = one_chunk(parts[1])
            eq("DCEP ppid", c.protocol, int(parts[2]))
            d = c.user_data
            msg_type, chan_type, _prio, _rel, label_len, _proto_len = struct.unpack_from("!BBHLHH", d)
            eq("DCEP message type", msg_type, int(parts[3]))
            eq("DCEP channel type", chan_type, int(parts[4]))
            label = d[12:12 + label_len].decode()
            eq("DCEP label", label, parts[5] if len(parts) > 5 else "")

        elif op == "sackbody":
            # `SackChunk(body=…)` rather than a whole packet: this is aiortc unpacking the value
            # with `!LLHH` and then `!HH` per gap, which disagrees the moment a field moves.
            c = SackChunk(body=binascii.unhexlify(parts[1]))
            eq("SACK body cumulative tsn", c.cumulative_tsn, u32(parts[2]))
            eq("SACK body advertised rwnd", c.advertised_rwnd, int(parts[3]))
            # The duplicate count must be right or the gaps would be read four bytes further on.
            eq("SACK body duplicate count", len(c.duplicates), int(parts[4]))
            want = parts[5] if len(parts) > 5 else "-"
            got = "-" if not c.gaps else ",".join("%d-%d" % (a, b) for a, b in c.gaps)
            eq("SACK body gap blocks", got, want)

        elif op == "chunkkind":
            _, _, _, c = one_chunk(parts[1])
            eq("chunk type", type(c).__name__, parts[2])
            if len(parts) > 3:
                eq("%s cumulative tsn" % parts[2], c.cumulative_tsn, u32(parts[3]))

        else:
            say("unknown op %r" % op)
    except Exception as e:
        say("%s: %s" % (op, str(e).replace("\n", " ")[:200]))

for l in out:
    print(l)
# `DONE <n>` counts the lines that came in, so a caller can tell a short read from agreement —
# `ask` checks it against what it sent.
print("DONE %d" % len(lines))
