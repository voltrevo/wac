# 0203 — the gate fails one run in six, and never on the same test twice

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** bug
- **Symptom:** no error

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

So there is no flaky test to fix. There is a **wide, load-sensitive tail**, and the gate is a lottery with
about a one-in-six chance of a false red. That number matters more than any of the five: a gate that fails
one run in six teaches people to re-run it, and re-running until green is the same as having no gate, with
worse bookkeeping.

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
2. **Then the three undiagnosed files above**, by running them under deliberate load rather than waiting
   for the gate to catch them again — `taskset`/parallel `wac test` on the same box reproduces it, which is
   how the ssh one was found.
3. **And a decision this does not take:** should the suite retry a single failing file once before failing
   the gate? For: the gate's job is to say whether the change is sound, and a one-in-six false red does not
   say that. Against: a retry hides a genuinely intermittent defect, which is exactly what these five might
   be. A middle answer is to retry but *report* it — "passed on the second attempt" is information, and a
   count of those over a week is the same measurement as this issue, taken continuously.
