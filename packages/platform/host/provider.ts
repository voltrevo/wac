// Worker side: turn a bridge into the capability structs a wac application receives.
//
// Every closure here is created **once per application**, never per call. bindgen
// registers each distinct function identity in a fixed table of sixteen per signature and
// never frees a slot, so a fresh closure per call dies on the seventeenth with a
// `RangeError` a long way from its cause. `packages/stream` hit this and its README says
// the same thing: hold stable functions and put the varying part in their arguments.
//
// That rule is why a ticket carries an `i32` and three *shared* resolvers rather than a
// closure over its own answer. Every `readFile` in a program hands back the same three
// functions with a different number in front of them.
//
// A ticket's number is its slot and its generation packed together, so nothing has to be
// kept in a table here and a ticket dropped on the floor leaks nothing on this side. Four
// slots is two bits; the generation takes the rest.

import { type Bridge, SLOTS } from "./layout.ts";
import {
  cancel,
  collect,
  // The same function under a second name, so `cliOf` can shadow `collect` for a narrowed world
  // and still reach the real one. `issues/system/0242c`.
  collect as realCollect,
  hostCall,
  HostCallError,
  i32le,
  isDone,
  waitAny,
  readI32le,
  readI64le,
  str,
  submit,
  type Ticket,
  unstr,
} from "./call.ts";
import { GRANT_ENV, GRANT_NET, GRANT_READ, GRANT_RUN, GRANT_WRITE, OP } from "./ops.ts";
import { asAppModule, drive, manifestIn } from "./driver.ts";
import type { Driven } from "./driver.ts";
/** One export's wac signature, as the manifest records it — `Manifest.exports` in `native.ts`. */
type ExportSig = { name: string; params: string[]; ret: string };
import { FAULT_NONE, FAULT_NOT_GRANTED, FAULT_OTHER, STAT_EXEC } from "./faults.ts";

const EMPTY = new Uint8Array(0);
const SLOT_BITS = Math.ceil(Math.log2(SLOTS));
const SLOT_MASK = (1 << SLOT_BITS) - 1;

const pack = (t: Ticket): number => t.slot | (t.gen << SLOT_BITS);
const unpack = (id: number): Ticket => ({ slot: id & SLOT_MASK, gen: id >>> SLOT_BITS });

/** The generated classes this needs from a module that imports `platform.wac`. */
export type PlatformClasses = {
  Core: { of(...caps: unknown[]): unknown };
  Cli: { of(...caps: unknown[]): unknown };
  FileResult: { of?(...a: unknown[]): unknown };
  /**
   * The world's scheduler, which the host **builds** rather than implements.
   *
   * Every other field of a capability is a function this side supplies; this one is a wac value with
   * wac logic on it — `Core.delay`, `Core.drain` and `Core.dropAll` are methods over it. All the host
   * does is call `create` once, so a program is handed a scheduler the same way it is handed a
   * filesystem: because the world had one to give.
   */
  Sched: { create(): unknown };
};

/** One monomorphised `Pending<T>`. bindgen names them `Pending$FileResult` and so on. */
type PendingClass = { of(id: number, resolve: unknown, settled: unknown, drop: unknown): unknown };

/** Every `Pending<T>` the world hands out. */
export type PendingClasses = {
  Pending$i32: PendingClass;
  Pending$i64: PendingClass;
  Pending$string: PendingClass;
  Pending$stringOpt: PendingClass;
  Pending$u8ArrOpt: PendingClass;
  Pending$u8Arr: PendingClass;
  Pending$bool: PendingClass;
  Pending$stringArrOpt: PendingClass;
  Pending$FileResult: PendingClass;
  Pending$Stat: PendingClass;
  Pending$Socket: PendingClass;
  Pending$Child: PendingClass;
  Pending$Captured: PendingClass;
  Pending$Read: PendingClass;
  Pending$Change: PendingClass;
  Pending$Datagram: PendingClass;
  Pending$Exec: PendingClass;
};

/**
 * `Core`, built from the bridge.
 *
 * `log` and `warn` hand back nothing. A ticket for a line of output would be noise at
 * every call site for a capability no program will overlap, and the world keeps writes to
 * one destination in order anyway, so a caller loses nothing by not being able to wait.
 */
export function coreOf(
  b: Bridge,
  cls: { Core: PlatformClasses["Core"]; Sched: PlatformClasses["Sched"] } & PendingClasses,
): unknown {
  const settled = (id: number) => isDone(b, unpack(id));
  const drop = (id: number) => { cancel(b, unpack(id)); };
  const i64 = (id: number) => readI64le(collect(b, unpack(id)));
  const bytes = (id: number) => collect(b, unpack(id));

  const asI64 = (t: Ticket) => cls.Pending$i64.of(pack(t), i64, settled, drop);
  const asBytes = (t: Ticket) => cls.Pending$u8Arr.of(pack(t), bytes, settled, drop);

  return cls.Core.of(
    /*= nowMillis */
    () => asI64(submit(b, OP.NOW_MILLIS, EMPTY)),
    /*= monotonicNanos */
    () => asI64(submit(b, OP.MONOTONIC_NANOS, EMPTY)),
    /*= sleepMillis */
    (ms: number) => asI64(submit(b, OP.SLEEP_MILLIS, i32le(ms))),
    /*= randomBytes */
    (n: number) => asBytes(submit(b, OP.RANDOM_BYTES, i32le(n))),
    /*= log */
    // Submitted *and collected*. A bare submit claims a slot the worker never gives
    // back, so four log lines exhausted the ring and the fifth call parked forever —
    // which showed up as `ls .` failing while `ls somefile` worked, because only the
    // former reached a log loop.
    (line: string) => { hostCall(b, OP.LOG, str(line)); },
    /*= warn */
    (line: string) => { hostCall(b, OP.WARN, str(line)); },

    /*= waitAny */
    // No opcode, and no slot: the wait is on the completion counter in this worker's own
    // memory, and the deadline is `Atomics.wait`'s own timeout, so the host is not involved at
    // all. Returns the *index* rather than the id, because the caller already knows which
    // ticket it put where, and -1 when nothing settled in time.
    //
    // In `Core` because it grants nothing — it cannot start work, only notice that some has
    // finished. It began on `Cli`, which left an interactive page unable to wait on a click or
    // a dropped file, and that is precisely the question it exists to answer.
    (ids: Int32Array, millis: number) => {
      const tickets = Array.from(ids, unpack);
      const settled = waitAny(b, tickets, millis);
      if (settled === null) return -1;
      return tickets.findIndex((t) => t.slot === settled.slot && t.gen === settled.gen);
    },

    /*= askInterrupt */
    // **A round trip per ask, and that is also why it works.** Every opcode parks this worker —
    // `hostCall` is submit-then-collect, and `waitAny` above is *not* a counter-example: it is
    // answered from this worker's own memory and involves no host at all. So there is no free poll to
    // build on. But while the worker is parked the page's main thread is running, and in a page that
    // is exactly where a keydown arrives and where the bridge is serviced — so the parking is what
    // gives the host a chance to have seen the `^C`.
    () => readI32le(hostCall(b, OP.ASK_INTERRUPT, EMPTY)),
    /*= sched */
    // **Built, not implemented.** The scheduler is wac code and wac state; the host's whole part in
    // it is calling `create` once, so that a program handed a world is handed somewhere for its
    // continuations to wait. `Core.delay`, `Core.drain` and `Core.dropAll` are the program's view.
    cls.Sched.create(),
  );
}

/**
 * `Cli`, built from the bridge.
 *
 * `readFile` answers with a `FileResult` rather than a nullable array so a failure can
 * carry its reason — the wac side gets `ok`, the bytes, and the host's message.
 */
export function cliOf(
  b: Bridge,
  cls: {
    Cli: PlatformClasses["Cli"];
    FileResult: { of(...a: unknown[]): unknown };
    Stat: { of(...a: unknown[]): unknown };
    Socket: { of(...a: unknown[]): unknown };
    Datagram: { of(...a: unknown[]): unknown };
    Child: { of(...a: unknown[]): unknown };
    LoadedModule: { of(...a: unknown[]): unknown };
    CallResult: { of(...a: unknown[]): unknown };
    Captured: { of(...a: unknown[]): unknown };
    Exec: { of(...a: unknown[]): unknown };
    Change: { of(...a: unknown[]): unknown };
    Read: {
      Data(bytes: Uint8Array): unknown;
      End(): unknown;
      Failed(why: string): unknown;
    };
  } & PendingClasses,
  /**
   * Which grants this `Cli` carries, or `undefined` for "whatever the launcher serves".
   *
   * **Only a *loaded* module passes one** — `issues/system/0242c`. A program's own grants are the
   * launcher's business: it serves the bridge and refuses what the build did not ask for. A module
   * this program loaded shares that bridge, so the launcher cannot tell its calls from its loader's
   * and cannot narrow them — which made `wac test --allow-read` hand a test the *command's* write
   * capability, and a test wrote a file it had no business writing.
   *
   * So the narrowing is in the world the loaded module is handed, and that is enough for the reason
   * `spawn`'s own note gives: **the isolation is the language's, not the runtime's.** A wac module
   * cannot reach past the capabilities it was given, because wac has no ambient anything. It would
   * not be enough for arbitrary JavaScript, and a loaded module is a wac module.
   *
   * Intersection needs no arithmetic here: asking for more than the loader holds still ends at the
   * launcher, which refuses on the loader's grants. This narrows, and the bridge cannot widen.
   */
  grants?: number,
): unknown {
  const settled = (id: number) => isDone(b, unpack(id));
  const drop = (id: number) => { cancel(b, unpack(id)); };

  /** Which grant each guarded opcode needs. An opcode absent from here needs none. */
  const NEEDS: Record<number, number> = {
    [OP.READ_FILE]: GRANT_READ,
    [OP.STAT]: GRANT_READ,
    [OP.LINK_STAT]: GRANT_READ,
    [OP.READ_DIR]: GRANT_READ,
    [OP.OPEN_INPUT]: GRANT_READ,
    [OP.WRITE_FILE]: GRANT_WRITE,
    [OP.MKDIR]: GRANT_WRITE,
    [OP.REMOVE]: GRANT_WRITE,
    [OP.RENAME]: GRANT_WRITE,
    [OP.SET_EXECUTABLE]: GRANT_WRITE,
    [OP.OPEN_OUTPUT]: GRANT_WRITE,
    [OP.CONNECT]: GRANT_NET,
    [OP.LISTEN]: GRANT_NET,
    [OP.BIND_DATAGRAM]: GRANT_NET,
    [OP.ENV]: GRANT_ENV,
    [OP.EXEC_WITH]: GRANT_RUN,
  };

  /**
   * Every guarded call goes through here, so the check is in one place rather than twenty.
   *
   * A denied call is given a ticket that is never submitted and whose id is remembered; `collect`
   * below throws for it, and each shape's resolver already turns a thrown error into *its own*
   * refusal — a failed `FileResult`, a `Change` with a fault, a `Socket` with a negative handle.
   * That is why this needed no change per capability: the refusal shapes were already written.
   */
  const refused = new Set<number>();
  let nextRefusal = -1;
  const send = (op: number, payload: Uint8Array): Ticket => {
    const need = NEEDS[op];
    if (need !== undefined && grants !== undefined && (grants & need) === 0) {
      // A slot number no bridge hands out, so it cannot collide with a real ticket.
      const t: Ticket = { slot: nextRefusal--, gen: 0 };
      refused.add(pack(t));
      return t;
    }
    return submit(b, op, payload);
  };

  /**
   * `collect`, shadowed for this world only.
   *
   * The resolvers below all read their answer through this name, so refusing here refuses in every
   * shape at once and in the wording `platform.wac`'s own `faultWords` uses for the category.
   */
  const collect = (bridge: Bridge, t: Ticket): Uint8Array => {
    // **A `HostCallError` with the category, not a bare `Error`.** `FileResult` and `Change` both read
    // `.fault` off what they catch, so this is what makes a refused write answer *denied* rather than
    // *failed* — the distinction `faultWords` exists for, and the one the native host already made.
    // The wording is `platform.wac`'s own `reasonOf` phrase for the category.
    if (refused.has(pack(t))) {
      throw new HostCallError("Not granted to this application", FAULT_NOT_GRANTED);
    }
    return realCollect(bridge, t);
  };

  // One resolver per return shape, hoisted for the reason in the file header.
  const bytes = (id: number) => collect(b, unpack(id));
  const i32 = (id: number) => readI32le(collect(b, unpack(id)));
  const text = (id: number) => unstr(collect(b, unpack(id)));
  /** Empty means it worked; anything else is the host's message. */
  const outcome = (id: number) => {
    try {
      collect(b, unpack(id));
      return "";
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };
  /** True when it worked. A failure is an answer here, not an exception. */
  const ok = (id: number) => {
    try {
      collect(b, unpack(id));
      return true;
    } catch {
      return false;
    }
  };
  /** Bytes, or empty where a broken source is indistinguishable from an ended one. */
  const chunk = (id: number) => {
    try {
      return collect(b, unpack(id));
    } catch {
      return EMPTY;
    }
  };
  const fileResult = (id: number) => {
    try {
      return cls.FileResult.of(true, collect(b, unpack(id)), "", 0);
    } catch (e) {
      // The category as well as the message, so a program can say what GNU says about a missing file
      // instead of printing the host's sentence — `FAULT_OTHER` when nothing said better. wac-mono 0062.
      const fault = e instanceof HostCallError ? e.fault : FAULT_OTHER;
      return cls.FileResult.of(false, EMPTY, e instanceof Error ? e.message : String(e), fault);
    }
  };
  const stat = (id: number) => {
    try {
      const out = collect(b, unpack(id));
      // exists, isFile, isDir as bytes, then size and mtime as little-endian i64s, then isSymlink, the
      // fault, and isExecutable — each appended rather than inserted, so the offsets above never had to
      // move. That is why the newest field sits past the fault rather than beside the flag it belongs with.
      const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
      return cls.Stat.of(
        out[0] === 1, out[1] === 1, out[2] === 1,
        dv.getBigInt64(3, true), dv.getBigInt64(11, true),
        out[19] === 1, out[STAT_EXEC] === 1, out[20] ?? 0,
      );
    } catch {
      // The bridge itself failed, which is not absence — `FAULT_OTHER`, because nothing said better.
      return cls.Stat.of(false, false, false, 0n, 0n, false, false, FAULT_OTHER);
    }
  };
  const dirNames = (id: number) => {
    try {
      const out = collect(b, unpack(id));
      if (out.length === 0) return [];
      // NUL-separated: a filename may contain anything but a NUL or a slash.
      return unstr(out).split("\u0000");
    } catch {
      return null;
    }
  };
  const maybeText = (id: number) => {
    const out = collect(b, unpack(id));
    // One byte of presence in front, because an unset variable and an empty one are
    // different and a bare empty payload cannot say which this is.
    return out[0] === 1 ? unstr(out.subarray(1)) : null;
  };
  /**
   * The same, as bytes: an environment value is not text, any more than an argument is.
   *
   * **The one shape that had to catch, and the reason `env` diverged.** `send` refuses a guarded call
   * centrally and `collect` throws for it, on the argument — written a few lines up — that "each
   * shape's resolver already turns a thrown error into *its own* refusal … the refusal shapes were
   * already written". They were, except this one: `u8[]?` has no fault field, so nothing absorbed the
   * throw and a program that was not granted the environment **trapped** here while both native hosts
   * answered null. `issues/system/0256c`, found by a differential row that existed for a day before
   * anything ran it.
   *
   * Null is what `Cli.env`'s own type documents — "null when the variable is unset" — and it is what
   * the native hosts already did, so this is the four of them agreeing rather than a new rule. It
   * does conflate "you may not ask" with "it is not set", which `issues/system/0238c` removed from
   * `Socket` for the reason that a caller acts differently on the two; the fix for that is a shape
   * that can say which, and it is `0256c`'s remaining half.
   *
   * Only `FAULT_NOT_GRANTED` is swallowed. Any other failure is still a failure, because a host that
   * broke while answering is not a variable that is unset.
   */
  const maybeBytes = (id: number) => {
    let out: Uint8Array;
    try {
      out = collect(b, unpack(id));
    } catch (e) {
      if (e instanceof HostCallError && e.fault === FAULT_NOT_GRANTED) return null;
      throw e;
    }
    return out[0] === 1 ? out.slice(1) : null;
  };
  const child = (id: number) => {
    try {
      // A handle, then — when the handle is negative — why it never started. The host waits for the
      // source to load before answering, so "it is not a worker bundle" arrives here as a `Child`
      // with a reason rather than as an error that killed this program. wac-mono issue 0021.
      // Three handles, then — when they are negative — why there is nothing to read. The output
      // stream and the error stream are separate because a program has two of them, and the third is
      // the filesystem channel a child asks its parent on; see `Child`.
      const out = collect(b, unpack(id));
      const handle = readI32le(out);
      const errHandle = readI32le(out.subarray(4));
      const fsHandle = readI32le(out.subarray(8));
      return cls.Child.of(handle, errHandle, fsHandle, handle < 0 ? unstr(out.subarray(12)) : "");
    } catch (e) {
      return cls.Child.of(-1, -1, -1, e instanceof Error ? e.message : String(e));
    }
  };
  /**
   * `Exec(status, stdout, stderr, error)` — status, then two length-prefixed streams, then the
   * reason it could not be started.
   *
   * The status and the error are separate on purpose: a program that ran and exited non-zero is the
   * case every differential oracle asks about, and folding it into a fault would put it out of
   * reach. See `Exec` in `platform.wac`.
   */
  const execAnswer = (id: number) => {
    try {
      const out = collect(b, unpack(id));
      const status = readI32le(out) | 0;
      const nOut = readI32le(out.subarray(4));
      const nErr = readI32le(out.subarray(8));
      return cls.Exec.of(
        status,
        out.subarray(12, 12 + nOut),
        out.subarray(12 + nOut, 12 + nOut + nErr),
        unstr(out.subarray(12 + nOut + nErr)),
      );
    } catch (e) {
      return cls.Exec.of(0, EMPTY, EMPTY, e instanceof Error ? e.message : String(e));
    }
  };

  const captured = (id: number) => {
    try {
      const out = collect(b, unpack(id));
      // The two streams in one answer, standard output length-prefixed. One call rather than two
      // because they are one fact: what the child wrote before it stopped.
      const n = readI32le(out);
      // A length, then the truncation flag, then the two streams — see `Captured.truncated`.
      return cls.Captured.of(out.subarray(5, 5 + n), out.subarray(5 + n), out[4] === 1);
    } catch {
      return cls.Captured.of(EMPTY, EMPTY, false);
    }
  };
  /**
   * A `Read`, from a payload whose first byte is the state: 0 data, 1 end, 2 failed.
   *
   * A tag rather than "empty means end", which is the ambiguity the enum exists to remove — the wire
   * had the same hole as the signature did.
   */
  const readOf = (out: Uint8Array) => {
    if (out.length === 0 || out[0] === 1) return cls.Read.End();
    if (out[0] === 2) return cls.Read.Failed(unstr(out.subarray(1)));
    return cls.Read.Data(out.subarray(1));
  };
  /** For the ticket-taking `recv`. A bridge failure is itself a failed read. */
  const read = (id: number) => {
    try {
      return readOf(collect(b, unpack(id)));
    } catch (e) {
      return cls.Read.Failed(e instanceof Error ? e.message : String(e));
    }
  };
  /** For the blocking `readChunk`, which has a ticket in hand rather than a packed id. */
  const readNow = (t: Ticket) => {
    try {
      return readOf(collect(b, t));
    } catch (e) {
      return cls.Read.Failed(e instanceof Error ? e.message : String(e));
    }
  };
  /** A `Change`: the fault category, then the host's message. */
  const change = (id: number) => {
    try {
      const out = collect(b, unpack(id));
      if (out.length === 0) return cls.Change.of(0, "");
      return cls.Change.of(out[0], unstr(out.subarray(1)));
    } catch (e) {
      // **The category when the error carries one**, which `FileResult` above has always done and this
      // did not: a refused write read as `failed` where a refused *read* read as `denied`, so one
      // capability's refusal was a different kind of thing from another's. `FAULT_OTHER` when nothing
      // said better — the bridge itself failing is not a category this world names.
      const fault = e instanceof HostCallError ? e.fault : FAULT_OTHER;
      return cls.Change.of(fault, e instanceof Error ? e.message : String(e));
    }
  };
  const socket = (id: number) => {
    try {
      // A handle, this socket's own port, then the peer's address for a socket that came from
      // `accept` — empty for one that came from `connect` or `listen`, where the peer is either the
      // caller's own choice or nobody. The port is what makes `listen(…, 0)` usable: the kernel picks
      // a free one and the program is told which.
      const out = collect(b, unpack(id));
      return cls.Socket.of(
        readI32le(out), "", unstr(out.subarray(8)), readI32le(out.subarray(4)), FAULT_NONE);
    } catch (e) {
      // **The same line `Change` uses nine lines above**, and the reason is the one written there: a
      // refusal and a failure are different things to act on, and this answered both with a sentence.
      // `issues/system/0238c`; `probe.wac` is the program that had to match `"ot granted"` with the
      // first letter dropped because the hosts spell the refusal two ways.
      const fault = e instanceof HostCallError ? e.fault : FAULT_OTHER;
      return cls.Socket.of(-1, e instanceof Error ? e.message : String(e), "", 0, fault);
    }
  };

  // Bytes and sender in one answer: the peer's port, the peer's address, then the payload. See
  // `Datagram` in platform.wac for why those arrive together rather than through two calls.
  const datagram = (id: number) => {
    try {
      const out = collect(b, unpack(id));
      const peerLen = readI32le(out.subarray(4));
      return cls.Datagram.of(
        out.slice(8 + peerLen),
        unstr(out.subarray(8, 8 + peerLen)),
        readI32le(out),
        "",
      );
    } catch (e) {
      return cls.Datagram.of(new Uint8Array(0), "", 0, e instanceof Error ? e.message : String(e));
    }
  };

  const T = {
    i32: (t: Ticket) => cls.Pending$i32.of(pack(t), i32, settled, drop),
    text: (t: Ticket) => cls.Pending$string.of(pack(t), text, settled, drop),
    outcome: (t: Ticket) => cls.Pending$string.of(pack(t), outcome, settled, drop),
    maybeText: (t: Ticket) => cls.Pending$stringOpt.of(pack(t), maybeText, settled, drop),
    maybeBytes: (t: Ticket) => cls.Pending$u8ArrOpt.of(pack(t), maybeBytes, settled, drop),
    bytes: (t: Ticket) => cls.Pending$u8Arr.of(pack(t), bytes, settled, drop),
    chunk: (t: Ticket) => cls.Pending$u8Arr.of(pack(t), chunk, settled, drop),
    ok: (t: Ticket) => cls.Pending$bool.of(pack(t), ok, settled, drop),
    file: (t: Ticket) => cls.Pending$FileResult.of(pack(t), fileResult, settled, drop),
    stat: (t: Ticket) => cls.Pending$Stat.of(pack(t), stat, settled, drop),
    dir: (t: Ticket) => cls.Pending$stringArrOpt.of(pack(t), dirNames, settled, drop),
    socket: (t: Ticket) => cls.Pending$Socket.of(pack(t), socket, settled, drop),
    captured: (t: Ticket) => cls.Pending$Captured.of(pack(t), captured, settled, drop),
    exec: (t: Ticket) => cls.Pending$Exec.of(pack(t), execAnswer, settled, drop),
    read: (t: Ticket) => cls.Pending$Read.of(pack(t), read, settled, drop),
    change: (t: Ticket) => cls.Pending$Change.of(pack(t), change, settled, drop),
    datagram: (t: Ticket) => cls.Pending$Datagram.of(pack(t), datagram, settled, drop),
    child: (t: Ticket) => cls.Pending$Child.of(pack(t), child, settled, drop),
  };

  const twoPaths = (from: string, to: string): Uint8Array => {
    const a = str(from);
    const bs = str(to);
    const out = new Uint8Array(4 + a.length + bs.length);
    out.set(i32le(a.length), 0);
    out.set(a, 4);
    out.set(bs, 4 + a.length);
    return out;
  };
  const flagged = (on: boolean, path: string): Uint8Array => {
    const p = str(path);
    const out = new Uint8Array(1 + p.length);
    out[0] = on ? 1 : 0;
    out.set(p, 1);
    return out;
  };
  /** `head` then `body`, with nothing in between — what `connect` and `send` expect. */
  const headed = (head: Uint8Array, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(head.length + body.length);
    out.set(head, 0);
    out.set(body, head.length);
    return out;
  };
  /** A length-prefixed head, so the host can tell where it ends — `writeFile` and `rename`. */
  /** One byte, so a boolean can travel where a length prefix would be overkill. */
  const flag = (on: boolean): Uint8Array => new Uint8Array([on ? 1 : 0]);

  const prefixed = (head: Uint8Array, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(4 + head.length + body.length);
    out.set(i32le(head.length), 0);
    out.set(head, 4);
    out.set(body, 4 + head.length);
    return out;
  };

  /**
   * An argument vector: a count, then each argument length-prefixed.
   *
   * `children.ts`'s `unpackArgs` reads it. Bytes, and a length each, because an argument is bytes — the
   * old format joined them as text with NUL separators and lost anything that was not valid UTF-8 on the
   * way through. wac-mono 0065.
   */
  const argvBytes = (args: Uint8Array[]): Uint8Array => {
    let total = 4;
    for (const a of args) total += 4 + a.length;
    const out = new Uint8Array(total);
    out.set(i32le(args.length), 0);
    let at = 4;
    for (const a of args) {
      out.set(i32le(a.length), at);
      out.set(a, at + 4);
      at += 4 + a.length;
    }
    return out;
  };

  return cls.Cli.of(
    /*= argCount */
    () => T.i32(send(OP.ARG_COUNT, EMPTY)),
    /*= arg */
    (i: number) => T.bytes(send(OP.ARG, i32le(i))),
    /*= env */
    (name: string) => T.maybeBytes(send(OP.ENV, str(name))),

    /*= readStdin */
    // stdin and stdout, which need no grant — see the note in platform.wac.
    () => T.bytes(send(OP.READ_STDIN, EMPTY)),
    /*= write */
    // Blocking, matching `platform.wac`: these two act on the current stream, which is
    // ordered anyway, and are handed to the streaming transforms as bare funcrefs.
    (bytes: Uint8Array) => {
      try {
        collect(b, send(OP.WRITE_STDOUT, bytes));
        return true;
      } catch {
        return false;   // a closed pipe is an answer, not a crash
      }
    },

    /*= writeErr */
    // Standard error as bytes, the same shape as `write` and failing the same way. `warn` is still
    // the right thing for a diagnostic line; this is for a program relaying someone else's output.
    (bytes: Uint8Array) => {
      try {
        collect(b, send(OP.WRITE_STDERR, bytes));
        return true;
      } catch {
        return false;
      }
    },

    /*= readFile */
    (path: string) => T.file(send(OP.READ_FILE, str(path))),
    /*= writeFile */
    // `change`, not `ok`: the answer is a fault category and the host's message.
    (path: string, body: Uint8Array) =>
      T.change(send(OP.WRITE_FILE, prefixed(str(path), body))),
    /*= stat */
    (path: string) => T.stat(send(OP.STAT, str(path))),
    /*= linkStat */
    (path: string) => T.stat(send(OP.LINK_STAT, str(path))),
    /*= readDir */
    (path: string) => T.dir(send(OP.READ_DIR, str(path))),

    /*= mkdir */
    (path: string, parents: boolean) => T.change(send(OP.MKDIR, flagged(parents, path))),
    /*= remove */
    (path: string, recursive: boolean) => T.change(send(OP.REMOVE, flagged(recursive, path))),
    /*= rename */
    (from: string, to: string) => T.change(send(OP.RENAME, twoPaths(from, to))),
    /*= setExecutable */
    // Same `flagged` encoding as `mkdir` and `remove`: one bool, one path. The bool is "should it be
    // executable", not "toggle" — a toggle would make the result depend on what was there.
    (path: string, on: boolean) => T.change(send(OP.SET_EXECUTABLE, flagged(on, path))),

    /*= openInput */
    // `change`, not `outcome`, for the same reason `openOutput` uses it: a category the caller can put
    // into its own words, rather than an errno in somebody's shell diagnostic.
    (path: string) => T.change(send(OP.OPEN_INPUT, str(path))),
    /*= readChunk */
    // Blocking, and it answers the three states directly — no ticket, and no way to mistake a broken
    // read for the end of the input.
    () => readNow(send(OP.READ_CHUNK, EMPTY)),
    /*= outputError */
    () => T.text(send(OP.OUTPUT_ERROR, EMPTY)),
    /*= openOutput */
    // `change`, not `outcome`: the answer is a fault category and the host's message, so a shell can
    // say what GNU says rather than passing an errno through.
    (path: string) => T.change(send(OP.OPEN_OUTPUT, str(path))),

    /*= connect */
    (host: string, port: number) => T.socket(send(OP.CONNECT, headed(i32le(port), str(host)))),
    /*= listen */
    // The port, then the address — `headed` puts the fixed-width part first, as `spawn` does.
    (address: string, port: number) => T.socket(send(OP.LISTEN, headed(i32le(port), str(address)))),
    /*= accept */
    (handle: number) => T.socket(send(OP.ACCEPT, i32le(handle))),
    /*= recv */
    (handle: number) => T.read(send(OP.RECV, i32le(handle))),
    /*= send */
    (handle: number, body: Uint8Array) => T.ok(send(OP.SEND, headed(i32le(handle), body))),
    /*= closeSocket */
    (handle: number) => { hostCall(b, OP.CLOSE_SOCKET, i32le(handle)); },
    /*= closeSend */
    (handle: number) => { hostCall(b, OP.CLOSE_SEND, i32le(handle)); },

    /*= bindDatagram */
    // The port, then the address, exactly as `listen` — the same shape because it is the same question.
    (address: string, port: number) =>
      T.socket(send(OP.BIND_DATAGRAM, headed(i32le(port), str(address)))),
    /*= receiveFrom */
    (handle: number) => T.datagram(send(OP.RECEIVE_FROM, i32le(handle))),
    /*= sendTo */
    // Handle, port, then the address length-prefixed so the payload after it can be anything.
    (handle: number, address: string, port: number, body: Uint8Array) => {
      const who = str(address);
      const head = new Uint8Array(12 + who.length + body.length);
      head.set(i32le(handle), 0);
      head.set(i32le(port), 4);
      head.set(i32le(who.length), 8);
      head.set(who, 12);
      head.set(body, 12 + who.length);
      return T.ok(send(OP.SEND_TO, head));
    },

    /*= spawn */
    (
      // **Bytes, because a program is not text.** This was `string` and every caller reached it
      // through `string.fromBytes`, which is lossless only while a program happens to be a UTF-8
      // JavaScript bundle. A wasm module is not, and a module that describes itself is what `spawn`
      // is meant to take.
      source: Uint8Array,
      args: Uint8Array[],
      grants: number,
      cwd: string,
      inheritIn: boolean,
      serveFs: boolean,
    ) =>
      // The grant flags, then the source length-prefixed, then the arguments length-prefixed and
      // NUL-separated — the same shape `readDir` answers with, for the same reason: a filename or an
      // argument may contain anything but a NUL — and then the child's directory.
      T.child(
        send(OP.SPAWN,
          headed(
            i32le(grants),
            prefixed(
              source,
              headed(
                argvBytes(args),
                prefixed(str(cwd), headed(flag(inheritIn), flag(serveFs))),
              ),
            ),
          ),
        ),
      ),
    /*= spawnSelf */
    // No source: the host has this program's own bundle, because it is what started it. The payload
    // is the grants and the arguments, in the shape `spawn` uses minus the part that is already here.
    (
      args: Uint8Array[],
      grants: number,
      cwd: string,
      inheritIn: boolean,
      serveFs: boolean,
    ) =>
      T.child(
        send(OP.SPAWN_SELF,
          headed(
            i32le(grants),
            headed(argvBytes(args), prefixed(str(cwd), headed(flag(inheritIn), flag(serveFs)))),
          ),
        ),
      ),
    /*= closeFeed */
    (handle: number) => { hostCall(b, OP.CLOSE_FEED, i32le(handle)); },
    /*= exitCode */
    (handle: number) => T.i32(send(OP.EXIT_CODE, i32le(handle))),
    /*= cwd */
    () => T.text(send(OP.CWD, EMPTY)),

    /*= pushChild */
    // Everything the child's world is, in one payload, so a push is one round trip.
    (argv: string[], stdin: Uint8Array, cwd: string, inheritInput: boolean) =>
      T.ok(send(OP.PUSH_CHILD,
        headed(
          i32le(argv.length),
          headed(i32le(inheritInput ? 1 : 0), prefixed(str(argv.join("\u0000")), prefixed(str(cwd), stdin))),
        ),
      )),
    /*= popChild */
    () => T.captured(send(OP.POP_CHILD, EMPTY)),
    /*= execWith */
    // Path, then the argument *vector* joined by NULs — which is why it is a vector and not a shell
    // line: a NUL cannot appear in an argument, so nothing here can be re-split by accident. The
    // environment travels the same way, as `NAME=value` strings, and `inherit` leads as one byte,
    // because a host has to know what to do with the child's streams before it has a child.
    (
      path: string,
      args: string[],
      stdin: Uint8Array,
      env: string[],
      clearEnv: boolean,
      inherit: boolean,
    ) =>
      T.exec(send(OP.EXEC_WITH,
        headed(
          flag(clearEnv),
          headed(
            flag(inherit),
            prefixed(
              str(path),
              prefixed(str(args.join("\u0000")), prefixed(str(env.join("\u0000")), stdin)),
            ),
          ),
        ),
      )),
    /*= load */
    // **No opcode: the module is instantiated right here.** Its `Core` and `Cli` are built by
    // `worldFor` against *this* bridge, so the launcher serves the loaded module exactly as it serves
    // the program that loaded it and cannot tell them apart. That is what makes this small — the
    // alternative, loading in the launcher, would need a second implementation of the whole world with
    // no bridge under it. `issues/system/0240c`.
    (module: Uint8Array, asked: number) => {
      try {
        const manifest = manifestIn(module);
        if (manifest === null) {
          return cls.LoadedModule.of(-1, "this module carries no wac.manifest section");
        }
        const driven = drive(module, manifest);
        const app = asAppModule(driven);
        const handle = nextLoaded++;
        loadedModules.set(handle, {
          driven,
          app,
          // Built once per module rather than per call: `Core` and `Cli` register one wasm function
          // per host function in the *module's* funcref table, and only sixteen per signature can be
          // live — so a world rebuilt per call fails on the seventeenth, a long way from the cause.
          // `entry.ts` learnt this about `main` being called more than once.
          // **Narrowed to what was asked for** — `issues/system/0242c`. Without this a loaded module
          // got the loader's whole world: `wac test --allow-read` handed a test the *command's* write
          // capability and a test wrote a file, where the native host failed it. The launcher cannot
          // do the narrowing because it cannot tell this module's calls from its loader's, so the
          // world it is handed is where it lives.
          world: worldFor(b, app, asked),
          exports: new Map(manifest.exports.map((e) => [e.name, e])),
        });
        return cls.LoadedModule.of(handle, "");
      } catch (e) {
        // A module that will not compile or instantiate is a value the caller acts on, exactly as a
        // child that would not start is. `Child` has the same shape for the same reason.
        return cls.LoadedModule.of(-1, e instanceof Error ? e.message : String(e));
      }
    },
    /*= call */
    // The signature comes from the **manifest**, not from the caller: a module says what its exports
    // take and answer, so nothing has to describe it twice. The set is closed — see `CallResult`.
    (handle: number, name: string, arg: number) => {
      const m = loadedModules.get(handle);
      if (m === undefined) return cls.CallResult.of(2, "no module on handle " + handle, 0);
      const sig = m.exports.get(name);
      const f = m.app[name];
      if (sig === undefined || typeof f !== "function") {
        return cls.CallResult.of(2, "no export named " + name, 0);
      }
      // What to hand it. `Core`/`Cli` in that order, or one `i32`, or nothing — and anything else is
      // refused rather than guessed at, which is what keeps `status == 3` meaningful.
      const world = m.world;
      let args: unknown[];
      if (sig.params.length === 0) args = [];
      else if (sig.params.length === 1 && sig.params[0] === "i32") args = [arg];
      else if (
        sig.params.length <= 2 &&
        sig.params.every((t: string, i: number) => t === ["Core", "Cli"][i])
      ) {
        args = world.slice(0, sig.params.length);
        // A module whose `main` named no capabilities has no `Core` class, so `worldFor` gave nothing
        // — and calling an export that wants one with `undefined` would trap inside the module rather
        // than say why. `issues/lang/0107` is the rule this reads.
        if (args.length < sig.params.length) {
          return cls.CallResult.of(3, "this module was built without " + sig.params.join(" and "), 0);
        }
      } else return cls.CallResult.of(3, "cannot call " + name + "(" + sig.params.join(", ") + ")", 0);
      if (sig.ret !== "" && sig.ret !== "void" && sig.ret !== "i32" && sig.ret !== "string") {
        return cls.CallResult.of(3, name + " answers " + sig.ret, 0);
      }
      try {
        const out = (f as CallableFunction)(...args);
        if (sig.ret === "string") {
          return cls.CallResult.of(0, String(m.driven.fromWasm("string", out) ?? ""), 0);
        }
        if (sig.ret === "i32") return cls.CallResult.of(0, "", Number(out) | 0);
        return cls.CallResult.of(0, "", 0);
      } catch (e) {
        // **The whole point.** A `test_traps_*` export passes by trapping, and 389 of this
        // repository's test exports are one. The handle stays usable: wac has no module-level state
        // for a trap to leave behind, which is the same reason those tests have always been able to
        // run beside their neighbours.
        //
        // **What the program said, not what the engine said.** `trap "…"` leaves its sentence in a
        // global and `$trap$message` reads it once the trap has unwound (`issues/lang/0147`); a bare
        // throw from here reported `unreachable` instead, which is the engine describing the
        // instruction rather than the program describing the moment. `wacInstance.ts:121` and
        // `wacBindgen.ts`'s `TRAP_GUARD` have always done this — `Cli.call` reaches an export
        // directly, with no glue around it, so it was the one caller with nowhere for the message to
        // come from. `commandparity_test.wac` has the row; before this the native said "trapped: the
        // reason it stopped" and Deno and Node said "trapped: unreachable" for one file.
        //
        // Empty when there is none, which is an engine trap — a bounds check, a null dereference —
        // and is what the native host reports for one. That drops the engine's own words on this
        // side; they are worth having, and adding them is a change to both hosts rather than a
        // reason for these two to differ.
        //
        // The value read is stale if an earlier trap in this module said something and this one did
        // not: nothing clears the global. `issues/lang/0254c`, which is not this bug and is now
        // reachable from here too.
        let said = "";
        try {
          const read = m.driven.exports.$trap$message;
          const s = typeof read === "function" ? (read as CallableFunction)() : null;
          if (s !== null && s !== undefined) said = String(m.driven.fromWasm("string", s) ?? "");
        } catch { /* asking a module that has just trapped is itself allowed to fail */ }
        return cls.CallResult.of(1, said, 0);
      }
    },
    /*= unload */
    // Forgiving of a handle that is not one: a caller tidying up after a failure should not have to
    // know how far it got.
    (handle: number) => { loadedModules.delete(handle); });
}

/**
 * The `Page` capabilities, for an interactive application in a browser.
 *
 * Built like `Cli`: positionally, with one hoisted resolver per return shape, and every
 * argument tagged so `test/wac/order_test.wac` can check this list against `platform.wac`.
 */
export type PageClasses = {
  // `PendingClass` is the four-argument ticket shape; a struct's `of` takes its own fields.
  Page: { of(...a: unknown[]): unknown };
  Event: { of(...a: unknown[]): unknown };
  Picked: { of(...a: unknown[]): unknown };
  Pending$Event: PendingClass;
  Pending$Picked: PendingClass;
  Pending$bool: PendingClass;
  Pending$string: PendingClass;
};

/**
 * The capabilities this module actually asked for, in `main`'s order.
 *
 * **A program gets what it declared and nothing else.** `main(Core)` is handed a `Core`; building a
 * `Cli` for it would be handing over a capability the program never named, and the module has no
 * `Cli` class to build one from — the compiler binds a capability's type only when a signature
 * reaches it. The host used to build both and pass both, which worked only because every module
 * exported constructors for every capability whether its program mentioned them or not.
 * `issues/lang/0107`.
 */
/**
 * The modules this program has loaded, by handle — `issues/system/0240c`.
 *
 * **Module-scope rather than per `Cli`**, because a frame forwards `load`/`call`/`unload` unchanged
 * (`packages/platform/src/frame.wac`), so a handle taken through one `Cli` is used through another.
 * One program is one realm here: a worker runs one program at a time, and a spawned child is a
 * different worker with its own copy of this module.
 */
type LoadedModule = {
  driven: Driven;
  app: Record<string, unknown>;
  /** `[Core]`, `[Core, Cli]` or `[]` — built once, because funcref slots are finite. See `load`. */
  world: unknown[];
  exports: Map<string, ExportSig>;
};
const loadedModules = new Map<number, LoadedModule>();
/** From 1, so that 0 is never a valid handle and a zeroed field cannot name a module. */
let nextLoaded = 1;

export function worldFor(
  b: Bridge,
  app: Record<string, unknown>,
  /** A grant mask for a *loaded* module; absent for a program, whose grants the launcher enforces. */
  grants?: number,
): unknown[] {
  // **A `main` that declared nothing gets nothing**, which is the same rule one step further: the classes
  // are in the module because the program named the *types*, so a program that named none has no `Core`
  // to build from and `Core.of` is `undefined.of`. The two Rust hosts read `main`'s parameter list for
  // this; here the absent class is the same signal, and it is the one this side has.
  if (app.Core === undefined) return [];
  const out: unknown[] = [coreOf(b, app as unknown as Parameters<typeof coreOf>[1])];
  if (app.Cli !== undefined) {
    out.push(cliOf(b, app as unknown as Parameters<typeof cliOf>[1], grants));
  }
  return out;
}

export function pageOf(b: Bridge, cls: PageClasses): unknown {
  const settled = (id: number) => isDone(b, unpack(id));
  const drop = (id: number) => { cancel(b, unpack(id)); };
  const ok = (id: number) => { collect(b, unpack(id)); return true; };
  const text = (id: number) => unstr(collect(b, unpack(id)));
  const event = (id: number) => {
    const parts = unstr(collect(b, unpack(id))).split("\u0000");
    return cls.Event.of(
      parts[0] ?? "",
      parts[1] ?? "",
      parts[2] ?? "",
      Number(parts[3] ?? 0),
      Number(parts[4] ?? 0),
    );
  };
  const picked = (id: number) => {
    const out = collect(b, unpack(id));
    const nameLen = readI32le(out.subarray(1));
    const errLen = readI32le(out.subarray(5 + nameLen));
    return cls.Picked.of(
      out[0] === 1,
      unstr(out.subarray(5, 5 + nameLen)),
      // A copy, because `collect` already gave us one and a subarray of it would keep the
      // whole file alive for the sake of its name.
      out.slice(9 + nameLen + errLen),
      unstr(out.subarray(9 + nameLen, 9 + nameLen + errLen)),
    );
  };

  /** A length-prefixed string and then the rest: how two strings cross as one payload. */
  const two = (a: string, bs: string): Uint8Array => {
    const x = str(a);
    const y = str(bs);
    const out = new Uint8Array(4 + x.length + y.length);
    out.set(i32le(x.length), 0);
    out.set(x, 4);
    out.set(y, 4 + x.length);
    return out;
  };

  const asOk = (t: Ticket) => cls.Pending$bool.of(pack(t), ok, settled, drop);
  const asText = (t: Ticket) => cls.Pending$string.of(pack(t), text, settled, drop);
  const asEvent = (t: Ticket) => cls.Pending$Event.of(pack(t), event, settled, drop);
  const asPicked = (t: Ticket) => cls.Pending$Picked.of(pack(t), picked, settled, drop);

  return cls.Page.of(
    /*= render */
    (html: string) => asOk(submit(b, OP.RENDER, str(html))),
    /*= setText */
    (id: string, t: string) => asOk(submit(b, OP.SET_TEXT, two(id, t))),
    /*= setValue */
    (id: string, v: string) => asOk(submit(b, OP.SET_VALUE, two(id, v))),
    /*= setStyle */
    (id: string, css: string) => asOk(submit(b, OP.SET_STYLE, two(id, css))),
    /*= getValue */
    (id: string) => asText(submit(b, OP.GET_VALUE, str(id))),
    /*= on */
    (sel: string, kind: string) => asOk(submit(b, OP.ON, two(sel, kind))),
    /*= nextEvent */
    () => asEvent(submit(b, OP.NEXT_EVENT, EMPTY)),
    /*= title */
    (t: string) => asOk(submit(b, OP.TITLE, str(t))),
    /*= drawPixels */
    (id: string, w: number, h: number, rgba: Uint8Array) => {
      const name = str(id);
      const out = new Uint8Array(12 + name.length + rgba.length);
      out.set(i32le(w), 0);
      out.set(i32le(h), 4);
      out.set(i32le(name.length), 8);
      out.set(name, 12);
      out.set(rgba, 12 + name.length);
      return asOk(submit(b, OP.DRAW_PIXELS, out));
    },
    /*= drawPixelsIn */
    (id: string, x: number, y: number, w: number, h: number, rgba: Uint8Array) => {
      const name = str(id);
      const out = new Uint8Array(20 + name.length + rgba.length);
      out.set(i32le(x), 0);
      out.set(i32le(y), 4);
      out.set(i32le(w), 8);
      out.set(i32le(h), 12);
      out.set(i32le(name.length), 16);
      out.set(name, 20);
      out.set(rgba, 20 + name.length);
      return asOk(submit(b, OP.DRAW_PIXELS_IN, out));
    },
    /*= nextFile */
    () => asPicked(submit(b, OP.NEXT_FILE, EMPTY)),
    /*= offerDownload */
    (name: string, bytes: Uint8Array) => {
      const n = str(name);
      const out = new Uint8Array(4 + n.length + bytes.length);
      out.set(i32le(n.length), 0);
      out.set(n, 4);
      out.set(bytes, 4 + n.length);
      return asOk(submit(b, OP.OFFER_DOWNLOAD, out));
    },
  );
}

export { HostCallError };
