#!/usr/bin/env python3
# A real `aioice.Connection`, controlling, on the other end of a UDP socket.
#
# **This is the test that matters in `ice_test.wac`.** The arithmetic can be checked against RFC
# 8445's formulae by hand, and two cases do exactly that — but only a peer that *finishes* ICE with
# us says our checks and responses are acceptable rather than merely well-formed. aioice sends
# connectivity checks, the wac side validates and answers them, and `connect()` either completes or
# does not.
#
# ## What the peer is told, and what it must not be
#
# ICE credentials are exchanged out of band — in SDP, in a real deployment — so the test plays the
# signalling channel: it takes this agent's ufrag, password and candidate, and hands back its own.
# Nothing else crosses. In particular nothing here is ever told what to expect, so a response this
# agent accepts is one it validated with its own code against its own password.
#
# ## Why files rather than a pipe
#
# The host-side version held this process's stdin open and wrote to it after reading its first line.
# `Cli.spawn` takes a wac worker bundle, so wac cannot do that to a Python program, and `Cli.exec`
# runs a child to completion — which is no use for something that has to still be running while the
# test answers its checks.
#
# So the signalling is three files in a directory this is given:
#
#   theirs.json   written here once gathering is done: `{ufrag, pwd, candidates}`
#   ours.json     the test writes it: `{ufrag, pwd, candidates}` — polled for here
#   result.json   written here at the end: `{connected, selected}`, or `{error}`
#
# Each is written to a temporary name and renamed, so a reader never sees half a file — a poll that
# can observe a partial write is a race the test would hit about one run in twenty.

import asyncio
import json
import os
import sys

from aioice import Candidate, Connection

DIR = sys.argv[1]
GATHER_TIMEOUT = 20
CONNECT_TIMEOUT = 25


def publish(name, obj):
    """Write atomically: a partial file a poller could read is a race, not a rare one."""
    tmp = os.path.join(DIR, name + ".tmp")
    with open(tmp, "w") as f:
        f.write(json.dumps(obj))
    os.replace(tmp, os.path.join(DIR, name))


async def await_file(name, timeout):
    path = os.path.join(DIR, name)
    for _ in range(int(timeout * 20)):
        if os.path.exists(path):
            with open(path) as f:
                return json.load(f)
        await asyncio.sleep(0.05)
    raise TimeoutError("no %s after %ss" % (name, timeout))


async def main():
    conn = Connection(ice_controlling=True)
    await asyncio.wait_for(conn.gather_candidates(), GATHER_TIMEOUT)
    publish("theirs.json", {
        "ufrag": conn.local_username,
        "pwd": conn.local_password,
        "candidates": [c.to_sdp() for c in conn.local_candidates],
    })

    peer = await await_file("ours.json", 30)
    conn.remote_username = peer["ufrag"]
    conn.remote_password = peer["pwd"]
    for c in peer["candidates"]:
        await conn.add_remote_candidate(Candidate.from_sdp(c))
    await conn.add_remote_candidate(None)

    await asyncio.wait_for(conn.connect(), CONNECT_TIMEOUT)
    sel = conn.get_default_candidate(1)
    publish("result.json", {"connected": True, "selected": sel.to_sdp() if sel else None})
    await conn.close()


try:
    asyncio.run(main())
except Exception as e:
    # The failure goes in the file too. A test polling for `result.json` against an agent that died
    # would otherwise wait out its whole bound and then report a timeout, which says nothing about
    # why — and the reason is usually one line of Python.
    publish("result.json", {"connected": False, "error": "%s: %s" % (type(e).__name__, e)})
    raise
