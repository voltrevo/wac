// Bounding a call, and the sharp edge that comes with it. wac-mono issue 0018.
//
// The capability is `core.sleepMillis`: a ticket that settles on time rather than on I/O, so
// `waitAny` over it and a real call is a timeout. What is worth testing is not that a timer
// fires — it is the two failure modes around it, both of which are silent permanent parks:
//
//   * a silent peer, which is what the issue was filed about;
//   * a ticket `waitAny` did not pick and nobody cancelled, which holds a ring slot for good.
//
// The second is the one I hit writing the example, and it looks exactly like the first.
//
// ## Two of the five moved to wac — 2026-08-20, `issues/system/0161`
//
// `packages/platform/test/wac/patience_test.wac` has the peer cases: a listener that accepts and does
// not answer, and one that answers late. Neither needed a JavaScript host — `cli.listen`, `cli.accept`
// and `core.sleepMillis` are that peer — and what made it writable there is `issues/system/0211`,
// since `Cli.exec` used to run a child to completion inside the capability call and so could not hold
// a peer open *while* the child talked to it.
//
// **What is left is about the slot table**, not about the deadline: these three submit into the bridge
// directly and count what is holding it, which is a fact about `host/layout.ts`. `silentPeer`,
// `buildApp` and the decoder went with the tests that used them.

import { onWorker, SLOW, slowHandlers } from "./worker.ts";
import { newBridge } from "../host/layout.ts";
import { S_STATUS, SLOTS, slotAt, ST_READY } from "../host/layout.ts";
import { submit } from "../host/call.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}


Deno.test("every slot holding an uncollected answer is an error, not a park", () => {
  // The diagnostic, unit-tested: no worker and no wac, because the condition is a state of
  // the control block and putting it there directly is exact.
  //
  // A ready slot can only be freed by the thread that submitted, so a submitting thread that
  // finds all of them ready is waiting for something that can only happen after it stops
  // waiting. It used to park there forever — the same silent hang as the bug this file is
  // about, arrived at from the other direction.
  const b = newBridge();
  for (let i = 0; i < SLOTS; i++) Atomics.store(b.ctrl, slotAt(i) + S_STATUS, ST_READY);

  let message = "";
  try {
    submit(b, 1, new Uint8Array(0));
    throw new Error("submit returned; it should have refused");
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  // The message has to name the fix, because the symptom points at whatever call happened to
  // run out of slots rather than at the ticket that was abandoned rounds earlier.
  assertEquals(message.includes("never taken"), true, message);
  assertEquals(message.includes("cancel"), true, message);
});

Deno.test("the deadline on the wait, from a worker where parking is real", async () => {
  // `waitAny`'s own timing, which the end-to-end test above cannot pin down: it always passes
  // a positive deadline against a real socket, so an off-by-one in the remaining-time check
  // would still look right there. Here the call takes a known 400ms and the waits are exact.
  const out = await onWorker(
    `
    const t = submit(b, ${SLOW}, i32le(400));
    const log = [];

    // Short of the answer: -1, and it waited rather than returning at once.
    const began = performance.now();
    log.push(waitAny(b, [t], 60) === null ? "timeout" : "settled");
    log.push(performance.now() - began >= 50 ? "parked" : "returned-early");

    // Zero is a poll of the set, not a wait that always fails.
    log.push(waitAny(b, [t], 0) === null ? "not-ready" : "ready");

    // -1 waits as long as it takes.
    const got = waitAny(b, [t], -1);
    log.push(got === null ? "gave-up" : "got-it");
    log.push(String(readI32le(collect(b, t))));

    // A poll of a settled ticket reports it instead of timing out — the deadline is checked
    // after the scan, so an answer already there is never missed however tight the budget.
    const u = submit(b, ${SLOW}, i32le(0));
    waitAny(b, [u], -1);
    log.push(waitAny(b, [u], 0) === null ? "missed" : "seen");
    collect(b, u);

    // Nothing to wait for is the same answer as nothing happened in time.
    log.push(waitAny(b, [], -1) === null ? "empty-is-null" : "empty-is-something");
    return log.join(",");
  `,
    slowHandlers,
  );
  assertEquals(
    out,
    "timeout,parked,not-ready,got-it,400,seen,empty-is-null",
    String(out),
  );
});

Deno.test("the exhaustion error names what is holding the slots", async () => {
  // The state-of-the-control-block test above sets statuses directly, so its slots carry no
  // opcode and it cannot check the naming. This fills the ring the way a program would —
  // four calls settled and deliberately not collected — so the message has real opcodes to
  // report. The harness's slow capability borrows opcode 1, which is `NOW_MILLIS`: the
  // behaviour is a test double, the number is genuine, and that is what the table resolves.
  const out = await onWorker(
    `
    const ts = [];
    for (let i = 0; i < ${SLOTS}; i++) ts.push(submit(b, ${SLOW}, i32le(0)));
    for (const t of ts) waitAny(b, [t], -1);      // settled, and left holding their slots
    try { submit(b, ${SLOW}, i32le(0)); return "submitted anyway"; }
    catch (e) { return e.message; }
  `,
    slowHandlers,
  );
  const msg = String(out);
  // A tally rather than one name per slot: at 128 slots a list is a wall of text, and what the
  // reader needs is which *kind* of call was abandoned. Written from `SLOTS` rather than a literal
  // because the count is a tuning decision and a test that pins it fails for the wrong reason.
  assertEquals(msg.includes(`from: NOW_MILLIS × ${SLOTS}`), true, msg);
  // And it says the blame is probably elsewhere, because it is.
  assertEquals(msg.includes("abandoned ticket is usually earlier"), true, msg);
});
