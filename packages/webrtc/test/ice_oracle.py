#!/usr/bin/env python3
# aioice's STUN parser and candidate reader, as an oracle for `src/ice.wac`.
#
# **This is the reference, not the test.** aioice is the ICE implementation inside aiortc; the
# interesting half is that `parse_message` takes an integrity key and *raises* when it disagrees, so
# a check it accepts is one it authenticated with its own code against the password we published.
# Reading our bytes back with our own reader would agree with itself whatever either did.
#
# The live agent — a whole `aioice.Connection` that gathers, checks and connects — is
# `ice_agent.py`. This file is only for the questions that are about bytes.
#
# ## One process, not one per case
#
# The host-side version spawned `python3 -c` five times. Through `Cli.exec` a call costs a process,
# so this reads every question at once and answers `FAIL …` per disagreement, `DONE <n>` last — the
# protocol in `packages/wactest/src/oracle.wac`.
#
#   check     <msg-hex> <key> <username> <priority> <tiebreak-attr> <tiebreak> <nominated>
#                                    — judges a connectivity check, field for field
#   refused   <msg-hex> <key>        — FAIL if aioice accepts it under that key
#   candidate <sdp-hex> <foundation> <component> <transport> <priority> <host> <port> <type>
#                                    — judges aioice's reading against what the caller says it means
#
# `tiebreak-attr` is `ICE-CONTROLLING` or `ICE-CONTROLLED`; `nominated` is `yes` or `no`. The
# tiebreaker crosses as an unsigned decimal because that is how aioice reports it, and the wac side
# holds it in an `i64` where the same bits may read negative.

import binascii
import sys

from aioice import Candidate
from aioice.stun import parse_message

out = []


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
        if op == "check":
            msg_hex, key, username, priority, attr, tiebreak, nominated = parts[1:8]
            m = parse_message(binascii.unhexlify(msg_hex), integrity_key=key.encode())
            eq("message method", m.message_method.value, 1)
            eq("message class", m.message_class.value, 0)
            # The peer's fragment first — a check names the receiver, not the sender.
            eq("USERNAME", m.attributes["USERNAME"], username)
            eq("PRIORITY", str(m.attributes["PRIORITY"]), priority)
            eq(attr, str(m.attributes[attr]), tiebreak)
            eq("USE-CANDIDATE", "yes" if "USE-CANDIDATE" in m.attributes else "no", nominated)
            # A check with no FINGERPRINT is one a real agent may drop, and it is the
            # attribute an encoder forgets last.
            if "FINGERPRINT" not in m.attributes:
                say("the check carries no FINGERPRINT")

        elif op == "refused":
            try:
                parse_message(binascii.unhexlify(parts[1]), integrity_key=parts[2].encode())
                say("aioice accepted a check signed with the wrong password, so acceptance elsewhere "
                    "proves nothing")
            except Exception:
                pass

        elif op == "candidate":
            # **The expected fields come from the caller, not from the line.** Deriving them by
            # rewriting the input — `sdp.replace(" typ ", " ")` — is a comparison that cannot
            # disagree, and it did not: a candidate with every field wrong passed it. So the wac side
            # states what the line is supposed to mean and aioice's reading is put against that.
            sdp_hex, foundation, component, transport, priority, host, port, kind = parts[1:9]
            sdp = binascii.unhexlify(sdp_hex).decode()
            c = Candidate.from_sdp(sdp)
            eq("candidate foundation", c.foundation, foundation)
            eq("candidate component", str(c.component), component)
            eq("candidate transport", c.transport, transport)
            eq("candidate priority", str(c.priority), priority)
            eq("candidate host", c.host, host)
            eq("candidate port", str(c.port), port)
            eq("candidate type", c.type, kind)
            eq("the candidate printed back", c.to_sdp(), sdp)

        else:
            say("unknown op %r" % op)
    except Exception as e:
        say("%s: %s" % (op, str(e).replace("\n", " ")[:200]))

for l in out:
    print(l)
print("DONE %d" % len(lines))
