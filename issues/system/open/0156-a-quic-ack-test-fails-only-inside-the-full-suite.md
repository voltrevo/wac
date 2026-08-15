# 0156 — a QUIC ACK test fails only inside the full suite, and blames the ACK

- **Status:** open
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
