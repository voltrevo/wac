# 0305 — a second stream to a target that already served one comes back empty

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** no error anywhere. The exit opens the stream, forwards the request, and the target
  answers with nothing. The client waits out its deadline.

## What was seen

Building the two-client case in `packages/tor/test/wac/socksnet_test.wac`. Client A was pointed at
the same `dird` the single-client case had already used, on a circuit that had already carried one
completed stream. Client B was pointed at a fresh `dird` on a fresh circuit.

B worked. A got nothing, and every party in the middle says it did its job:

    socks:   stream 2 -> 127.0.0.1:41843 on circuit 0
    relay3:  [1]  stream 2 open to 127.0.0.1:41843 on handle 4
    relay3:  [1]  the client ended stream 2 after 68 bytes in, 0 bytes out

"68 bytes in" is A's `GET`, so the request reached the exit and the exit reached the target. "0 bytes
out" is the target's answer, and there was none. The stream then ended because *the test's* deadline
expired and it closed, which is the only reason anything stopped.

For contrast, the same target on the same circuit one exchange earlier:

    relay3:  [1]  stream 1 on handle 3 closed by the far end after 68 bytes in, 2561 bytes out

## What is not the explanation

- **Not `relayd`'s one-stream-per-circuit limit.** That is real and now documented in its header, but
  it refuses with a RESOURCELIMIT END and a log line saying so. Here the stream opened.
- **Not `dird` being single-shot in general.** `dird_test.wac` makes three requests on three
  connections and passes on every gate.
- **Not `0304b`.** That was fixed first, and B's stream on the fresh pair closes cleanly.

So the two things that distinguish A from B are that its **target had already served a request**, and
that its **circuit had already carried a stream**.

## Answered: the circuit, not the target — agent-b, 2026-08-31

Only one of the two runs I proposed can be built. `socks` keys circuit reuse on destination *port*
and the target is `127.0.0.1:<port>`, so "a fresh target on a reused circuit" is a contradiction —
reusing the circuit *is* using the same server. The variables were entangled and the issue said
otherwise.

The one that discriminates is a reused target on a fresh circuit, and restarting the proxy is how to
get one. Run: request 1 through proxy A to `dird`, stop A, start proxy B, request the same document
from the same `dird` through B. **It answers.** So a target that has already served is fine, and what
does not work is a **second stream on a circuit that has already carried one**.

That points at `relayd` rather than at `socks` or `dird`, and it fits what its header now says: one
stream per circuit. The refusal it documents is for a *concurrent* second stream — a
RESOURCELIMIT END and a log line. What happens to a *sequential* second stream is different and
worse: the exit opens it ("stream 2 open to … on handle 4"), forwards the request, and relays nothing
back. Opened, accepted, and silently useless.

### The exit is exonerated too, and the first argument did not show it

The restart run had a fresh circuit **and** a fresh exit — `wacnet3 -> wacnet2 -> wacnet1` before,
`wacnet2 -> wacnet1 -> wacnet3` after — so "the circuit, not the target" was the right answer reached
by an argument that could not support it. Circuit and exit were still entangled.

What separates them is already in a passing run's log:

    circuit 0 for port 33907: wacnet1 -> wacnet2 -> wacnet3
    circuit 1 for port 41489: wacnet1 -> wacnet2 -> wacnet3
    circuit 2 for port 43453: wacnet1 -> wacnet3 -> wacnet2

Circuits 0 and 1 **share the exit `wacnet3`** and both carried their documents. So an exit that has
already carried a stream carries another quite happily, as long as it is a different circuit.

So all three are separated: the target is fine, the exit is fine, and what fails is **a second
sequential stream on one circuit**.

**Next**: which end. Both keep per-stream windows and ciphers and only one has to be wrong. The exit
logs "68 bytes in, 0 bytes out", which says it received the request and had nothing to send back —
consistent with the target never being reached on that connection, or with the response being
dropped in its own relay crypto. `relayd`'s own header calls one stream per circuit its limit, so it
is the place to look first, but the client-side `Circuit` keeps stream state too.

## Why it is filed rather than chased

The two-client case works with two fresh targets, so the coverage `issues/system/0303b` needed is in
place and the `socks` rewrite is not blocked on this. Routing around it in the test would have been
the cheap move, and the case says in a comment that it is routing around something — but a symptom
that only lives in a comment is one nobody will ever run down.

`dird.wac` moved to `async` on 2026-08-31, which makes it a candidate and makes this mine; the same
change is why its accept loop no longer serves one client at a time. That is a reason to suspect it
rather than evidence against it.

### Two `relayd` hypotheses eliminated by reading

The shape suggests a stale "armed" flag — a second stream getting a socket and no reader — and it is
not that:

- `streamArmed` is cleared when a read completes (`relayd.wac:912`) and again on teardown (:931),
  so it is not left set from the first stream.
- `hasStream` is set afresh on each BEGIN (:1613) along with `streamId`, and the refusal at :1581
  fires only while a stream is still open — which is why the second one is *accepted* here rather
  than refused.

So the second stream is opened with the bookkeeping in the state it should be in, and the arming
loop at :922 should give it a reader on the next pass. What is not yet established is whether the
target socket it connects is the one the reader is armed on, and whether the 68 bytes counted "in"
were actually written to it — `relayd` counts them on the way through, so the count does not prove
the write.

**The experiment that would settle it** needs a target that logs what it receives; `dird` does not.
A trivial echo server started by the fixture, hit twice on one circuit, separates "the request never
arrived" from "the response was dropped on the way back".

## Correction: it is an interaction, and "the circuit, not the target" was wrong

The experiment named above was built — the case becomes its own target, listening on a port, sending
a CONNECT that names it, and calling `accept` afterwards so nothing has to be in two places at once.
It refuted the conclusion it was built to confirm:

| target | circuit | result |
|---|---|---|
| `dird` | fresh | answers |
| the case's own listener | **reused** | answers — 20 bytes on both rounds |
| `dird` | **reused** | **no answer** |

A second stream on a reused circuit is fine, then, as long as the target is not `dird`; and `dird` is
fine as long as the circuit is fresh. Neither variable explains it alone, so the earlier note above —
"the target is fine, the exit is fine, what fails is a second sequential stream on one circuit" — is
wrong and is left standing only because the reasoning that produced it is worth seeing.

**Also not fixed by the `socks` rewrite.** The original failure was first seen against the
synchronous proxy, and the natural hope was that three pumps had fixed it. Re-running the exact
scenario against the `async` proxy fails identically, so the multiplexer was never the cause.

What is different about `dird` and not about a bare listener is the next question. It answers with
2,561 bytes where the listener answers with 20, and it closes the connection itself as HTTP/1.0
requires; a bare listener in this case is written to answer small and close. Either the size or the
close is what the second stream cannot survive, and both are testable by making the case's own
listener behave like `dird` — answer large, or close first — which is a smaller step than it sounds
now that the case can be its own target.
