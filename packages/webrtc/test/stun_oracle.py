#!/usr/bin/env python3
# aioice's STUN codec, as an oracle for `src/stun.wac`.
#
# **This is the reference, not the test.** aioice is the STUN implementation inside aiortc — what the
# later steps of `design/system/0008` are measured against — and it exposes its codec directly, which
# is why it can adjudicate the two attributes coturn never sends us: MESSAGE-INTEGRITY under a
# password we choose, and FINGERPRINT.
#
# A round trip is not an oracle here: our encoder and our decoder agree perfectly when both are
# wrong. So every claim either goes to a real server on the wire (coturn, which the wac side dials
# itself) or comes here.
#
# ## Both directions, and the second is the one that catches things
#
# `parse` hands aioice our bytes. `build` and `sign` make aioice produce bytes for us to read, which
# is the direction a self-consistent encoder cannot fake. `sign` matters most: `add_message_integrity`
# appends a FINGERPRINT *after* the MESSAGE-INTEGRITY, so a verifier that hashed to the end of the
# message rather than to the attribute would disagree — the rule this package's header calls the part
# everyone gets wrong.
#
# ## One process, not one per case
#
# The host-side version spawned `python3 -c` six times. Through `Cli.exec` a call costs a process, so
# this reads every question at once. Ops that **produce** print their answers *ahead* of the `FAIL`
# lines, because a caller reads them by position and a disagreement elsewhere would shift them.
#
#   parse       <msg-hex> <method> <class> <tid-hex> <software>   — judges; `-` for no SOFTWARE
#   verify      <msg-hex> <key-hex> <software>                    — judges, with integrity_key set
#   fingerprint <msg-hex>                                         — judges; aioice validates it
#   build       <tid-hex>                       →  `built <hex>`  a response with XOR-MAPPED-ADDRESS
#   sign        <tid-hex> <key-hex>             →  `built <hex>`  a request with integrity
#
# `FAIL …` per disagreement, `DONE <n>` last. See `packages/wactest/src/oracle.wac`.

import binascii
import sys

from aioice import stun

out = []
emit = []


def say(s):
    if len(out) < 20:
        out.append("FAIL " + s)


def eq(what, got, want):
    if got != want:
        say("%s: aioice says %r, we said %r" % (what, got, want))


lines = [l for l in sys.stdin.read().split("\n") if l]

for line in lines:
    parts = line.split(" ")
    op = parts[0]
    try:
        if op == "parse":
            m = stun.parse_message(binascii.unhexlify(parts[1]))
            eq("message method", int(m.message_method), int(parts[2]))
            eq("message class", int(m.message_class), int(parts[3]))
            eq("transaction id", binascii.hexlify(m.transaction_id).decode(), parts[4])
            want = parts[5] if len(parts) > 5 else "-"
            got = m.attributes.get("SOFTWARE")
            eq("SOFTWARE", "-" if got is None else got, want)

        elif op == "verify":
            # `integrity_key` makes aioice recompute the HMAC over the message with the header
            # length set as though MESSAGE-INTEGRITY were present, and raise if it disagrees.
            key = binascii.unhexlify(parts[2])
            m = stun.parse_message(binascii.unhexlify(parts[1]), integrity_key=key)
            want = parts[3] if len(parts) > 3 else "-"
            got = m.attributes.get("SOFTWARE")
            eq("SOFTWARE on the verified message", "-" if got is None else got, want)

        elif op == "fingerprint":
            # aioice validates FINGERPRINT while parsing, so a message it accepts is one whose CRC
            # it agrees with, and one it rejects raises into the handler below.
            m = stun.parse_message(binascii.unhexlify(parts[1]))
            if "FINGERPRINT" not in m.attributes:
                say("aioice does not see a FINGERPRINT on a message we fingerprinted")

        elif op == "build":
            m = stun.Message(message_method=stun.Method.BINDING,
                             message_class=stun.Class.RESPONSE,
                             transaction_id=binascii.unhexlify(parts[1]))
            m.attributes["XOR-MAPPED-ADDRESS"] = ("192.0.2.17", 32853)
            m.attributes["SOFTWARE"] = "aioice"
            emit.append("built " + binascii.hexlify(bytes(m)).decode())

        elif op == "sign":
            m = stun.Message(message_method=stun.Method.BINDING,
                             message_class=stun.Class.REQUEST,
                             transaction_id=binascii.unhexlify(parts[1]),
                             attributes={"USERNAME": "alice:bob"})
            m.add_message_integrity(binascii.unhexlify(parts[2]))
            emit.append("built " + binascii.hexlify(bytes(m)).decode())

        else:
            say("unknown op %r" % op)
    except Exception as e:
        say("%s: %s" % (op, str(e).replace("\n", " ")[:200]))

for l in emit:
    print(l)
for l in out:
    print(l)
print("DONE %d" % len(lines))
