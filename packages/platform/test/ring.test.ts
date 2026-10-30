// The bridge's ring, from a real worker.
//
// The rest of the suite drives the bridge through wac programs, which today issue one call
// at a time — so nothing there would notice if the ring served them strictly in order and
// the slots were decoration. These tests use the worker API directly and check the
// properties the ring exists for: submitting does not block, several calls overlap, the
// answers do not have to come back in order, and a ticket cannot be confused with another
// call's.

import { SLOTS } from "../host/layout.ts";
import { onWorker, SLOW, slowHandlers } from "./worker.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

Deno.test("submitting does not block, and calls overlap", async () => {
  // Three calls of 200ms each: 600ms serially, a little over 200 overlapped. The bound is
  // 450, which leaves better than two times headroom above the overlapped time and still
  // could not be met serially.
  //
  // Sized that way after a tighter version (120ms units, a 300ms bound) failed once in a
  // full run and never again in eight. This machine has other agents on it; a timing test
  // whose margin is smaller than the load it competes with is a coin toss, not a test.
  const out = await onWorker(
    `
      const t0 = Date.now();
      const a = submit(b, ${SLOW}, i32le(200));
      const c = submit(b, ${SLOW}, i32le(200));
      const d = submit(b, ${SLOW}, i32le(200));
      const submitMs = Date.now() - t0;
      const anyDone = isDone(b, a) || isDone(b, c) || isDone(b, d);
      const vals = [collect(b, a), collect(b, c), collect(b, d)].map((r) => readI32le(r));
      return { submitMs, anyDone, vals: vals.join(","), totalMs: Date.now() - t0 };
    `,
    slowHandlers,
  ) as { submitMs: number; anyDone: boolean; vals: string; totalMs: number };

  assertEquals(out.submitMs < 100, true, `submitting blocked for ${out.submitMs}ms`);
  assertEquals(out.anyDone, false, "nothing can be done immediately after submitting");
  assertEquals(out.vals, "200,200,200", "each ticket got its own answer");
  assertEquals(out.totalMs < 450, true, `took ${out.totalMs}ms; serial would be ~600`);
});

Deno.test("waitAny returns whichever finishes first, whatever the order they were sent", async () => {
  // Submitted slowest first. If completion were ordered by submission this would come back
  // 300,200,100 — the check is that it does not.
  const out = await onWorker(
    `
      const slow = submit(b, ${SLOW}, i32le(300));
      const mid = submit(b, ${SLOW}, i32le(200));
      const fast = submit(b, ${SLOW}, i32le(100));
      const order = [];
      const left = [slow, mid, fast];
      while (left.length > 0) {
        const t = waitAny(b, left);
        left.splice(left.indexOf(t), 1);
        order.push(readI32le(collect(b, t)));
      }
      return order.join(",");
    `,
    slowHandlers,
  );
  assertEquals(out, "100,200,300", "completions came back in submission order, not by speed");
});

Deno.test("a ticket cannot be confused with the call that reused its slot", async () => {
  // Four slots, so the fifth call must reuse one. Collecting a spent ticket has to say so
  // rather than hand back whatever now occupies that slot — which would look plausible and
  // be wrong, the worst combination.
  const out = await onWorker(
    `
      const first = submit(b, ${SLOW}, i32le(1));
      collect(b, first);
      let reused = "no error";
      try { collect(b, first); } catch (e) { reused = "refused"; }

      // Five in a row through four slots: the fifth waits for one to free rather than
      // failing, and every answer is still its own.
      const vals = [];
      for (let i = 0; i < 5; i++) vals.push(readI32le(collect(b, submit(b, ${SLOW}, i32le(i + 1)))));
      return { reused, vals: vals.join(",") };
    `,
    slowHandlers,
  ) as { reused: string; vals: string };
  assertEquals(out.reused, "refused", "a spent ticket was collected twice");
  assertEquals(out.vals, "1,2,3,4,5");
});

Deno.test("cancel frees the slot and the answer is discarded", async () => {
  // Cancel is detach, not abort: the host may already be inside the work. What it
  // guarantees is that the slot comes back and the result is dropped — so four cancels
  // through four slots must not exhaust the ring.
  const out = await onWorker(
    `
      const t0 = Date.now();
      for (let i = 0; i < 8; i++) cancel(b, submit(b, ${SLOW}, i32le(80)));
      const cancelMs = Date.now() - t0;
      // The ring still works afterwards.
      const after = readI32le(hostCall(b, ${SLOW}, i32le(1)));
      return { cancelMs, after };
    `,
    slowHandlers,
  ) as { cancelMs: number; after: number };
  assertEquals(out.after, 1, "the bridge still works after cancels");
  // Eight cancels of 80ms work through four slots: the second four wait only for a slot
  // to free, not for all the work. Serial would be 640ms.
  assertEquals(out.cancelMs < 500, true, `cancelling took ${out.cancelMs}ms`);
});

Deno.test("an error in one slot does not disturb the others", async () => {
  const BOOM = 2;
  const out = await onWorker(
    `
      const good = submit(b, ${SLOW}, i32le(60));
      const bad = submit(b, ${BOOM}, i32le(0));
      let msg = "none";
      try { collect(b, bad); } catch (e) { msg = e.message; }
      return { msg, good: readI32le(collect(b, good)) };
    `,
    { ...slowHandlers, [BOOM]: () => { throw new Error("deliberate"); } },
  ) as { msg: string; good: number };
  assertEquals(out.msg, "deliberate", "the failure reached the caller");
  assertEquals(out.good, 60, "and the other call was unaffected");
});

Deno.test("as many calls in flight as there are slots, all waited on together", async () => {
  // A ring's worth of calls waited on as one set, each taken as it lands. The count of slots was
  // a ceiling on how many handles a program could watch until `issues/system/0373d`, when a call
  // stopped holding its slot while the host works; `fanout.test.ts` holds it to *no* ceiling.
  // This is the ordering and the set: answers taken in the order they land, and nothing left
  // behind when the last is collected.
  const out = await onWorker(
    `
    const ts = [];
    for (let i = 0; i < ${SLOTS}; i++) ts.push(submit(b, ${SLOW}, i32le(60 + i)));

    // Every one of them waited on as a set, taking each as it lands. The last iteration is
    // the interesting one: a single-ticket list whose answer arrived long ago.
    const order = [];
    const live = ts.slice();
    while (live.length > 0) {
      const t = waitAny(b, live, -1);
      order.push(readI32le(collect(b, t)) - 60);
      live.splice(live.indexOf(t), 1);
    }

    // And the ring is fully free again, or this would throw rather than answer.
    return order.join(",") + "|" + readI32le(collect(b, submit(b, ${SLOW}, i32le(7)))); 
  `,
    slowHandlers,
  );
  // Each call sleeps 60+i ms, so they settle in submission order — which also says the slots
  // are independent rather than served in lockstep.
  const expected = Array.from({ length: SLOTS }, (_, i) => i).join(",") + "|7";
  assertEquals(out, expected, String(out));
});

Deno.test("a cancelled call's answer does not settle the call that came after it", async () => {
  // wac-mono issue 0023, reported by agent-c: a 30-second bound expiring after 15 because a
  // 15-second timer had been cancelled earlier. Not id recycling — they checked that — and
  // not about timers at all. The slot was what got recycled.
  //
  // Then, a call held its slot until it was collected, and a cancel handed the slot back while
  // the host's handler still ran; the stale answer was written into the slot another call had
  // since claimed, and that call's `waitAny` reported a ticket that had not settled — early,
  // which is worse than late, because a bound that fires at half its interval drops
  // connections that were about to succeed.
  //
  // Now a slot is nobody's while the handler runs (`issues/system/0373d`): the answer goes in
  // whichever slot is free, says which call it is for, and a cancelled call's is dropped as it
  // is drained. The property is the same and so is the check: cancel a call the host has taken,
  // make more, and see that the cancelled one's completion settles none of them.
  const out = await onWorker(
    `
    const doomed = submit(b, ${SLOW}, i32le(300));
    // Waited on first, and deliberately not long enough: the host has to have *taken* the
    // call before it is cancelled, or the sweep sees it cancelled while still pending and
    // the handler never runs — there is then no stale completion and nothing to reproduce.
    // That is how the first version of this test passed against the bug.
    waitAny(b, [doomed], 40);
    cancel(b, doomed);

    // Two quick round trips, and then the long call, all made while the cancelled one runs.
    hostCall(b, ${SLOW}, i32le(0));
    hostCall(b, ${SLOW}, i32le(0));
    const real = submit(b, ${SLOW}, i32le(2000));

    // 800ms is after the cancelled call's 300ms and well before the real one's 2000ms. If the
    // stale answer settles the real call, waitAny reports it at about 300ms.
    const began = performance.now();
    const got = waitAny(b, [real], 800);
    const waited = Math.round(performance.now() - began);
    return (got === null ? "nothing-settled" : "settled") + " after " + (waited < 600 ? "early" : "the full deadline");
  `,
    slowHandlers,
  );
  assertEquals(out, "nothing-settled after the full deadline", String(out));
});
