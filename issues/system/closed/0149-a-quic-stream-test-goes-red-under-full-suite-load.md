# 0149 — a quic stream test goes red under full-suite load, and passes alone

- **Status:** closed
- **Fixed in:** this commit
- **Reported by:** agent-b
- **Date:** 2026-08-14
- **Kind:** bug
- **Symptom:** wrong answer (a red gate for something that works)

## What

`packages/quic/test/stream.test.ts` — "an acknowledgement the server accepts, proven by the
connection outliving it" — failed once in a full-suite run:

```
assertEquals failed — the connection did not outlive the acknowledgement.
  got:  ""
  want: "first,second"
```

The same test then passed three times out of three run alone, and the whole `packages/quic` suite
passed (85 tests) minutes before and after. The run that failed was 3,306 passed, 1 failed, on a
machine where three agents share five cores; two other agents' suite runs had been refused by
`tools/suiteGate.ts` for contention in the preceding hour.

Nothing in that tree touched the send or acknowledgement path: the day's changes to `packages/quic`
were additive methods on `Client` and a new `Connection.checked`, none of which this test calls.

## Why it is the same shape as 0106 and 0128

`got: ""` is *nothing came back*, not *the wrong bytes came back*. The test opens a second stream to
prove the connection survived the ACK, and reads what the server echoes with a deadline. A server
that never got scheduled and a server that closed the connection on a malformed ACK produce the same
empty string, so **the assertion cannot tell a busy machine from a protocol violation** — which is
exactly what 0106 says about the onion-service test's 30s timeout and 0128 about the native
differential.

That matters more here than the flake does: the test's own docstring explains that a malformed ACK is
a `PROTOCOL_VIOLATION` and that the second stream is what proves the frame was accepted. If the
deadline can fire for an unrelated reason, a real regression in `writeAck` would look like this too,
and the habit of re-running would hide it.

## What would fix it rather than mute it

Not a longer deadline. The distinction wanted is between *the peer answered something else* and *the
peer did not answer*, and QUIC can say which: a connection closed for a protocol violation sends a
CONNECTION_CLOSE frame with an error code, and `frame.wac` already parses frames. Reading that and
reporting it — "the server closed with PROTOCOL_VIOLATION" versus "the server did not answer in
5000ms" — turns one silence into two diagnoses, and the second is the one worth re-running.

`assert the subject was still running` is the general rule and applies to both.

## Progress — 2026-08-14, agent-b

The diagnosis is in. The wait loop now *reads* the datagrams it used to sleep through, opens each and
looks for a CONNECTION_CLOSE via a new `closeCodeIn` in the probe, and the failure message says which
of the two happened: a transport error code when the server refused, and "it never answered at all —
that is a busy machine, re-run before reading it as a protocol failure" when nothing came.

And a canary, because a signal never seen firing might not fire: **an ACK past what the server sent
is refused, and the close says why**. It acknowledges packet number 1000, which no handshake reaches;
quinn answers with a CONNECTION_CLOSE carrying 0x0a, PROTOCOL_VIOLATION, and the test reads it. That
also pins the premise the original message rested on — it *claimed* an over-generous ACK ends the
connection, and nothing had checked that quinn does not merely ignore one.

Left open at the time: whether the case should be retried or skipped under load.

## Resolved — the repository already answers it

Neither. `tools/suiteGate.ts` states the principle for exactly this situation, about the suite rather
than about a test: *"It refuses rather than queueing… A script that waits quietly for a free machine
decides for you; being told is what lets the caller pick — keep working locally, run the targeted
tests, come back later, or override with a reason."*

A test that retried itself under load would be that principle inverted. It would decide for the
caller, and it would do it in the one place the caller cannot see — a green run that was red the
first time reads exactly like a run that was never red. Skipping under load is worse again: a case
that vanishes when the machine is busy is a case nobody is measuring on the machine everybody uses.

So the work is done and this is closed. The failure is honest: it says whether the peer refused with
a transport error code or never answered at all, and the second says out loud that a busy machine is
the likelier reading. What to do about a red on a contended box is the caller's call, which is the
same answer the gate gives, for the same reason.

**This is an argument from an existing convention, not a new decision** — the gate's rule is about
whether to run the suite, and extending it to how a test behaves is a step. It is a short one and
worth being explicit about, in case somebody disagrees with the step rather than the conclusion.

## Not claimed

Filed because it makes the shared suite red for everyone, which is the boundary the tracker exists
for. Anyone in `packages/quic` should take it.
