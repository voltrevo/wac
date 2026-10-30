// The worker side of the bridge: submit a call, and later collect its answer.
//
// This is what the capability closures are built from. A wac program calls
// `caps.readFile(path)` and the closure behind it submits into a free slot and parks this
// thread until the answer lands. The wac frame stays on the stack throughout and never
// learns that anything waited.
//
// Only ever call these on a worker. `Atomics.wait` throws on a browser's main thread, and
// on Deno's it would block the very thread that has to answer — a deadlock rather than an
// error, which is worse.
//
// **Submitting does not block.** That is the point of the split: a caller may put several
// calls in flight and then wait for whichever finishes first. `hostCall` is a submit
// followed immediately by a collect, and does exactly the same atomics the single-mailbox
// version did — store the payload, publish, park — so nothing that does not overlap pays
// for the ability to.

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
  SLOT_INTS,
  BUF_BYTES,
  releaseBuf,
  attach,
  attached,
  detach,
  S_REQ_BUF,
  S_RES_BUF,
  SLOTS,
  slotAt,
  ST_ANSWERING,
  ST_CLAIMED,
  ST_FREE,
  ST_RUNNING,
  ST_PENDING,
  ST_READY,
  STATUS_ERR,
  STATUS_MORE,
  SUBMIT_SEQ,
} from "./layout.ts";
import { FAULT_OTHER } from "./faults.ts";
import { OP } from "./ops.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Raised when a capability reports failure. The message is the host's. */
/**
 * A capability that failed, with the *category* of the failure beside its message.
 *
 * The category travels because the message cannot be branched on: "No such file or directory (os error
 * 2)" from Deno, "ENOENT: no such file or directory" from Node and `NotFoundError` from OPFS are three
 * spellings of one fact, and a program that wants to say what GNU says about a missing file had to
 * either parse English or print the host's sentence. The mutating side of the world has had a category
 * since `Change` existed; this is the same one, for everything that fails. wac-mono 0062.
 *
 * `FAULT_OTHER` when the host said nothing a classifier could use, which is what an unclassified error
 * has always meant.
 */
export class HostCallError extends Error {
  readonly fault: number;
  constructor(message: string, fault = 5) {
    super(message);
    this.fault = fault;
  }
}

/** Split an error payload into its category byte and its message. */
export function faultedMessage(bytes: Uint8Array): { fault: number; message: string } {
  if (bytes.length === 0) return { fault: 5, message: "" };
  return { fault: bytes[0], message: new TextDecoder().decode(bytes.subarray(1)) };
}

/**
 * What a slot's opcode was, for diagnostics only.
 *
 * Worth the table: the mistake that fills the ring happens several calls before the error, so
 * naming what is *holding* the slots is most of the way to which line was wrong.
 */
const OP_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(OP).map(([name, op]) => [op, name]),
);
export const opName = (op: number): string =>
  op === OP_CONTINUE ? "a continued response" : (OP_NAMES[op] ?? `op ${op}`);

/**
 * A call in flight: the number its request and answer both carry in `S_ID`.
 *
 * **Not a slot**, which it was until `issues/system/0373d`. A slot carries a request only until the host
 * has read it and an answer only until this side has drained it, so a call the host is still working on
 * holds no slot at all — and the number of those a worker may have is not the ring's size, as it was when a
 * `recv` on a quiet connection held its slot until the peer spoke.
 */
export type Ticket = { id: number };

/**
 * What this side of one bridge knows about its calls: which are outstanding, which have answered, and
 * which it gave up on.
 *
 * **In the worker's memory, because draining is what keeps the ring moving.** An answer is copied out of
 * its slot the moment it is seen — by whatever call happens to be waiting, for whichever ticket — and
 * the slot handed straight back, so a slot never waits on the program to get round to collecting. The
 * cost of a ticket nobody collects is a row here, as it is in the native hosts' table, rather than a slot.
 */
type Calls = {
  /** The next call's number. Wraps at 2³¹, long after any call that could share it has gone. */
  next: number;
  /** Submitted and not yet answered, nor given up on. */
  outstanding: Set<number>;
  /** Answered and not yet collected. */
  answered: Map<number, { status: number; bytes: Uint8Array }>;
  /** The pieces so far of an answer too large for one slot. */
  pieces: Map<number, Uint8Array[]>;
  /** Given up on while the host still had them: what arrives for these goes nowhere. */
  dropped: Set<number>;
};

const callsOf = new WeakMap<Bridge, Calls>();

function calls(b: Bridge): Calls {
  let c = callsOf.get(b);
  if (c === undefined) {
    c = { next: 1, outstanding: new Set(), answered: new Map(), pieces: new Map(), dropped: new Set() };
    callsOf.set(b, c);
  }
  return c;
}

/** How many calls this worker has outstanding on `b`, for a caller narrating a stall. */
export function outstandingCalls(b: Bridge): number {
  return calls(b).outstanding.size;
}

/**
 * How many calls this worker gave up on whose answers have not arrived yet — each will take a slot for a
 * moment when it does, until the next drain drops it. For a test asking whether the ring came back clean.
 */
export function droppedCalls(b: Bridge): number {
  return calls(b).dropped.size;
}

/**
 * What every slot in a bridge is doing, for a caller narrating a stall.
 *
 * wac-mono 0082: a child that never finishes leaves the parent with nothing to say beyond "it is still
 * running". The slot table is the answer — a worker blocked in a host call has a slot sitting at
 * `pending` with its opcode in it, and a worker blocked on something else has none.
 *
 * Reads only, and atomically, so it is safe to call at any moment from either side. Never used to decide
 * anything: it prints.
 */
/** How many slots are described individually before the rest are counted. */
const DETAILED = 12;

export function describeSlots(b: Bridge): string {
  // Indexed by the constant's *value*, not by the order they happen to be declared in: `ST_CLAIMED` is
  // 5, not 1, and a table written from the declaration order labelled `ST_RUNNING` as "pending". That is
  // not cosmetic — it inverts the diagnosis, since "pending" means the host has not taken the slot and
  // "running" means it has and the handler never came back. wac-mono 0082 was read backwards for an hour
  // on the strength of it.
  const names: Record<number, string> = {
    [ST_FREE]: "free",
    [ST_PENDING]: "pending",
    [ST_RUNNING]: "running",
    [ST_READY]: "ready",
    [ST_ANSWERING]: "answering",
    [ST_CLAIMED]: "claimed",
  };
  // Detail for the first few, then a tally.
  //
  // The ring is 128 slots now, and four bridges each printing 128 lines is a page of scrollback for a
  // reader looking for one cycle. What a stall report has to answer is *which kinds of call are stuck and
  // where*, and past a handful of identical entries the repetition answers nothing — but the first few
  // carry slot numbers, which is what lets one bridge's report be lined up against another's.
  const busy: string[] = [];
  const rest = new Map<string, number>();
  for (let i = 0; i < SLOTS; i++) {
    const at = slotAt(i);
    const st = Atomics.load(b.ctrl, at + S_STATUS);
    if (st === ST_FREE) continue;
    const op = Atomics.load(b.ctrl, at + S_OP);
    // The handle for the stream operations, because `RECV` on standard input and `RECV` on a spawned
    // child's output are different waits with different causes, and the opcode alone cannot tell them
    // apart. Handle 0 is standard input; anything else counts from 1.
    // The handle, when the request payload is still attached: the host detaches the buffer as it takes
    // the call, so a slot in `running` no longer has one to read. That is the common case in a stall
    // report, and it is why this is a `?` rather than a lookup.
    const rb = attached(b, at, S_REQ_BUF);
    const handle = (op === OP.RECV || op === OP.SEND) && rb >= 0 &&
        Atomics.load(b.ctrl, at + S_REQ_LEN) >= 4
      ? `(h=${new DataView(b.reqBuf(rb).buffer, b.reqBuf(rb).byteOffset, 4).getInt32(0, true)})`
      : "";
    const what = `${names[st] ?? st}:${opName(op)}${handle}`;
    if (busy.length < DETAILED) busy.push(`${i}:${what}`);
    else rest.set(what, (rest.get(what) ?? 0) + 1);
  }
  const counters = `(submit=${Atomics.load(b.ctrl, SUBMIT_SEQ)} done=${Atomics.load(b.ctrl, DONE_SEQ)})`;
  if (busy.length === 0) return `no slot in use ${counters}`;
  const more = [...rest].sort((x, y) => y[1] - x[1]).map(([w, n]) => `${w} × ${n}`);
  return `${busy.join(" ")}${more.length === 0 ? "" : ` and ${more.join(" ")}`} ${counters}`;
}

/**
 * Take a request buffer, waiting for one if the pool is empty.
 *
 * Waiting is safe here and only here: a request buffer is released by the **host** as it takes the call,
 * so a worker parked for one is waiting on the other side, which makes progress on its own. That is the
 * whole reason there are two pools — with one, this wait could be on a buffer only this thread can free.
 */
function takeReqBuf(b: Bridge): number {
  for (;;) {
    const seen = Atomics.load(b.ctrl, DONE_SEQ);
    const i = acquireBuf(b, "req");
    if (i >= 0) return i;
    parkForHost(b, seen);
  }
}

/** Publish a slot's state change and wake the host. */
function ping(b: Bridge): void {
  Atomics.add(b.ctrl, SUBMIT_SEQ, 1);
  Atomics.notify(b.ctrl, SUBMIT_SEQ);
}

/**
 * Park until the host changes something, then look again.
 *
 * **And check the host is still there.** Every wait in this file is a wait on the responder loop, so a
 * loop that has stopped means every one of them is permanent. Answering the outstanding calls does not
 * cover it: a worker parked for a free slot, for a request buffer, or holding a slot it claimed but never
 * published has nothing outstanding to answer, and those parks are exactly the ones that end as a program
 * stopping with no error anywhere. The host sets `HOST_GONE` and bumps `DONE_SEQ`; this is where it lands.
 */
function parkForHost(b: Bridge, seen: number, millis = Infinity): void {
  // Checked on both sides of the wait, and both are needed. After, because the flag can go up while this
  // is parked. *Before*, because it can go up before we park — and then there is nothing left to wake us:
  // the wait would block for ever on a counter nobody will bump again. The window between the two is
  // closed by `seen`, which was read before this call: the host bumps `DONE_SEQ` after raising the flag,
  // so a wait armed with a stale value returns at once rather than sleeping.
  gone(b);
  Atomics.wait(b.ctrl, DONE_SEQ, seen, millis);
  gone(b);
}

/** Raise if the host has stopped answering. */
function gone(b: Bridge): void {
  if (Atomics.load(b.ctrl, HOST_GONE) === 0) return;
  throw new HostCallError(
    "the host stopped answering: this program's capabilities are gone, so the call cannot complete",
    FAULT_OTHER,
  );
}

/**
 * Take a free slot, draining answers to make one if all are busy.
 *
 * **Never a wait on the program.** Every busy slot is on its way back without it: a request until the
 * host reads it, an answer until something here drains it — and `drain` is called right here, so an
 * answer can never be the reason this waits. Until `issues/system/0373d` a slot was held from submission
 * to collection, a quiet connection's `recv` held one for good, and this parked the only thread that could
 * free one; past 128 such calls the program stopped and stayed stopped. What this waits for now is the
 * host to read a request, which it does as it sees one.
 */
function claim(b: Bridge): number {
  for (;;) {
    const seen = Atomics.load(b.ctrl, DONE_SEQ);
    for (let i = 0; i < SLOTS; i++) {
      // Claimed rather than pending: `submit` publishes it as pending once the opcode and
      // payload are in, and until then the host must not take it. A compare-and-exchange because the
      // host takes free slots too, for answers.
      if (Atomics.compareExchange(b.ctrl, slotAt(i) + S_STATUS, ST_FREE, ST_CLAIMED) === ST_FREE) {
        return i;
      }
    }
    if (drain(b) > 0) continue;
    parkForHost(b, seen);
  }
}

/**
 * Copy every answer out of the ring and hand its slot back. Answers how many slots it freed.
 *
 * **Every answer, not the one being waited for**, and that is the property the bridge rests on: a slot
 * holding an answer is freed the next time this side waits for anything, so no slot waits on the program.
 * The answers wait in `Calls.answered` instead, for whoever collects them.
 *
 * An answer too large for one slot comes in pieces. Each is taken here, and the next asked for in the same
 * slot with `OP_CONTINUE` — so that slot stays this call's until the last piece, which the host sends
 * without waiting on anything.
 */
function drain(b: Bridge): number {
  const c = calls(b);
  let freed = 0;
  for (let i = 0; i < SLOTS; i++) {
    const at = slotAt(i);
    if (Atomics.load(b.ctrl, at + S_STATUS) !== ST_READY) continue;
    const op = Atomics.load(b.ctrl, at + S_OP);
    // A pushed piece's acknowledgement is `submit`'s, which is waiting on that slot by number.
    if (op !== OP_ANSWER && op !== OP_CONTINUE) continue;
    const id = Atomics.load(b.ctrl, at + S_ID);
    const status = Atomics.load(b.ctrl, at + S_RES_STATUS);
    const piece = readRes(b, at);
    const kept = !c.dropped.has(id);
    if (status === STATUS_MORE) {
      if (kept) {
        const so = c.pieces.get(id);
        if (so === undefined) c.pieces.set(id, [piece]);
        else so.push(piece);
      }
      // Asked for even when the call was dropped: the host holds the rest, and only a last piece lets it go.
      Atomics.store(b.ctrl, at + S_OP, OP_CONTINUE);
      Atomics.store(b.ctrl, at + S_REQ_LEN, 0);
      Atomics.store(b.ctrl, at + S_STATUS, ST_PENDING);
      ping(b);
      continue;
    }
    const before = c.pieces.get(id);
    c.pieces.delete(id);
    if (kept) c.answered.set(id, { status, bytes: before === undefined ? piece : joined(before, piece) });
    else c.dropped.delete(id);
    release(b, i);
    freed++;
  }
  return freed;
}

function joined(parts: Uint8Array[], last: Uint8Array): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0) + last.length);
  let into = 0;
  for (const p of parts) { out.set(p, into); into += p.length; }
  out.set(last, into);
  return out;
}

/** Park until this slot has an answer — the acknowledgement of a pushed piece, which comes back in it. */
function awaitReady(b: Bridge, slot: number): void {
  const at = slotAt(slot);
  for (;;) {
    const seen = Atomics.load(b.ctrl, DONE_SEQ);
    if (Atomics.load(b.ctrl, at + S_STATUS) === ST_READY) return;
    parkForHost(b, seen);
  }
}

/** Which slot a control offset belongs to — the inline area is indexed by slot, not by buffer. */
function slotOf(at: number): number {
  return (at - slotAt(0)) / SLOT_INTS;
}

/**
 * The answer bytes, copied out, with the buffer handed straight back.
 *
 * The copy is not new — the slot was always reused under the reader — but the release is: a response
 * buffer is the scarce thing now, and holding one a moment longer than the copy is memory somebody else
 * is parked on.
 */
function readRes(b: Bridge, at: number): Uint8Array {
  const len = Atomics.load(b.ctrl, at + S_RES_LEN);
  const bi = attached(b, at, S_RES_BUF);
  // `-1` means the answer is inline rather than absent: small answers never take a pooled buffer, and an
  // answer that could not get one is written inline in pieces.
  const out = (bi < 0 ? b.inline(slotOf(at)) : b.resBuf(bi)).slice(0, len);
  detach(b, at, S_RES_BUF);
  releaseBuf(b, "res", bi);
  // The host may be holding an answer it could not write for want of a buffer; this is what tells it.
  ping(b);
  return out;
}

/** Give the slot back. */
function release(b: Bridge, slot: number): void {
  const at = slotAt(slot);
  // The answer's buffer goes back here too, whatever route got us here. Doing it only in `readRes` left
  // a path leaking one buffer each — an acknowledged push chunk — and a pool that loses one buffer per
  // occurrence is a hang later with nothing to point at. `releaseBuf` ignores -1, so a slot whose answer
  // was already read is unaffected.
  releaseBuf(b, "res", detach(b, at, S_RES_BUF));
  Atomics.store(b.ctrl, at + S_STATUS, ST_FREE);
  // The host may be holding answers for want of a free slot; this is what tells it one is.
  ping(b);
}

/**
 * Start a call. Returns without waiting for it.
 *
 * A payload larger than one slot goes in pieces: each but the last is flagged `OP_PUSH`
 * and answered with an empty acknowledgement, and the handler runs on the last. Both
 * directions have to chunk — a `readFile` of ten megabytes and a `writeFile` of two are
 * the same problem, and until requests chunked, `cp` of a 2MB file reported "cannot write"
 * and blamed the destination for a limit in the transport.
 */
export function submit(b: Bridge, op: number, payload: Uint8Array): Ticket {
  const c = calls(b);
  const id = c.next;
  // Positive and never zero, so a slot no call has written reads as nobody's.
  c.next = c.next >= 0x7fffffff ? 1 : c.next + 1;
  const slot = claim(b);
  const at = slotAt(slot);
  Atomics.store(b.ctrl, at + S_ID, id);

  let sent = 0;
  while (payload.length - sent > BUF_BYTES) {
    // A buffer per piece, released by the host as it reads each one. Holding one across the whole push
    // loop would pin it for the length of a multi-megabyte write, which is the memory this pool exists to
    // stop being reserved.
    const bi = takeReqBuf(b);
    b.reqBuf(bi).set(payload.subarray(sent, sent + BUF_BYTES), 0);
    attach(b, at, S_REQ_BUF, bi);
    Atomics.store(b.ctrl, at + S_OP, OP_PUSH);
    Atomics.store(b.ctrl, at + S_REQ_LEN, BUF_BYTES);
    Atomics.store(b.ctrl, at + S_STATUS, ST_PENDING);
    ping(b);
    awaitReady(b, slot);
    // Read *before* the check, because reading is what hands the buffer back: an acknowledgement carries
    // no bytes but it does carry a buffer, and skipping it leaked one per chunk of every large write.
    const acked = readRes(b, at);
    if (Atomics.load(b.ctrl, at + S_RES_STATUS) === STATUS_ERR) {
      const said = faultedMessage(acked);
      release(b, slot);
      throw new HostCallError(said.message, said.fault);
    }
    sent += BUF_BYTES;   // acknowledged; the host is waiting for the next piece
  }

  const tail = payload.subarray(sent);
  const bi = takeReqBuf(b);
  b.reqBuf(bi).set(tail, 0);
  attach(b, at, S_REQ_BUF, bi);
  Atomics.store(b.ctrl, at + S_OP, op);
  Atomics.store(b.ctrl, at + S_REQ_LEN, tail.length);
  // Outstanding before it is published, so an answer drained the moment it lands has a call to belong to.
  c.outstanding.add(id);
  Atomics.store(b.ctrl, at + S_STATUS, ST_PENDING);
  ping(b);
  return { id };
}

/** Whether the answer has landed. Never blocks. */
export function isDone(b: Bridge, t: Ticket): boolean {
  drain(b);
  const c = calls(b);
  // A ticket collected or cancelled counts as done: there is nothing left to wait for.
  return c.answered.has(t.id) || !c.outstanding.has(t.id);
}

/**
 * Park until any of these has an answer, and say which.
 *
 * The wait is on `DONE_SEQ` rather than on a slot, because `Atomics.wait` takes one
 * address: every completion bumps that counter and the waiter rescans. This is also what
 * `poll` over sockets is — submit a `recv` on each and wait for whichever speaks first.
 */
export function waitAny(b: Bridge, tickets: Ticket[], millis = -1): Ticket | null {
  if (tickets.length === 0) return null;
  // `Atomics.wait` takes a timeout, so a deadline needs nothing from the host: no opcode, no
  // slot, and nothing to clean up afterwards. A timer *ticket* would need all three, and the
  // ticket nobody remembers to cancel is how the ring fills up.
  const deadline = millis < 0 ? Infinity : performance.now() + millis;
  const c = calls(b);
  for (;;) {
    const seen = Atomics.load(b.ctrl, DONE_SEQ);
    // Drained once a pass, not once a ticket: a server waits on thousands, and `isDone` scans the ring.
    drain(b);
    for (const t of tickets) if (c.answered.has(t.id) || !c.outstanding.has(t.id)) return t;
    // Checked after the scan, so a deadline of 0 is a poll of the set rather than a wait that
    // always fails, and an already-settled ticket is reported even when the time is up.
    const left = deadline - performance.now();
    if (left <= 0) return null;
    parkForHost(b, seen, left);
  }
}

/**
 * Wait for this call and take its answer.
 *
 * A response too large for one slot arrives in pieces, which `drain` gathers; by the time a call is
 * answered here its answer is whole.
 */
export function collect(b: Bridge, t: Ticket): Uint8Array {
  const c = calls(b);
  if (!c.outstanding.has(t.id) && !c.answered.has(t.id)) {
    throw new HostCallError("this call was already collected or cancelled");
  }
  for (;;) {
    const seen = Atomics.load(b.ctrl, DONE_SEQ);
    drain(b);
    const got = c.answered.get(t.id);
    if (got !== undefined) {
      c.answered.delete(t.id);
      c.outstanding.delete(t.id);
      if (got.status === STATUS_ERR) {
        const said = faultedMessage(got.bytes);
        throw new HostCallError(said.message, said.fault);
      }
      return got.bytes;
    }
    parkForHost(b, seen);
  }
}

/**
 * Stop caring about a call.
 *
 * **Detach, not abort.** The host may already be inside the work and cannot generally be
 * interrupted; only where the underlying API takes an `AbortSignal` does anything actually
 * stop. What this guarantees is that the answer is discarded, which is what a caller that has
 * given up needs.
 *
 * **Nothing to tell the host**, because the call holds nothing of the bridge's while it is outstanding:
 * not a slot, which it did until `issues/system/0373d`, and not a buffer. The answer is dropped as it is
 * drained, and that frees the slot it came in.
 */
export function cancel(b: Bridge, t: Ticket): void {
  const c = calls(b);
  if (c.answered.delete(t.id)) { c.outstanding.delete(t.id); return; }
  if (!c.outstanding.delete(t.id)) return;                             // already gone
  c.dropped.add(t.id);
}

/** Submit and collect, which is what a capability with no reason to overlap does. */
export function hostCall(b: Bridge, op: number, payload: Uint8Array): Uint8Array {
  return collect(b, submit(b, op, payload));
}

// ── Payload encoding ──────────────────────────────────────────────────────────
// Each capability decides its own shape; these are the pieces they are built from.
// Deliberately plain — the bridge moves bytes, and a capability that needs structure
// spells it out rather than inheriting a serialisation format nobody chose.

export const str = (s: string): Uint8Array => enc.encode(s);

/**
 * An argument as bytes, whichever shape the host was given.
 *
 * A launcher has strings — `Deno.args` is text by the time the runtime hands it over — and a *parent*
 * spawning a child has the exact bytes. Both are accepted, and only the string is encoded, so nothing that
 * arrived as bytes is round-tripped through UTF-8. wac-mono 0065.
 */
export const argBytes = (a: string | Uint8Array): Uint8Array =>
  typeof a === "string" ? enc.encode(a) : a;

/** An empty argument, for an index nobody passed. */
export const EMPTY_ARG = new Uint8Array(0);
export const unstr = (b: Uint8Array): string => dec.decode(b);

export function i32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n, true);
  return b;
}

export function readI32le(b: Uint8Array, at = 0): number {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getInt32(at, true);
}

export function i64le(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, n, true);
  return b;
}

export function readI64le(b: Uint8Array, at = 0): bigint {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getBigInt64(at, true);
}
