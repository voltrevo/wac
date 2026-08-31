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
that its **circuit had already carried a stream**. Which of the two matters is the first thing to
establish, and it is one run each: a fresh target on a reused circuit, and a reused target on a fresh
circuit.

## Why it is filed rather than chased

The two-client case works with two fresh targets, so the coverage `issues/system/0303b` needed is in
place and the `socks` rewrite is not blocked on this. Routing around it in the test would have been
the cheap move, and the case says in a comment that it is routing around something — but a symptom
that only lives in a comment is one nobody will ever run down.

`dird.wac` moved to `async` on 2026-08-31, which makes it a candidate and makes this mine; the same
change is why its accept loop no longer serves one client at a time. That is a reason to suspect it
rather than evidence against it.
