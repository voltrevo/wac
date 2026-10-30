// The main-thread side of the bridge: answer host calls without ever blocking.
//
// `Atomics.waitAsync` is the counterpart to the worker's `Atomics.wait` — it returns a
// promise rather than parking the thread, so the event loop keeps running and the
// asynchronous work a capability needs can actually happen. A main thread that blocked
// here would deadlock against the worker waiting on it.
//
// **The loop dispatches and does not await.** It used to `await` each handler before
// looking at the next request, which serialised everything regardless of what the
// transport could carry — and with a ring of slots that would have made the ring
// pointless. A request is read, its slot handed back, its handler started, and the loop goes
// straight back to watching. Completion puts the answer in whichever slot is free and bumps
// `DONE_SEQ`.
//
// **A call holds no slot while its handler runs** — `issues/system/0373d`. It held the slot it came in
// until it was collected, so a `recv` on a connection that never spoke held one for good, and past 128 of
// those every other call parked the worker for ever. Now a call between its request and its answer is a
// row in this file's memory, as it is in the native hosts' ticket table, and the ring carries messages
// only: a request until it is read here, an answer until the worker drains it.
//
// Several of these may run at once, one per worker. Nothing here is global — which is also
// why each worker needs its *own* handler table: the capability worlds close over the
// current input, the current output and the socket map, and one table shared between two
// workers would hand one of them the other's socket.

import {
  type Bridge,
  DONE_SEQ,
  HOST_GONE,
  OP_ANSWER,
  OP_CONTINUE,
  OP_PUSH,
  S_ID,
  S_OP,
  S_REQ_LEN,
  S_RES_LEN,
  S_RES_STATUS,
  S_STATUS,
  acquireBuf,
  INLINE_BYTES,
  releaseBuf,
  attach,
  detach,
  S_REQ_BUF,
  S_RES_BUF,
  SLOTS,
  slotAt,
  ST_ANSWERING,
  ST_FREE,
  ST_PENDING,
  ST_READY,
  ST_RUNNING,
  STATUS_ACK,
  STATUS_ERR,
  STATUS_MORE,
  STATUS_OK,
  SUBMIT_SEQ,
} from "./layout.ts";
import { FAULT_OTHER, faultedBytes, faultOf } from "./faults.ts";
import { type Scheduler, scheduler } from "./schedule.ts";
import { describeSlots } from "./call.ts";

/** What a capability does with a request payload. May be async; that is the point. */
export type Handler = (payload: Uint8Array) => Uint8Array | Promise<Uint8Array>;

/** Capability implementations by opcode. */
export type Handlers = Record<number, Handler>;

const EMPTY = new Uint8Array(0);


/** Labels bridges in the scheduler's log, so a recorded run can be read. */
let nextBridgeId = 0;

function joined(parts: Uint8Array[], last: Uint8Array): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0) + last.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  out.set(last, at);
  return out;
}

/**
 * Serve host calls until `stop()` is called or the signal aborts.
 *
 * A response larger than a slot is handed over in pieces: what fits goes now with
 * `STATUS_MORE`, and the rest waits for the worker's `OP_CONTINUE`. The remainder is held
 * here rather than in the worker so a caller that abandons a call cannot leak it.
 */
export function serveHostCalls(
  b: Bridge,
  handlers: Handlers,
  opts: { signal?: AbortSignal; scheduler?: Scheduler } = {},
): { stats(): { running: boolean; sweeps: number }; stop(): void; done: Promise<void> } {
  let running = true;

  // The scheduler is shared by every bridge in this process, because the orderings worth exploring are
  // *between* a shell and the applets it spawned, not within one of them. The id only labels the log.
  // The process-wide one unless the caller brings its own. A test *about* the concurrent ring has to
  // bring `newScheduler("off")`: scheduling exists to remove the interleavings, and removing them is
  // exactly what such a test must not have done to it. See design/0001 D12's note on the testing gap.
  const sched = opts.scheduler ?? scheduler();
  const bridgeId = nextBridgeId++;
  // Registered so a stall anywhere can ask every bridge what it is doing — a shell parked reading a child
  // explains nothing without the child's side of it.
  //
  // The description says whether this bridge is still being served, because the interesting stall is a
  // worker parked against a host that stopped: `stop()` takes the bridge out of the survey, but a loop
  // that *died* leaves it in, and a slot table with no note would read as an ordinary busy bridge.
  sched.register(bridgeId, () =>
    `${running ? "" : "responder stopped — "}${describeSlots(b)}` +
    (outbox.length > 0 ? ` and ${outbox.length} answer(s) waiting for a free slot` : "")
  );

  /** The rest of an answer too large for the slot it went out in, by call, until `OP_CONTINUE` asks. */
  const tails = new Map<number, { tail: Uint8Array; status: number }>();
  /** An oversized request's pieces so far, by the slot they arrive in — it is held for all of them. */
  const partial: Uint8Array[][] = Array.from({ length: SLOTS }, () => []);
  /**
   * Answers waiting for a free slot, oldest first.
   *
   * **Unbounded, and that is what makes it safe.** An answer that cannot be written waits here rather than
   * in a slot, and every slot it could go in is on its way back without help from this side: the worker
   * drains answers whenever it waits for anything. So nothing here waits on the program, and the program
   * never waits on this.
   */
  const outbox: { id: number; status: number; body: Uint8Array }[] = [];

  /**
   * Write a message into `slot`, in a pooled buffer when one is free and inline when not, and publish it.
   *
   * `op` says which kind the worker will find: `OP_ANSWER` for an answer in a slot taken for it,
   * `OP_CONTINUE` for the next piece of one in the slot that asked, `OP_PUSH` for the acknowledgement of a
   * pushed request piece. The slot is this side's throughout — `ST_ANSWERING` or `ST_RUNNING` — so the
   * publish is a store: nothing else moves a slot out of either.
   *
   * **Never fails for want of a buffer.** An earlier version deferred instead, and deadlocked: the
   * buffers are held by answers the worker has not drained, and a worker parked on one specific call
   * drained nothing, so the call it waited for never landed. Inline is the guarantee; the pool is speed.
   */
  const write = (slot: number, id: number, op: number, status: number, body: Uint8Array): void => {
    const at = slotAt(slot);
    // A pooled buffer if one is free, the slot's own inline area otherwise. The tail, if the chosen room
    // cannot hold it all, goes through the same `STATUS_MORE` path an oversized answer always used.
    const bi = body.length > INLINE_BYTES ? acquireBuf(b, "res") : -1;
    const room = bi >= 0 ? b.resBuf(bi) : b.inline(slot);
    const fits = Math.min(body.length, room.length);
    const tail = body.subarray(fits);
    room.set(body.subarray(0, fits), 0);
    attach(b, at, S_RES_BUF, bi);
    Atomics.store(b.ctrl, at + S_RES_LEN, fits);
    Atomics.store(b.ctrl, at + S_RES_STATUS, tail.length > 0 ? STATUS_MORE : status);
    // Remembered here, and asked for with `OP_CONTINUE`; `status` so the last piece carries the real
    // answer status rather than `STATUS_MORE`.
    if (tail.length > 0) tails.set(id, { tail, status });
    Atomics.store(b.ctrl, at + S_ID, id);
    Atomics.store(b.ctrl, at + S_OP, op);
    // The last store, because it is what makes the rest visible: the worker reads a slot only after
    // seeing `ST_READY`.
    Atomics.store(b.ctrl, at + S_STATUS, ST_READY);
    Atomics.add(b.ctrl, DONE_SEQ, 1);
    Atomics.notify(b.ctrl, DONE_SEQ);
  };

  /** Where the scan for a free slot starts, so answers spread over the ring rather than crowding slot 0. */
  let next = 0;

  /** Put waiting answers in free slots, oldest first, until either runs out. */
  const flush = (): void => {
    while (outbox.length > 0) {
      let slot = -1;
      for (let k = 0; k < SLOTS && slot < 0; k++) {
        const i = (next + k) % SLOTS;
        // A compare-and-exchange, because the worker takes free slots too, for requests.
        if (Atomics.compareExchange(b.ctrl, slotAt(i) + S_STATUS, ST_FREE, ST_ANSWERING) === ST_FREE) slot = i;
      }
      if (slot < 0) return;   // all in use; the worker's next drain frees some, and pings to say so
      next = (slot + 1) % SLOTS;
      const a = outbox.shift()!;
      write(slot, a.id, OP_ANSWER, a.status, a.body);
    }
  };

  /**
   * Answer call `id`, whichever slot is free when it is written.
   *
   * **Through the scheduler**, which with scheduling off calls this straight back — the path the host
   * has always taken. With it on, the answer joins a ready set and the scheduler decides which one
   * lands next, so the order the whole system runs in is chosen rather than raced for. See
   * `schedule.ts`, and design/0001 D12 for what that can and cannot promise.
   */
  const answer = (id: number, status: number, body: Uint8Array): void => {
    sched.ready(bridgeId, id, () => {
      outbox.push({ id, status, body });
      flush();
    });
  };

  /** Answer in `slot` itself: the next piece of an answer, or a pushed piece's acknowledgement. */
  const inPlace = (slot: number, id: number, op: number, status: number, body: Uint8Array): void => {
    sched.ready(bridgeId, id, () => write(slot, id, op, status, body));
  };

  const take = (slot: number): void => {
    const at = slotAt(slot);
    const op = Atomics.load(b.ctrl, at + S_OP);
    const len = Atomics.load(b.ctrl, at + S_REQ_LEN);
    const id = Atomics.load(b.ctrl, at + S_ID);
    // Copied out and the buffer released immediately: a request buffer is held for exactly one read, so
    // a worker parked for one waits on this line and nothing else.
    const rb = detach(b, at, S_REQ_BUF);
    const payload = rb < 0 ? EMPTY : b.reqBuf(rb).slice(0, len);
    releaseBuf(b, "req", rb);

    // Taken with a compare-and-exchange, not a store: `failPending` may have taken it already.
    if (Atomics.compareExchange(b.ctrl, at + S_STATUS, ST_PENDING, ST_RUNNING) !== ST_PENDING) return;

    if (op === OP_CONTINUE) {
      // The status the *whole* answer had, kept from the first piece: a failure delivered in two pieces is
      // still a failure, and sending the tail as `STATUS_OK` would turn it into a successful empty answer.
      const held = tails.get(id);
      tails.delete(id);
      inPlace(slot, id, OP_CONTINUE, held?.status ?? STATUS_OK, held?.tail ?? EMPTY);
      return;
    }
    // A piece of an oversized request, held here rather than in the worker for the same
    // reason the response tail is.
    if (op === OP_PUSH) {
      partial[slot].push(payload);
      inPlace(slot, id, OP_PUSH, STATUS_ACK, EMPTY);
      return;
    }

    let whole: Uint8Array = payload;
    if (partial[slot].length > 0) {
      whole = joined(partial[slot], payload);
      partial[slot] = [];
    }

    // **The slot goes back now, before the work starts.** The request is in hand, and the answer goes in
    // whichever slot is free when it lands — so however long the handler takes, it holds nothing of the
    // ring. The worker may be parked for a slot; this is what wakes it.
    Atomics.store(b.ctrl, at + S_STATUS, ST_FREE);
    Atomics.add(b.ctrl, DONE_SEQ, 1);
    Atomics.notify(b.ctrl, DONE_SEQ);

    const h = handlers[op];
    if (h === undefined) {
      answer(id, STATUS_ERR, faultedBytes(FAULT_OTHER, `no handler for capability ${op}`));
      return;
    }
    // Dispatched, not awaited: the loop goes back to watching immediately, so a slow
    // capability does not hold up the others. A call the worker has given up on is answered all the same,
    // and the worker drops the answer as it drains it — the host is not told, because there is nothing of
    // the bridge's for it to free.
    void (async () => {
      try {
        answer(id, STATUS_OK, await h(whole));
      } catch (e) {
        // The worker turns this into a thrown HostCallError, so a capability failing is
        // an error in wac's caller rather than a silent wrong answer.
        // Classified *here*, once, rather than at each of the forty handlers: `faultOf` reads the
        // host's own exception, and every capability's failure gains a category for free. wac-mono 0062.
        answer(id, STATUS_ERR, faultedBytes(faultOf(e), e instanceof Error ? e.message : String(e)));
      }
    })();
  };

  /** Sweeps completed, so a stalled caller can tell a parked responder from a dead one. */
  let sweeps = 0;

  /**
   * Answer every slot still waiting on this side, so a parked worker learns rather than waits.
   *
   * A worker in `Atomics.wait` is waiting for *this* loop and nothing else. If the loop stops — an
   * exception, or a bug that lets it park with work outstanding — the worker waits for ever, and what
   * that looks like from outside is a test that hangs with no message anywhere. wac-mono 0082 spent
   * three days as that shape. A failure the worker can see is worth more than a tidy stack trace here.
   */
  const failPending = (why: string): void => {
    // The flag first, and it is the part that actually covers everything. A worker can be parked with no
    // slot to answer at all — waiting for an answer to a call that holds none, for a free slot, for a
    // request buffer, or holding a slot it claimed and never published — and those parks are woken by
    // nothing but this. See `HOST_GONE`.
    Atomics.store(b.ctrl, HOST_GONE, 1);

    // The slots a request is waiting in: one not yet read, and one answered in place — a pushed piece, or
    // the next piece of an answer. Calls whose handlers are running hold no slot; `HOST_GONE` is theirs.
    for (let s = 0; s < SLOTS; s++) {
      const at = slotAt(s);
      const st = Atomics.load(b.ctrl, at + S_STATUS);
      if (st === ST_PENDING) {
        if (Atomics.compareExchange(b.ctrl, at + S_STATUS, ST_PENDING, ST_RUNNING) !== ST_PENDING) continue;
        // Taken without being read, so the request buffer has to go back here — `take` is what normally
        // frees one, and this path skips it. A buffer lost this way is not a lost byte, it is one of
        // eight that a later worker parks on, in a call with nothing to do with this shutdown.
        releaseBuf(b, "req", detach(b, at, S_REQ_BUF));
      } else if (st !== ST_RUNNING) {
        // Claimed but not published: the worker is mid-fill and writing into the slot would race with it.
        // `HOST_GONE` is what reaches that one.
        continue;
      }
      try {
        const op = Atomics.load(b.ctrl, at + S_OP);
        write(s, Atomics.load(b.ctrl, at + S_ID), op === OP_PUSH ? OP_PUSH : OP_ANSWER, STATUS_ERR,
              faultedBytes(FAULT_OTHER, why));
      } catch {
        // Nothing better to do: the bridge is already in a state we are explaining.
      }
    }

    // And wake whatever is parked, since some of those waits have no answer to arrive.
    Atomics.add(b.ctrl, DONE_SEQ, 1);
    Atomics.notify(b.ctrl, DONE_SEQ);
  };

  const loop = async (): Promise<void> => {
    while (running && !opts.signal?.aborted) {
      // Loaded *before* the sweep, which is the same discipline the whole file uses:
      // anything arriving after this load changes the value, so the wait below returns
      // immediately rather than sleeping through it. Loading it after the sweep instead
      // made every call cost two turns of the event loop rather than one.
      const seen = Atomics.load(b.ctrl, SUBMIT_SEQ);
      for (let s = 0; s < SLOTS; s++) {
        if (Atomics.load(b.ctrl, slotAt(s) + S_STATUS) === ST_PENDING) take(s);
      }
      // Answers that found the ring full go in the slots the worker has drained since — it pings when it
      // frees one, which is what woke this.
      flush();
      sweeps++;
      // The worker has come back: whatever it was answered with, it is parked again. That is the signal
      // the scheduler waits on before letting another worker run — see `schedule.ts`.
      sched.quiet(bridgeId);
      const w = Atomics.waitAsync(b.ctrl, SUBMIT_SEQ, seen);
      if (w.async) await w.value;
      if (!running || opts.signal?.aborted) return;
    }
  };

  // **A responder that dies must not leave its worker parked.** `loop()`'s promise is not awaited by
  // most callers, so a rejection here used to disappear: the loop stopped, the slots stayed pending, and
  // the worker waited for an answer that could no longer come. Now the failure reaches the worker as a
  // failed host call — which a program reports in its own words — and is said out loud besides.
  const done = loop().catch((e: unknown) => {
    const why = `the host responder stopped: ${e instanceof Error ? e.message : String(e)}`;
    try {
      console.error(`wac: ${why}`);
    } catch {
      // A closed stderr is not a reason to skip the part that unparks the worker.
    }
    failPending(why);
    throw e;
  });
  return {
    /** Whether the loop is still going, and how many sweeps it has made. For a caller narrating a stall. */
    stats() {
      return { running, sweeps };
    },
    stop() {
      running = false;
      // Every outstanding call fails, and the flag goes up. A clean stop used to answer nothing: the loop
      // returned, and a worker still parked on a call — or on a slot, or on a buffer — waited for a host
      // that had gone. Stopping a responder while a worker is alive is what tearing down a child *is*, so
      // this is the ordinary path, not the exceptional one.
      failPending("the host responder was stopped");
      sched.quiet(bridgeId);
      sched.forget(bridgeId);
      // Wake the loop so it can notice. Bumping the counter it waits on is the only way
      // in: it is parked on a value, not on a flag.
      Atomics.add(b.ctrl, SUBMIT_SEQ, 1);
      Atomics.notify(b.ctrl, SUBMIT_SEQ);
    },
    done,
  };
}
