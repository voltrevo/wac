// The bridge under random load, checking the invariants the ring exists to keep.
//
// Two slot-ownership bugs surfaced in one day, both weeks old, and neither was found by a test:
// `claim` published a slot as pending before the opcode was written, and a cancelled call's
// answer was delivered into the slot that had since been claimed by another call (issue 0023).
// One turned up because `SLOTS` was raised from four to sixteen, the other because a tor client
// dropped healthy relays in the field. Both were timing windows that only open under load.
//
// So the point here is not coverage of the API — the rest of the suite does that — but the two
// properties that both bugs violated, exercised by a randomized sequence:
//
//   * **an answer only ever reaches the ticket that asked for it.** Every request carries a
//     nonce and the handler echoes it, so cross-talk is detected rather than inferred. This is
//     0023 stated as a check: a cancelled call's nonce must never appear as another's answer.
//   * **a spent or cancelled ticket is an error, not a plausible answer.** "Plausible" is what
//     makes it worth testing: a crossed answer is real bytes from a real call.
//
// And a third since `issues/system/0373d`, when a call stopped holding a slot while the host works:
// **every slot comes back once the worker has drained**, a cancelled call's answer included. A
// ticket is a call number now, not a slot and a generation, and an answer lands in whichever slot
// is free; the run ends by waiting for every cancelled call's answer, and then every slot is free.
//
// Deterministic despite being random — **of the inputs, and not of the schedule.** The worker's
// choices come from a seeded xorshift and the host is a pure function of the request, so what is
// asked for replays exactly. What does not replay is the *interleaving*, which is the machine's
// business and changes with its load.
//
// This header used to say a failure "can be replayed exactly", and that sent me looking for a
// reproduction that does not exist: `issues/system/0155` is seed 31 failing inside a full suite run
// and passing every targeted re-run since. **A failure here has to carry its own diagnosis**, which
// is why the checks below report what they found and not only what they wanted.
//
// ## Both scheduler modes, because one of them cannot see some of what this checks
//
// This ran only with the scheduler `off`, for a good reason: that is the production mode, and a
// deterministic scheduler takes away the concurrency the file exists to stress.
//
// The consequence was not visible from that argument. With scheduling off, `respond.ts` writes an
// answer straight back inside the handler's completion, so nothing is ever *delayed* between a call
// finishing and its answer landing — and the slot generation this protocol had until 0373d guarded
// exactly that window, so deleting it left the `off` pass green, five runs of five. Under `seeded` it
// died on the first seed. The generation is gone with the protocol it belonged to, and the lesson is
// not: each mutant below is caught in both modes today, and the next guard on the answer path may not be.
//
// So both, and neither is redundant: `off` is production and `seeded` is the only one that reaches
// the delayed-answer path. A guard is only tested in a configuration that can delay the answer it
// guards.

import { BUF_BYTES, CTRL_INTS, newBridge, S_STATUS, SLOTS, slotAt, ST_FREE } from "../host/layout.ts";
import { serveHostCalls } from "../host/respond.ts";
import { newScheduler } from "../host/schedule.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const CALL = import.meta.resolve("../host/call.ts");
const LAYOUT = import.meta.resolve("../host/layout.ts");

/** The one capability: echo the nonce, after the delay and at the size the request asks for. */
const ECHO = 1;

const handlers = {
  [ECHO]: async (p: Uint8Array): Promise<Uint8Array> => {
    const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
    const nonce = v.getInt32(0, true);
    const delay = v.getInt32(4, true);
    const size = v.getInt32(8, true);
    // A request longer than one slot arrived in pieces; the whole of it should be here, and its
    // tail says so. Checked on the host side because a request reassembled wrongly is otherwise
    // invisible — the nonce alone would still match.
    const declared = v.getInt32(12, true);
    if (p.length !== declared) {
      throw new Error(`request reassembled to ${p.length} bytes, declared ${declared}`);
    }
    for (let i = 16; i < p.length; i++) {
      if (p[i] !== ((nonce + i) & 0xff)) throw new Error(`request byte ${i} is wrong`);
    }
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    // **Offset 4 carries the size this handler read** — `issues/system/0162`'s discriminator. The
    // nonce rules out one call's answer landing on another and says nothing about the *request*
    // arriving wrong: a handler told 131,625 faithfully builds 131,625 bytes, and the guest then
    // reports a truncation that never happened. Echoing the size back is what tells those apart.
    //
    // It goes at offset 4 rather than at the end because a truncated answer still has its head,
    // and the head is the only part a short answer is guaranteed to carry.
    const out = new Uint8Array(Math.max(8, size));
    const ov = new DataView(out.buffer);
    ov.setInt32(0, nonce, true);
    ov.setInt32(4, size, true);
    for (let i = 8; i < out.length; i++) out[i] = (nonce + i) & 0xff;
    return out;
  },
};

/**
 * The worker's side of the fuzz, as source.
 *
 * Written as a string because it has to run where `Atomics.wait` is allowed. It keeps its own
 * model of what it has outstanding and checks every answer against it; the test's job is only
 * to start it and read the verdict.
 */
const BODY = `
  const seed = readI32le(new Uint8Array(new Int32Array([SEED]).buffer));
  let x = seed >>> 0 || 1;
  const rnd = () => {                       // xorshift32: reproducible from the seed
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;  x >>>= 0;
    return x / 4294967296;
  };
  const pick = (n) => Math.floor(rnd() * n);

  const req = (nonce, delay, size, extra) => {
    const len = 16 + extra;
    const p = new Uint8Array(len);
    const v = new DataView(p.buffer);
    v.setInt32(0, nonce, true);
    v.setInt32(4, delay, true);
    v.setInt32(8, size, true);
    v.setInt32(12, len, true);              // so the host can check reassembly
    for (let i = 16; i < len; i++) p[i] = (nonce + i) & 0xff;
    return p;
  };

  const live = [];                          // { t, nonce, size, settledSeen }
  const cancelled = new Set();              // nonces whose answers must never be seen again
  const spent = new Set();
  let nonce = 1, collected = 0, cancels = 0, timeouts = 0, chunked = 0;

  const answerOf = (bytes, entry) => {
    if (bytes.length !== Math.max(8, entry.size)) {
      // **Say whose answer this actually is.** This used to report only the expected nonce and the
      // two lengths — "answer for 12 is 326 bytes, wanted 924" — which is equally consistent with a
      // truncated answer to *this* call and with another call's answer landing here, and those want
      // opposite fixes. The nonce is the first four bytes of every answer, so it is free to read.
      //
      // It matters because this failure appears under a load the seed cannot reproduce
      // (issues/system/0155): the one report you get has to carry its own diagnosis. With the
      // slot generation removed, under the protocol before 0373d, it said "the nonce belongs to
      // cancelled call 9", which is the diagnosis rather than the symptom.
      //
      // (Two traps in here, both because this function lives inside the worker source and that is a
      // template literal. A backtick in a comment *ends* it, and the parse error lands two hundred
      // lines away on a line nobody touched. And an escape is consumed by the template, so a newline
      // in a message has to be written twice over.)
      const found = bytes.length >= 4 ? readI32le(bytes) : null;
      // The size the *handler* read, echoed at offset 4. The guard is not decoration: the answers
      // this branch sees are short by definition, and while 131,625 bytes is long enough to hold it
      // a four-byte one is not.
      const said = bytes.length >= 8 ? readI32le(bytes.subarray(4)) : null;
      const readSize = said === null
        ? "handler read size: unknown, the answer is too short to carry it"
        : said === entry.size
        ? "handler read size " + said + " - what was asked, so the answer path truncated it"
        : "handler read size " + said + " - not the " + entry.size +
          " asked, so the request path corrupted it and no answer was ever truncated";
      const whose = found === null
        ? "too short to say whose it is"
        : found === entry.nonce
        ? "the nonce is this call's, so it is truncated rather than crossed"
        : cancelled.has(found)
        ? "the nonce belongs to cancelled call " + found + " - an answer delivered to the wrong call"
        : "the nonce is " + found + ", another live call's - crossed";
      throw new Error(
        "answer for " + entry.nonce + " is " + bytes.length + " bytes, wanted " + Math.max(8, entry.size) +
        "\\n  " + whose +
        "\\n  " + readSize +
        "\\n  call " + entry.t.id +
        ", " + live.length + " live, " + cancels + " cancelled and " + spent.size + " spent so far",
      );
    }
    const got = readI32le(bytes);
    if (cancelled.has(got)) {
      throw new Error("the answer to cancelled call " + got + " was delivered as the answer to " + entry.nonce);
    }
    if (got !== entry.nonce) {
      throw new Error("asked as " + entry.nonce + ", answered as " + got + " for call " + entry.t.id);
    }
    // Every byte, not just the nonce: a response reassembled out of order would keep its head.
    //
    // **From 8, not 4, and that is four bytes of oracle given up.** Offsets 4-7 carry the echoed
    // size (issues/system/0162 - no backticks in here, they would end the worker source) and no
    // longer follow the pattern, so a reassembly fault landing
    // exactly there is now invisible to this check. Accepted deliberately: the four bytes buy the
    // one thing this loop cannot tell you, which is whether the answer was short because it was
    // truncated or because the handler was asked for the wrong size.
    for (let i = 8; i < bytes.length; i++) {
      if (bytes[i] !== ((got + i) & 0xff)) throw new Error("answer byte " + i + " is wrong for " + got);
    }
  };

  const collectOne = (i) => {
    const e = live[i];
    live.splice(i, 1);
    answerOf(collect(b, e.t), e);
    spent.add(e.nonce);
    collected++;
  };

  const STEPS = ${"" /* set below */}0;
  const note = () => { globalThis.__model = "live=" + live.length + " step=" + step + " nonce=" + nonce; };
  let step = 0;
  for (; step < STEPS; step++) {
    note();
    // Make room before doing anything else. A held ticket is a held slot whether or not it has
    // settled, so the cap is on how many are outstanding, not on how many are ready — the first
    // version of this counted the ready ones and duly filled the ring with sixteen unsettled
    // calls, at which point submitting is a legitimate error and the harness would have been
    // reporting its own mistake as a finding.
    if (live.length >= ${SLOTS} - 1) {
      const got = waitAny(b, live.map((e) => e.t), -1);
      collectOne(live.findIndex((e) => e.t.id === got.id));
    }

    const roll = rnd();
    if (roll < 0.42 || live.length === 0) {
      // A new call. One in eight is big enough to chunk in one direction or both, which is
      // where a slot's payload space and its control block have to agree.
      const big = pick(8) === 0;
      const size = big ? ${BUF_BYTES} + pick(${BUF_BYTES}) : pick(2000);
      const extra = big ? ${BUF_BYTES} + pick(1000) : pick(64);
      if (big) chunked++;
      const n = nonce++;
      live.push({ t: submit(b, ${ECHO}, req(n, pick(3), size, extra)), nonce: n, size });
    } else if (roll < 0.62) {
      const i = pick(live.length);
      const e = live[i];
      // Cancel. Recorded before the call, because the answer may already be on its way and the
      // check is that it never reappears attached to anything else.
      cancelled.add(e.nonce);
      cancel(b, e.t);
      live.splice(i, 1);
      cancels++;
      // A cancelled ticket is spent: waiting on it has to raise rather than answer.
      let raised = false;
      try { collect(b, e.t); } catch (err) { raised = true; }
      if (!raised) throw new Error("collect on a cancelled ticket answered instead of raising");
    } else if (roll < 0.86) {
      // Wait on a random subset, with a deadline that is sometimes a poll and sometimes none.
      const n = 1 + pick(Math.min(live.length, 5));
      const chosen = [];
      while (chosen.length < n) {
        const i = pick(live.length);
        if (!chosen.includes(i)) chosen.push(i);
      }
      const ms = [0, 1, 5, -1][pick(4)];
      const got = waitAny(b, chosen.map((i) => live[i].t), ms);
      if (got === null) {
        if (ms < 0) throw new Error("waitAny with no deadline returned nothing");
        timeouts++;
      } else {
        const at = chosen.find((i) => live[i].t.id === got.id);
        if (at === undefined) throw new Error("waitAny returned a ticket that was not in the list");
        // It said this one is ready, so it must be: collecting is how that is checked, since a
        // wrong answer here is exactly the shape of 0023.
        if (!isDone(b, live[at].t)) throw new Error("waitAny reported a ticket that is not done");
        collectOne(at);
      }
    } else {
      // A ticket that has already been collected must stay an error however often it is asked.
      for (const n of spent) {
        void n;
        break;
      }
      const i = pick(live.length);
      if (isDone(b, live[i].t)) collectOne(i);
    }
  }

  while (live.length > 0) {
    const got = waitAny(b, live.map((e) => e.t), -1);
    const at = live.findIndex((e) => e.t.id === got.id);
    collectOne(at);
  }

  // **And the cancelled calls' answers, as they land.** A cancelled call holds no slot, but its answer
  // takes one when it arrives, until a drain drops it — which any wait does. A program that goes on
  // waiting for anything does this without asking; this one has nothing left to wait for, so it waits
  // for those, with a deadline so a lost answer fails the run rather than hanging it.
  const settleBy = Date.now() + 10000;
  while (droppedCalls(b) > 0 && Date.now() < settleBy) {
    isDone(b, { id: -1 });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
  if (droppedCalls(b) > 0) throw new Error(droppedCalls(b) + " cancelled call(s) were never answered");

  return "steps=" + STEPS + " collected=" + collected + " cancelled=" + cancels +
         " chunked=" + chunked + " polls-that-timed-out=" + timeouts;
`;

async function fuzz(
  seed: number,
  steps: number,
  policy: "off" | "seeded" = "off",
): Promise<{ report: string; ctrl: Int32Array }> {
  const bridge = newBridge();
  // **`off` is production**: many calls in flight and the host answering in whatever order it likes,
  // which is what this file exists to stress and what a deterministic scheduler takes away.
  // design/0001 D12.
  //
  // **`seeded` is where an answer can be delayed.** With scheduling off it is written synchronously as
  // the handler finishes, so nothing can happen in between. See the header.
  const responder = serveHostCalls(bridge, handlers, { scheduler: newScheduler(policy) });
  const src = `
    import { submit, collect, isDone, waitAny, cancel, hostCall, i32le, readI32le, droppedCalls } from ${JSON.stringify(CALL)};
    import { bridgeOf, slotAt, S_STATUS, SLOTS } from ${JSON.stringify(LAYOUT)};
    globalThis.__layout = { slotAt, S_STATUS, SLOTS };
    self.onmessage = (e) => {
      const b = bridgeOf(e.data);
      try { self.postMessage({ ok: true, value: (() => { ${BODY.replace("SEED", String(seed)).replace('const STEPS = 0;', `const STEPS = ${steps};`)} })() }); }
      catch (err) {
        let held = "";
        try {
          const { slotAt, S_STATUS, SLOTS } = globalThis.__layout;
          const st = [];
          for (let i = 0; i < SLOTS; i++) st.push(Atomics.load(b.ctrl, slotAt(i) + S_STATUS));
          held = " statuses=[" + st.join(",") + "]";
        } catch { /* diagnostics only */ }
        self.postMessage({ ok: false, error: String((err && err.message) || err) + held + " " + (globalThis.__model || "") });
      }
    };
  `;
  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  const w = new Worker(url, { type: "module" });
  try {
    const r = await new Promise<{ ok: boolean; value?: unknown; error?: string }>((res) => {
      w.onmessage = (e) => res(e.data);
      w.postMessage(bridge.sab);
    });
    if (!r.ok) throw new Error(`seed ${seed} (${policy}): ${r.error}`);
    // The worker has drained every answer, the cancelled calls' included, before it returned; nothing
    // the host does after that touches a slot.
    return { report: String(r.value), ctrl: new Int32Array(bridge.ctrl.slice(0, CTRL_INTS)) };
  } finally {
    w.terminate();
    responder.stop();
    await responder.done;
    URL.revokeObjectURL(url);
  }
}

Deno.test("the ring keeps its invariants under random load", async () => {
  // Several seeds rather than one long run: the interleavings that matter are decided in the
  // first few steps — whether a cancel lands before or after the host takes the slot — and a
  // fresh seed re-rolls those, where a longer run mostly repeats them.
  //
  // What it catches, each with a distinct signature, which is the only evidence that a fuzzer is
  // worth its runtime. **Re-applied and re-measured 2026-10-30, against the protocol of
  // `issues/system/0373d`**, because a list like this is a claim about the present and the protocol
  // under it changed — the previous list was about slot generations, which no longer exist:
  //
  //   a drain that keeps a cancelled   ->  N cancelled call(s) were never answered
  //   call's answer                        The drop is how a cancelled call's row is closed; keeping
  //                                        the answer leaves the row open for good.
  //   a drain that frees no slot       ->  answer for N is 4096 bytes, wanted M
  //                                        The slot stays the drained call's, and the next piece of
  //                                        an oversized answer is never asked for.
  //   `ST_CLAIMED` removed             ->  Offset is outside the bounds of the DataView
  //                                        In both modes: the host takes a slot whose request is
  //                                        still being written, and decodes whatever was there.
  //   either claim of a free slot      ->  nothing; passes, 8 seeds of 8 in both modes.
  //   made a load and a store              What is demonstrated here is that a slot is claimed, not
  //                                        that the claim is atomic. The atomicity is load-bearing —
  //                                        both sides take free slots now, the worker for requests
  //                                        and the host for answers — and a load-then-store loses
  //                                        to the other side in a window of one instruction, which
  //                                        load does not find. `bridge_model.test.ts` walks it and
  //                                        catches the host's: an answer over a claimed request is
  //                                        "call N was lost".
  // Eight seeds in the suite, because it has to cost about a second. `WAC_FUZZ_SEEDS=200`
  // sweeps wider, which is what to reach for after touching anything in `call.ts`,
  // `respond.ts` or `layout.ts` — the fourth bug was at the eighth seed, so eight is a floor
  // rather than a comfortable margin.
  const wide = Number(Deno.env.get("WAC_FUZZ_SEEDS") ?? "0");
  const seeds = wide > 0
    ? Array.from({ length: wide }, (_, i) => 1 + i * 7919)
    : [1, 7, 31, 1009, 12345, 65537, 99991, 2000003];

  // **Both policies.** `off` is production; `seeded` is the only one in which an answer is delayed,
  // which is the window a guard on the answer path needs — see the header. The mutation list was
  // recorded against a run of both.
  for (const [seed, policy] of seeds.flatMap((s) =>
    [[s, "off"], [s, "seeded"]] as [number, "off" | "seeded"][]
  )) {
    const { report, ctrl } = await fuzz(seed, 600, policy);

    // Every slot back to free. A slot still held at the end would mean a message nobody will move
    // on — the leak that fills the ring. A cancelled call's answer included: it is drained and
    // dropped, and its slot comes back with the rest.
    for (let i = 0; i < SLOTS; i++) {
      assertEquals(
        Atomics.load(ctrl, slotAt(i) + S_STATUS),
        ST_FREE,
        `seed ${seed} (${policy}): slot ${i} was not free at the end — ${report}`,
      );
    }
    // A run that cancelled nothing, or chunked nothing, would pass while testing neither.
    const cancels = Number(report.match(/cancelled=(\d+)/)?.[1] ?? 0);
    const chunked = Number(report.match(/chunked=(\d+)/)?.[1] ?? 0);
    assertEquals(cancels > 10, true, `seed ${seed} (${policy}): only ${cancels} cancellations — ${report}`);
    assertEquals(chunked > 3, true, `seed ${seed} (${policy}): only ${chunked} chunked payloads — ${report}`);
  }
});
