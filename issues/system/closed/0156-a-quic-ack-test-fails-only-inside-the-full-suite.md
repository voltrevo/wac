# 0156 — a QUIC ACK test fails only inside the full suite, and blames the ACK

- **Status:** closed
- **Claimed by:** agent-c
- **Closed:** 2026-08-15
- **Fixed in:** the commit closing this
- **Reported by:** agent-c
- **Date:** 2026-08-15
- **Kind:** bug
- **Symptom:** wrong answer, under load only

`packages/quic/test/stream.test.ts:301`, *"an acknowledgement the server accepts, proven by the
connection outliving it"*, failed a gate run on 2026-08-15:

```
error: the connection did not outlive the acknowledgement: heard "", wanted "first,second".
  The server closed with transport error 0xa. 0xa is PROTOCOL_VIOLATION, which an over-generous
  or malformed ACK provokes — so this is the ACK rather than the streams, and the test above
  shows a stream arriving on its own.
```

Run on its own it passes, three times for three, in **235 ms** each. It has only ever failed as
part of `deno task test`, where the parallel pass is four workers on a machine three agents share.

## Why this is worth a number rather than a retry

**The diagnostic is confident and points the wrong way.** It reads the 0xa as evidence about the
ACK — reasonably, since `PROTOCOL_VIOLATION` is what a bad ACK earns — and says so in a sentence
written to save the next reader time. If the real cause is a scheduling delay, that sentence sends
somebody to re-read the ACK encoder, which is where an hour goes. A test that cannot fail under
load without accusing the code is worse than one that simply fails.

So the question is not "is the ACK wrong" but **which of the two it is**, and the test as written
cannot say. That is the same shape as `0128` (a native differential whose timeout read as a
disagreement) and `0155` (a fuzz seed that replays inputs but not the schedule); this is the third,
and the three together are an argument about how these tests report, not three separate flakes.

## Notes

The suspicion is a timer: an ACK is only *over-generous* relative to what has actually been sent,
so a delayed write and a correct ACK produce the same bytes on the wire in the wrong order. That is
a guess and is exactly what the issue is asking somebody to distinguish, rather than something to
patch by widening a deadline.

What would settle it: have the case record what it sent and when, and report the 0xa alongside that
timeline, so a failure says "the ACK covered a packet number this side had not written yet, N ms
after the previous write" — or does not, in which case the ACK really is wrong and the current
sentence was right all along.

Not reproduced deliberately yet. `WAC_HEAVY=1 deno task test` on a loaded machine is the nearest
thing to the conditions, since the heavy lane no longer runs in the parallel pass.

## Closed: the ACK really was over-generous, and the diagnostic was right (2026-08-15)

**I filed this suspecting the diagnostic pointed the wrong way. It did not.** The sentence it prints
— *"0xa is PROTOCOL_VIOLATION, which an over-generous or malformed ACK provokes — so this is the ACK
rather than the streams"* — was correct in every particular, and the note above guessing at "a
delayed write and a correct ACK" was wrong. The lesson is the opposite of the one I wrote down: the
message named its cause, and I doubted it because the failure was load-dependent.

`Cli.ackPacket` built its frame with the **First ACK Range equal to Largest Acknowledged**, which
acknowledges every packet from 0 through `largest`. Its own documentation said what that costs:

> a caller must pass a `largest` it has actually seen every packet up to.

The caller could not honour that. The loop above it **stops at the first 1-RTT packet it sees** —
deliberately, because draining until the deadline was itself a failure mode — and then passed that
packet's number as `largest`. Whenever the first 1-RTT packet to arrive was *not* number 0, the ACK
claimed packets that had never been received, and QUIC answers that with PROTOCOL_VIOLATION and a
closed connection. `heard` came back `""` rather than `"first"` because the connection was torn down
before the server surfaced stream 0 — which is also why this reads as "the streams broke".

On a quiet machine the first 1-RTT packet is number 0 and the range `0..0` is honest, so it passed.
Under load a packet is lost or the socket does not deliver it in time, the first one *seen* has a
number above zero, and the same code lies. That is the whole of the load dependence: not a timer, a
false premise. The test's own comment asserted the premise out loud — *"and we saw them all, since
this reads every datagram the socket delivered"* — and both halves of it were wrong.

**The fix** is a `firstRange` parameter on `ackPacket`, so a caller states how much it actually saw.
The test passes 0: this packet and nothing below it, which is always honest for a packet in your
hand. The negative case beside it keeps `firstRange` equal to `largest`, because claiming the whole
range is exactly what it is provoking.

**The fix needed a test of its own, and finding that out took putting the bug back.** With
`firstRange` ignored, all six cases in the file still passed — because on a quiet machine `largest`
is 0 and the two spellings are the same packet. So there is now a check that builds an ACK for
`largest = 5` both ways and asserts the bytes differ; it never goes on the wire, so it does not
depend on what the server sent. It fails with the parameter ignored.
