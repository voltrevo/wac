#!/usr/bin/env python3
# aiortc's SDP parser, and the SDP a real `RTCPeerConnection` produces, as an oracle for
# `src/sdp.wac`.
#
# **This is the reference, not the test.** Two directions, and both matter for different reasons:
#
#   - **aiortc parses our offer** and gets the ICE credentials, the fingerprint and the SCTP
#     capability out of it. An offer a peer cannot parse is where a data channel fails before any
#     packet is sent, and it fails as "invalid SDP" with no hint about which line.
#   - **it generates one**, from a full `RTCPeerConnection` with a real data channel on it — so the
#     description carries the lines a browser sends rather than the lines we thought of.
#
# The second is the one that finds omissions. Our own offer only contains what we knew to write.
#
#   parse <sdp-hex> <kind> <profile> <ufrag> <pwd> <alg> <fingerprint> <role> <maxmsg> <sctpport>
#         <candidates>                                            — judges every field aiortc read
#   answer <sdp-hex> <kind> <profile> <role> <alg> <fp-length> <candidates> <sctp-port>
#                                    — judges the description `example/answer.wac` printed
#   generate                                       →  `sdp <hex>` an offer from a real connection
#
# `FAIL …` per disagreement, `DONE <n>` last; the producing op prints ahead of the failures, because
# a caller reads it by position. See `packages/wactest/src/oracle.wac`.
#
# The SDP crosses as hex because it is multi-line and the protocol here is line-oriented.

import binascii
import sys

out = []
emit = []


def say(s):
    if len(out) < 20:
        out.append("FAIL " + s)


def eq(what, got, want):
    if got != want:
        say("%s: aiortc says %r, we said %r" % (what, got, want))


lines = [l for l in sys.stdin.read().split("\n") if l]

for line in lines:
    parts = line.split(" ")
    op = parts[0]
    try:
        if op == "parse":
            from aiortc.sdp import SessionDescription
            sdp = binascii.unhexlify(parts[1]).decode()
            d = SessionDescription.parse(sdp)
            m = d.media[0]
            eq("media kind", m.kind, parts[2])
            eq("media profile", m.profile, parts[3])
            eq("ice-ufrag", m.ice.usernameFragment, parts[4])
            eq("ice-pwd", m.ice.password, parts[5])
            eq("fingerprint algorithm", m.dtls.fingerprints[0].algorithm, parts[6])
            eq("fingerprint", m.dtls.fingerprints[0].value, parts[7])
            eq("dtls role", m.dtls.role, parts[8])
            eq("sctp max message size", str(m.sctpCapabilities.maxMessageSize), parts[9])
            eq("sctp port", str(m.sctp_port), parts[10])
            eq("candidate count", str(len(m.ice_candidates)), parts[11])

        elif op == "answer":
            # The description `example/answer.wac` printed, judged by aiortc. Distinct from `parse`
            # because the interesting fields differ: the credentials are the program's own and this
            # side does not know them, so what is checked is the *shape* — a data channel section,
            # DTLS `server` because it answered `passive`, and a sha-256 fingerprint of a
            # certificate it generated itself.
            from aiortc.sdp import SessionDescription
            sdp = binascii.unhexlify(parts[1]).decode()
            d = SessionDescription.parse(sdp)
            m = d.media[0]
            eq("media kind", m.kind, parts[2])
            eq("media profile", m.profile, parts[3])
            eq("dtls role", m.dtls.role, parts[4])
            eq("fingerprint algorithm", m.dtls.fingerprints[0].algorithm, parts[5])
            eq("fingerprint length", str(len(m.dtls.fingerprints[0].value)), parts[6])
            eq("candidate count", str(len(m.ice_candidates)), parts[7])
            eq("sctp port", str(m.sctp_port), parts[8])

        elif op == "generate":
            import asyncio
            from aiortc import RTCPeerConnection

            async def main():
                pc = RTCPeerConnection()
                pc.createDataChannel("chat")
                offer = await pc.createOffer()
                await pc.setLocalDescription(offer)
                sdp = pc.localDescription.sdp
                await pc.close()
                return sdp

            emit.append("sdp " + binascii.hexlify(asyncio.run(main()).encode()).decode())

        else:
            say("unknown op %r" % op)
    except Exception as e:
        say("%s: %s" % (op, str(e).replace("\n", " ")[:200]))

for l in emit:
    print(l)
for l in out:
    print(l)
print("DONE %d" % len(lines))
