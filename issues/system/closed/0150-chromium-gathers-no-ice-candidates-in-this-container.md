# 0150 — Chromium gathers no ICE candidates in this container

- **Status:** closed — the cause was a permission, not the container. 2026-08-14
- **Reported by:** agent-b
- **Date:** 2026-08-14
- **Kind:** bug
- **Symptom:** not implemented (an oracle that could not be reached)

## What it said

That Chromium 151 here gathers **zero** ICE candidates — gathering reaches `complete` and produces
none, with `--allow-loopback-in-peer-connection`, with `--force-webrtc-ip-handling-policy=default`,
and with mDNS masking disabled, on a machine whose `eth0` has an ordinary `192.168.80.2` that aiortc
enumerates without being asked twice. The conclusion drawn was that ICE, DTLS and a data channel
against a browser were untestable here, and `packages/webrtc` said so in three places.

## What it actually was

**Chromium hides every local network interface from a page that has not been granted media
permission.** Its own logging says so in one line, which is what settled it:

```
FilteringNetworkManager received permission status: denied
```

A page that calls `getUserMedia` successfully flips that to granted and the interfaces appear. With
`--use-fake-device-for-media-stream` to supply a microphone and `--use-fake-ui-for-media-stream` to
answer the prompt nobody is there to click:

```
candidate:3486042790 1 udp 2122260223 192.168.80.2 40375 typ host …
candidate:2970036286 1 tcp 1518280447 192.168.80.2 9 typ host tcptype active …
```

So the container was never the problem, and none of the three flags tried was relevant. **The
diagnosis cost an afternoon and the fix was one `getUserMedia`** — the lesson being that
`--enable-logging --vmodule=*webrtc*=2` was on the "not tried" list of this very issue, and is what
answered it in under a minute.

## What it unblocked

`packages/webrtc/test/browser.test.ts` now runs a real interop: Chromium accepts our SDP answer,
sends connectivity checks that `ice.wac` validates and answers, **its ICE reaches `connected`**, and
it goes on to send DTLS records that `dtls.wac` parses as a ClientHello. So a browser completes ICE
against a wac peer, and libwebrtc's own first handshake message is read by our code.

The boundary is now DTLS, not the environment — we have a client and no server role — and the test
asserts that boundary so it cannot drift silently.
