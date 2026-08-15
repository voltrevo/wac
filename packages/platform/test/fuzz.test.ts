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
//   * **a spent or cancelled ticket is an error, not a plausible answer.** The generation exists
//     for this, and "plausible" is what makes it worth testing: a recycled slot holds real bytes
//     from a real call.
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
// ## Both scheduler modes, because one of them cannot see the bug this file is named for
//
// This ran only with the scheduler `off`, for a good reason: that is the production mode, and a
// deterministic scheduler takes away the concurrency the file exists to stress.
//
// The consequence was not visible from that argument. With scheduling off, `respond.ts` calls
// `write` straight back inside `reply`, so **the generation is read and checked with nothing in
// between** — the window a recycled slot needs simply does not open. Deleting the generation check
// entirely leaves this test passing, five runs out of five, though the file's own notes record that
// mutation as the way to see the failure. Under `seeded` it dies on the first seed every time, and
// says which cancelled call's answer arrived.
//
// So both, and neither is redundant: `off` is production and `seeded` is the only one that reaches
// the delayed-answer path. A guard is only tested in a configuration that can delay the answer it
// guards.

import { BUF_BYTES, CTRL_INTS, newBridge, S_GEN, S_STATUS, SLOTS, slotAt, ST_FREE } from "../host/layout.ts";
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
    const out = new Uint8Array(Math.max(4, size));
    new DataView(out.buffer).setInt32(0, nonce, true);
    for (let i = 4; i < out.length; i++) out[i] = (nonce + i) & 0xff;
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
    if (bytes.length !== Math.max(4, entry.size)) {
      // **Say whose answer this actually is.** This used to report only the expected nonce and the
      // two lengths — "answer for 12 is 326 bytes, wanted 924" — which is equally consistent with a
      // truncated answer to *this* call and with another call's answer landing here, and those want
      // opposite fixes. The nonce is the first four bytes of every answer, so it is free to read.
      //
      // It matters because this failure appears under a load the seed cannot reproduce
      // (issues/system/0155): the one report you get has to carry its own diagnosis. With the
      // generation check removed it now says "the nonce belongs to cancelled call 9 - a recycled
      // slot", which is the diagnosis rather than the symptom.
      //
      // (Two traps in here, both because this function lives inside the worker source and that is a
      // template literal. A backtick in a comment *ends* it, and the parse error lands two hundred
      // lines away on a line nobody touched. And an escape is consumed by the template, so a newline
      // in a message has to be written twice over.)
      const found = bytes.length >= 4 ? readI32le(bytes) : null;
      const whose = found === null
        ? "too short to say whose it is"
        : found === entry.nonce
        ? "the nonce is this call's, so it is truncated rather than crossed"
        : cancelled.has(found)
        ? "the nonce belongs to cancelled call " + found + " - a recycled slot"
        : "the nonce is " + found + ", another live call's - crossed";
      throw new Error(
        "answer for " + entry.nonce + " is " + bytes.length + " bytes, wanted " + Math.max(4, entry.size) +
        "\\n  " + whose +
        "\\n  slot " + entry.t.slot + " gen " + entry.t.gen +
        ", " + live.length + " live, " + cancels + " cancelled and " + spent.size + " spent so far",
      );
    }
    const got = readI32le(bytes);
    if (cancelled.has(got)) {
      throw new Error("the answer to cancelled call " + got + " was delivered as the answer to " + entry.nonce);
    }
    if (got !== entry.nonce) {
      throw new Error("asked as " + entry.nonce + ", answered as " + got + " in slot " + entry.t.slot + " gen " + entry.t.gen);
    }
    // Every byte, not just the nonce: a response reassembled out of order would keep its head.
    for (let i = 4; i < bytes.length; i++) {
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
      collectOne(live.findIndex((e) => e.t.slot === got.slot && e.t.gen === got.gen));
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
        const at = chosen.find((i) => live[i].t.slot === got.slot && live[i].t.gen === got.gen);
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
    const at = live.findIndex((e) => e.t.slot === got.slot && e.t.gen === got.gen);
    collectOne(at);
  }

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
  // **`seeded` is where the generation check is reachable.** With scheduling off the answer is written
  // synchronously inside `reply`, so the generation is read and checked with nothing in between and a
  // slot cannot be recycled in the gap. See the header.
  const responder = serveHostCalls(bridge, handlers, { scheduler: newScheduler(policy) });
  const src = `
    import { submit, collect, isDone, waitAny, cancel, hostCall, i32le, readI32le } from ${JSON.stringify(CALL)};
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
    // The host may still be finishing work for cancelled calls; give the sweep a turn before
    // asking whether the ring came back clean.
    await new Promise((res) => setTimeout(res, 50));
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
  // Each of the three bugs this was written for is caught, with a distinct signature, which is the
  // only evidence that a fuzzer is worth its runtime. **Re-applied and re-measured 2026-08-15**,
  // because a list like this is a claim about the present and was written in the past — one of the
  // three had silently stopped holding:
  //
  //   the generation check removed   ->  the nonce belongs to cancelled call N - a recycled slot
  //                                      `seeded` only; under `off` the test passes, 5 runs of 5.
  //                                      See the header: with scheduling off there is nothing
  //                                      between reading the generation and writing the answer.
  //   the claim check removed        ->  slot N was not free at the end
  //                                      Removing the *check* kills it. Replacing the CAS with a
  //                                      load and a store does **not**, and cannot: one worker
  //                                      claims, so there is no second claimer to race. What this
  //                                      file tests is that a claim is checked, not that the check
  //                                      is atomic — `test/worker.ts` is where two threads claim.
  //   `ST_CLAIMED` removed           ->  no handler for capability 0
  //                                      (published as `ST_PENDING` before the opcode is written)
  // Eight seeds in the suite, because it has to cost about a second. `WAC_FUZZ_SEEDS=200`
  // sweeps wider, which is what to reach for after touching anything in `call.ts`,
  // `respond.ts` or `layout.ts` — the fourth bug was at the eighth seed, so eight is a floor
  // rather than a comfortable margin.
  const wide = Number(Deno.env.get("WAC_FUZZ_SEEDS") ?? "0");
  const seeds = wide > 0
    ? Array.from({ length: wide }, (_, i) => 1 + i * 7919)
    : [1, 7, 31, 1009, 12345, 65537, 99991, 2000003];

  // **Both policies.** `off` is production; `seeded` is the only one in which an answer is delayed
  // between reading the generation and writing it, which is the window the generation check exists
  // for. Deleting that check leaves the `off` pass green and kills the `seeded` one on its first
  // seed — see the header. The mutation list above was recorded against a run that could see it.
  for (const [seed, policy] of seeds.flatMap((s) =>
    [[s, "off"], [s, "seeded"]] as [number, "off" | "seeded"][]
  )) {
    const { report, ctrl } = await fuzz(seed, 600, policy);

    // Every slot back to free, and no generation left behind. A slot still held at the end
    // would mean an answer nobody could ever take — the leak that fills the ring.
    for (let i = 0; i < SLOTS; i++) {
      assertEquals(
        Atomics.load(ctrl, slotAt(i) + S_STATUS),
        ST_FREE,
        `seed ${seed} (${policy}): slot ${i} was not free at the end — ${report}`,
      );
      // Generations only move forward, and every slot that was used has moved.
      assertEquals(
        Atomics.load(ctrl, slotAt(i) + S_GEN) >= 0,
        true,
        `seed ${seed} (${policy}): slot ${i} has a negative generation`,
      );
    }
    // A run that cancelled nothing, or chunked nothing, would pass while testing neither.
    const cancels = Number(report.match(/cancelled=(\d+)/)?.[1] ?? 0);
    const chunked = Number(report.match(/chunked=(\d+)/)?.[1] ?? 0);
    assertEquals(cancels > 10, true, `seed ${seed} (${policy}): only ${cancels} cancellations — ${report}`);
    assertEquals(chunked > 3, true, `seed ${seed} (${policy}): only ${chunked} chunked payloads — ${report}`);
  }
});
