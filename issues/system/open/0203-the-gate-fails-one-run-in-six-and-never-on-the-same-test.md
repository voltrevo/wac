# 0203 — the gate fails one run in six, and mostly it is right to

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** bug
- **Symptom:** no error
- **Note:** filed as "a wide, load-sensitive tail" and corrected twice as the failures were read. Two of
  the five were real defects. Read the table before quoting the rate.

## The measurement

Twenty-eight `tools/push.sh` runs on 2026-08-18, one machine, one agent, nothing else pushing:

    23  the suite passed
     5  the suite failed

Every one of the five failed on a **different file**, and each of those files passed on its own
immediately afterwards:

| file | what it said |
|---|---|
| `packages/platform/test/reqbuf.test.ts` | `a slot still holds a request buffer: 0:0` |
| `packages/platform/test/native_examples.test.ts` | nine parse errors at `platform.wac:287` — see `0128` |
| `packages/wacc/test/bindgenWac.test.ts` | — |
| `packages/tls/test/client.test.ts` | — |
| `packages/raster/test/live.test.ts` | — |

**The five have five different causes, and calling them flakiness was wrong.** I filed this issue saying
"a wide, load-sensitive tail", read the five failures properly afterwards, and two of them are not races at
all:

| file | what it was |
|---|---|
| `reqbuf.test.ts` | a race: a fixed 200ms before stopping a responder. Fixed — it waits for the handler. |
| `tls/test/client.test.ts` | a race: the port was taken between choosing it and binding it, so `listening` answered about a stranger and the request was refused. Fixed — a bind failure is retried, and only that. |
| `wacc/test/bindgenWac.test.ts` | **a true red.** The two bindgen generators disagreed about one line, because `ab1f97f8` changed the TypeScript one; `34af4346` brought the wac one back in line and `4dc5aed7` a third. Nothing to do with load. |
| `raster/test/live.test.ts` | **a true red too.** `193e9aca` added the test at 13:46 without the permission guard playwright needs at import time; my gate ran at 13:53 and failed; `8293cf70` — "the live test must ask for the permission it needs" — added the guard at 13:58. |
| `platform/test/native_examples.test.ts` | unexplained; recorded in `issues/system/0128` with its two candidates. |

So the *rate* stands — five of twenty-eight runs failed — and the *diagnosis* is now the opposite of what
this issue was filed to say. **Two of the five were genuine breakage**, both from commits that arrived while
I was working and both fixed by their authors within minutes: `push.sh` merges before it runs the suite, so
another agent's in-flight red becomes my failed push. Two were races and are fixed. One is unexplained.

That leaves a false-red rate of two or three in twenty-eight, not five — and a gate that caught two real
defects in a day. **"The gate is flaky" was wrong twice over**, and both times the only evidence for it was
that I had not read the failures. The rate is worth watching; the story it invites is worth refusing.

What survives of the original point is narrower and still true: a fixed wait standing in for an event is a
false red waiting to happen, and this repository has three good remedies for it already.

## The shape, where it has been diagnosed

Two of the five were looked at properly on the day. Both were a **fixed wait standing in for an event**:

- `reqbuf.test.ts` slept 200ms before stopping a responder, so under load it stopped one before the state
  the test was about existed. Fixed: it waits for the handler to be entered. 63ms instead of 270ms.
- `packages/ssh`'s live fixtures spun 400 *attempts* at a connect that fails in microseconds — ten
  milliseconds of "patience" — which is what made "sshd never accepted" look like port exhaustion.
  Fixed the same day: `waitForPortWithin` takes a deadline.

The remedy already exists in three shapes in this repository, which is the point: `until()` in
`reqbuf.test.ts`, `waitForPortWithin`/`waitForLogWithin` in `packages/wactest/src/daemon.wac`, and `seen`
in `packages/ssh/test/wac/wacsshd.wac`. What is missing is a sweep.

## What to do, in order

1. ~~**Sweep the unconditional sleeps.**~~ Done, 2026-08-18, and it was three sites rather than a class:

   - `packages/platform/test/aliasing.test.ts` (1500ms) — a fake server "holding the connection" for a
     fixed time, which is a guess that the reader finishes inside it *and* a guarantee the test waits out
     whatever is left. It holds on a signal now, released by the `close()` the test already calls in its
     `finally`. Two tests in 11ms rather than 1.5s.
   - `packages/webrtc/test/browser.test.ts` (1200ms, twice) — **deliberate, left alone.** A data channel
     closing and a peer connection closing are different events at the SCTP layer, and the pause exists so
     that whatever arrives after each is attributable to that one. There is no state to wait for; the pause
     *is* the observation. Recorded here so the next reader does not re-derive it.
   - the same file's 5000ms is a `Promise.race` deadline on ICE gathering with an event resolving it early,
     which is the shape everything else is being converted *to*.

   So the remaining candidates are not unconditional sleeps. They are the three undiagnosed files below.
2. ~~**Then the three undiagnosed files above.**~~ Done, and the table above is the answer: two were not
   races, and `tls/client`'s was fixed by asking the one question `listening` cannot — whether the child that
   was supposed to take the port is still alive. Only `native_examples` is open.
3. **And a decision this does not take:** should the suite retry a single failing file once before failing
   the gate? For: the gate's job is to say whether the change is sound, and a one-in-six false red does not
   say that. Against: a retry hides a genuinely intermittent defect, which is exactly what these five might
   be. A middle answer is to retry but *report* it — "passed on the second attempt" is information, and a
   count of those over a week is the same measurement as this issue, taken continuously.
