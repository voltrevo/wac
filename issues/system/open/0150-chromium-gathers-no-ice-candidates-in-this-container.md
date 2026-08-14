# 0150 — Chromium gathers no ICE candidates in this container, so browser interop stops at SDP

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-14
- **Kind:** bug
- **Symptom:** not implemented (an oracle that cannot be reached, rather than code that is wrong)

## What

`packages/webrtc` is measured against aiortc, coturn and OpenSSL. The implementation that matters
most is **libwebrtc** — every other WebRTC stack was written to talk to it — and Chromium 151 is
installed here and its `RTCPeerConnection` works: it builds a data channel, produces an offer, and
its SDP is read by `src/sdp.wac` in `test/browser.test.ts`.

What it will not do is **gather an ICE candidate**. Gathering reaches `complete` and yields none:

```
["--no-sandbox"]                                              -> 0 candidates
+ --allow-loopback-in-peer-connection                          -> 0 candidates
+ --force-webrtc-ip-handling-policy=default                    -> 0 candidates
+ --disable-features=WebRtcHideLocalIpsWithMdns                -> 0 candidates
```

on a machine with an ordinary interface:

```
1: lo    inet 127.0.0.1/8
2: eth0  inet 192.168.80.2/20
```

aiortc, on the same machine in the same container, gathers `192.168.80.2` without being asked twice —
so it is not the network, it is Chromium's own enumeration.

## Why it matters

A peer with no candidate cannot send a connectivity check, so **ICE, DTLS and a data channel against
a browser are untestable here**. Every layer above SDP is adjudicated by aiortc and OpenSSL instead,
which is a real oracle and not the same one: aiortc is more forgiving than libwebrtc about several
things, and an SDP or a check a browser would reject is exactly what this cannot find.

That is worth a number rather than a paragraph in a README, because the gap is invisible from the
inside: `packages/webrtc` is green, and green means "aiortc agreed", not "a browser would".

## What has been tried

The four flag combinations above, `page.setContent` rather than `about:blank` (a secure-context
question), and waiting four seconds after `setLocalDescription`. Not tried: a different Chromium
build, `--enable-logging --v=1` to see what the network manager decides, running headful under Xvfb,
or Firefox — which has an independent implementation and might enumerate differently.

## Not claimed

Filed because it bounds what `packages/webrtc` can claim, and because the next person to reach for a
browser should find this rather than repeat the afternoon.

`test/browser.test.ts` **asserts the zero**, so if Chromium starts gathering the test fails and says
to come back here. A limitation nothing checks is one that outlives its truth.
