// How many calls a worker can have outstanding is not the ring's size — `issues/system/0373d`.
//
// A server holds a `recv` on every connection, and a connection that says nothing holds it for as long as
// the peer likes. Until this, each of those held a slot of the 128, and the 129th call of *any* kind parked
// the worker for good: no accept, no timer, no close of an idle socket to make room, because each of those
// needs a slot too — and the parked thread is the only one that frees one. On a server that is a stop any
// stranger can cause with 130 TCP connections, and it stayed stopped after they closed.
//
// The native hosts never had the shape: `native/src/tickets.rs` keeps a call in a `HashMap` and says so.
// These tests hold the JavaScript bridge to the same: calls the host has not answered take no slot, so
// a worker can have thousands outstanding and still make every other call, wait with a deadline, and
// collect each answer as its own.

import { SLOTS } from "../host/layout.ts";
import { onWorker } from "./worker.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

/** Answers once `OPEN` has been called — an idle connection's `recv`, and then its peer speaking. */
const HOLD = 1;
/** Answers at once with what it was given. */
const ECHO = 2;
/** Lets every `HOLD` answer, each with its own payload. */
const OPEN = 3;

function holdingHandlers() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return {
    [HOLD]: async (p: Uint8Array) => {
      await opened;
      return p;
    },
    [ECHO]: (p: Uint8Array) => p,
    [OPEN]: () => {
      open();
      return new Uint8Array(0);
    },
  };
}

/** Four rings' worth, so the property is "no ceiling" rather than "a higher one". */
const HELD = SLOTS * 4;

Deno.test("calls the host is holding take no slot: thousands outstanding, and the next call is still answered", async () => {
  const out = await onWorker(
    `
      const held = [];
      for (let i = 0; i < ${HELD}; i++) held.push(submit(b, ${HOLD}, i32le(i)));

      // Any other call, answered while every one of those waits.
      const t0 = Date.now();
      const echoed = readI32le(hostCall(b, ${ECHO}, i32le(7)));
      const echoMs = Date.now() - t0;

      // A deadline still expires: a timer is a wait with a timeout, and a program that cannot wait cannot
      // close the connection that has been idle too long.
      const t1 = Date.now();
      const woke = waitAny(b, [held[0], held[${HELD} - 1]], 50);
      const waitMs = Date.now() - t1;

      // The peers speak, and every call gets its own answer — none lost, none crossed.
      hostCall(b, ${OPEN}, i32le(0));
      let wrong = 0;
      for (let i = 0; i < ${HELD}; i++) if (readI32le(collect(b, held[i])) !== i) wrong++;
      return { echoed, echoMs, timedOut: woke === null, waitMs, wrong };
    `,
    holdingHandlers(),
    20_000,
  ) as { echoed: number; echoMs: number; timedOut: boolean; waitMs: number; wrong: number };
  assertEquals(out.echoed, 7, "a call made with every other one outstanding is answered");
  assertEquals(out.echoMs < 2000, true, `and promptly — it took ${out.echoMs}ms`);
  assertEquals(out.timedOut, true, "a wait with a deadline returns at the deadline");
  assertEquals(out.waitMs < 2000, true, `and near it — it took ${out.waitMs}ms`);
  assertEquals(out.wrong, 0, `every one of ${HELD} held calls got its own answer`);
});

Deno.test("a cancelled call holds nothing, and what it would have answered reaches nobody", async () => {
  const out = await onWorker(
    `
      const held = [];
      for (let i = 0; i < ${HELD}; i++) held.push(submit(b, ${HOLD}, i32le(i)));
      // Give up on the even ones, then let all of them answer.
      for (let i = 0; i < ${HELD}; i += 2) cancel(b, held[i]);
      hostCall(b, ${OPEN}, i32le(0));
      let wrong = 0;
      for (let i = 1; i < ${HELD}; i += 2) if (readI32le(collect(b, held[i])) !== i) wrong++;
      // And the ring is usable after all of that has landed: a few rings' worth more, each answered.
      for (let i = 0; i < ${SLOTS * 3}; i++) if (readI32le(hostCall(b, ${ECHO}, i32le(i))) !== i) wrong++;
      let refused = 0;
      try { collect(b, held[0]); } catch { refused = 1; }
      return { wrong, refused };
    `,
    holdingHandlers(),
    20_000,
  ) as { wrong: number; refused: number };
  assertEquals(out.wrong, 0, "the kept calls and the later ones each got their own answer");
  assertEquals(out.refused, 1, "a cancelled ticket cannot be collected");
});
