// Bounding a call, and the sharp edge that comes with it. wac-mono issue 0018.
//
// The capability is `core.sleepMillis`: a ticket that settles on time rather than on I/O, so
// `waitAny` over it and a real call is a timeout. What is worth testing is not that a timer
// fires — it is the two failure modes around it, both of which are silent permanent parks:
//
//   * a silent peer, which is what the issue was filed about;
//   * a ticket `waitAny` did not pick and nobody cancelled, which held a ring slot for good.
//
// The second is the one I hit writing the example, and it looked exactly like the first. It is gone
// since `issues/system/0373d`: an answer leaves its slot the next time the worker waits for anything,
// so an uncollected ticket costs a row in the worker's memory and no slot.
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
import { OP_ANSWER, S_ID, S_OP, S_STATUS, SLOTS, slotAt, ST_PENDING, ST_READY } from "../host/layout.ts";
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


Deno.test("a ring full of uncollected answers is drained by the next submit, not parked on", () => {
  // The state the old diagnostic was for, put there directly — no worker and no wac, because it is a
  // state of the control block and writing it is exact: every slot holding an answer nobody has taken.
  //
  // A ready slot can only be freed by the worker, so a submit that found all of them ready was waiting
  // for something that could only happen after it stopped waiting. It parked for ever, and then it raised
  // "never taken" instead. Since `issues/system/0373d` it drains: every answer is copied out to wait for
  // its ticket, every slot comes back, and the submit takes one. On this thread a park would block for
  // good — there is no host here to wake it — so returning at all is the assertion.
  const b = newBridge();
  for (let i = 0; i < SLOTS; i++) {
    const at = slotAt(i);
    Atomics.store(b.ctrl, at + S_OP, OP_ANSWER);
    Atomics.store(b.ctrl, at + S_ID, 1000 + i);
    Atomics.store(b.ctrl, at + S_STATUS, ST_READY);
  }

  submit(b, 1, new Uint8Array(0));

  let pending = 0;
  let ready = 0;
  for (let i = 0; i < SLOTS; i++) {
    const st = Atomics.load(b.ctrl, slotAt(i) + S_STATUS);
    if (st === ST_PENDING) pending++;
    if (st === ST_READY) ready++;
  }
  assertEquals(ready, 0, "every answer was drained out of its slot");
  assertEquals(pending, 1, "and the submit is in one of the slots that came back");
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

Deno.test("a ring's worth of settled, uncollected tickets stops nothing, and each is still collectable", async () => {
  // The state above, reached the way a program reaches it: calls settled and deliberately not
  // collected. This filled the ring until `issues/system/0373d`, and the next submit raised an error
  // naming what held the slots. Now each answer is drained into the worker's memory as it lands, so
  // the next call goes ahead — and each settled ticket still answers with its own payload afterwards,
  // which is what says the answers were kept rather than thrown away to make room.
  const out = await onWorker(
    `
    const ts = [];
    for (let i = 0; i < ${SLOTS * 2}; i++) ts.push(submit(b, ${SLOW}, i32le(i % 5)));
    for (const t of ts) waitAny(b, [t], -1);      // settled, and not collected
    const next = readI32le(hostCall(b, ${SLOW}, i32le(3)));
    let wrong = 0;
    for (let i = 0; i < ts.length; i++) if (readI32le(collect(b, ts[i])) !== i % 5) wrong++;
    return next + "|" + wrong;
  `,
    slowHandlers,
    20_000,
  );
  assertEquals(out, "3|0", `the next call answered 3, and no settled ticket lost its answer — ${out}`);
});
