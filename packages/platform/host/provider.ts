// Worker side: serve a wac program's requests over the bridge — design/system/0013 step 6.
//
// A program hands its host four calls through `__wacHost` and is answered through `__wacAnswered`, all
// in plain values: a request is an opcode, the program's own id for it, two integers, a string and
// bytes, and every answer is one shape — `fault, text, bytes, n, m, flags`. So nothing here builds a
// wac value. A request is turned into the payload the launcher already serves (`deno.ts`, `node.ts`,
// `browser.ts`), and the launcher's reply into that one shape.
//
// The four functions are created **once per program**, never per call. The module registers each
// distinct function identity in a fixed table per signature and never frees a slot, so a fresh closure
// per call dies on the seventeenth with a `RangeError` a long way from its cause.
//
// **An answer arrives only from inside `request` or `waitAny`**, which is what makes re-entry safe: a
// request this worker answers in its own realm (`load`, `call`) or by a round trip it may block on (a
// clock, an argument, a write) is answered before `request` returns, and the rest when `waitAny` sees
// their slot finish.

import { type Bridge } from "./layout.ts";
import {
  cancel,
  collect,
  hostCall,
  HostCallError,
  i32le,
  isDone,
  waitAny as waitOn,
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
import {
  FAULT_NONE,
  FAULT_NOT_GRANTED,
  FAULT_OTHER,
  FAULT_UNSUPPORTED,
  STAT_EXEC,
  STAT_FAULT,
  STAT_MODE,
} from "./faults.ts";

/** One export's wac signature, as the manifest records it — `Manifest.exports` in `native.ts`. */
type ExportSig = { name: string; params: string[]; ret: string };

const EMPTY = new Uint8Array(0);

/** What `exitWith` throws: the program asked to end now with `code`. Caught where `main` was called. */
export class WacExit extends Error {
  // A declared field rather than a parameter property: our TypeScript is erasable by design
  // (`design/system/0009` D4), and `readonly code` in the parameter list is the one construct that is
  // not — TypeScript writes a field for it and an erasing stripper cannot. `issues/system/0360a`.
  readonly code: number;
  constructor(code: number) {
    super(`the program exited with ${code}`);
    this.code = code;
  }
}

/** An answer, in the one shape every request is answered in. */
type Flat = { fault: number; text: string; bytes: Uint8Array; n: bigint; m: bigint; flags: number };

const flat = (o: Partial<Flat>): Flat => ({
  fault: o.fault ?? FAULT_NONE,
  text: o.text ?? "",
  bytes: o.bytes ?? EMPTY,
  n: o.n ?? 0n,
  m: o.m ?? 0n,
  flags: o.flags ?? 0,
});

/** A failure, with the category the error carries — `FAULT_OTHER` when nothing said better. */
const failure = (e: unknown): Flat =>
  flat({
    fault: e instanceof HostCallError ? e.fault : FAULT_OTHER,
    text: e instanceof Error ? e.message : String(e),
  });

const REFUSED = "Not granted to this application";

/** Which grant each guarded opcode needs, for a *loaded* module — see `hostFor`'s `grants`. */
const NEEDS: Record<number, number> = {
  [OP.READ_FILE]: GRANT_READ,
  [OP.STAT]: GRANT_READ,
  [OP.LINK_STAT]: GRANT_READ,
  [OP.READ_DIR]: GRANT_READ,
  [OP.WRITE_FILE]: GRANT_WRITE,
  [OP.MKDIR]: GRANT_WRITE,
  [OP.REMOVE]: GRANT_WRITE,
  [OP.RENAME]: GRANT_WRITE,
  [OP.SET_EXECUTABLE]: GRANT_WRITE,
  [OP.CHMOD]: GRANT_WRITE,
  [OP.CONNECT]: GRANT_NET,
  [OP.LISTEN]: GRANT_NET,
  [OP.BIND_DATAGRAM]: GRANT_NET,
  [OP.ENV]: GRANT_ENV,
  [OP.EXEC]: GRANT_RUN,
};

// ── Requests, as the launcher's payloads ──────────────────────────────────────────────────────

const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
/** A length-prefixed head, so the host can tell where it ends. */
const prefixed = (head: Uint8Array, body: Uint8Array): Uint8Array => cat(i32le(head.length), head, body);
const flag = (on: boolean): Uint8Array => new Uint8Array([on ? 1 : 0]);

/** std's packed `bytes` — `u32` length-prefixed parts, a list a `u32` count of them (design 0013). */
class Parts {
  at = 0;
  readonly b: Uint8Array;
  constructor(b: Uint8Array) { this.b = b; }
  u32(): number {
    const n = readI32le(this.b, this.at) >>> 0;
    this.at += 4;
    return n;
  }
  part(): Uint8Array {
    const n = this.u32();
    const out = this.b.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }
  list(): Uint8Array[] {
    const n = this.u32();
    const out: Uint8Array[] = [];
    for (let i = 0; i < n; i++) out.push(this.part());
    return out;
  }
}

/** An argument vector as `children.ts`'s `unpackArgs` reads it — the same count-then-parts std packs. */
const argvBytes = (args: Uint8Array[]): Uint8Array =>
  cat(i32le(args.length), ...args.flatMap((a) => [i32le(a.length), a]));

/** Arguments joined by NULs, which is how `EXEC` carries them: a NUL cannot appear in one. */
const nulJoined = (xs: Uint8Array[]): Uint8Array =>
  cat(...xs.flatMap((x, i) => (i === 0 ? [x] : [new Uint8Array([0]), x])));

/** The launcher's payload for a request, or `null` for one it does not serve. */
function payloadOf(op: number, a: number, b: number, text: string, bytes: Uint8Array): Uint8Array | null {
  switch (op) {
    case OP.NOW_MILLIS: case OP.MONOTONIC_NANOS: case OP.ARG_COUNT: case OP.READ_STDIN:
    case OP.READ_CHUNK: case OP.CWD: case OP.ASK_INTERRUPT:
      return EMPTY;
    case OP.RANDOM_BYTES: case OP.ARG: case OP.SLEEP_MILLIS: case OP.ACCEPT: case OP.RECV:
    case OP.CLOSE_SOCKET: case OP.CLOSE_SEND: case OP.CLOSE_FILE: case OP.CLOSE_OUTPUT:
    case OP.RECEIVE_FROM: case OP.CLOSE_FEED: case OP.EXIT_CODE:
      return i32le(a);
    case OP.ENV: case OP.READ_FILE: case OP.STAT: case OP.LINK_STAT: case OP.READ_DIR:
      return str(text);
    case OP.WRITE_STDOUT: case OP.WRITE_STDERR:
      return bytes;
    case OP.WRITE_FILE:
      return prefixed(str(text), bytes);
    case OP.MKDIR: case OP.REMOVE: case OP.SET_EXECUTABLE:
      return cat(flag(a !== 0), str(text));
    case OP.RENAME:
      return prefixed(str(text), bytes);
    case OP.CHMOD: case OP.OPEN_FILE: case OP.CONNECT: case OP.LISTEN: case OP.BIND_DATAGRAM:
      return cat(i32le(a), str(text));
    case OP.SEND:
      return cat(i32le(a), bytes);
    case OP.SEND_TO: {
      const who = str(text);
      return cat(i32le(a), i32le(b), i32le(who.length), who, bytes);
    }
    case OP.SPAWN: case OP.SPAWN_SELF: {
      // std: the module (empty for this program), then the arguments as a list — which is exactly the
      // launcher's `prefixed(source, argv)`, so `SPAWN` passes it through. `DETACHED` and the served bit
      // are std's business; the input and output bits are the host's, in the low two.
      const serves = (b & 256) !== 0;
      const inherit = b & 3;
      const tail = prefixed(str(text), cat(op === OP.SPAWN ? i32le(inherit) : new Uint8Array([inherit]), flag(serves)));
      if (op === OP.SPAWN) return cat(i32le(a), bytes, tail);
      const p = new Parts(bytes);
      p.part();
      return cat(i32le(a), argvBytes(p.list()), tail);
    }
    case OP.EXEC: {
      const p = new Parts(bytes);
      const program = p.part();
      const args = p.list();
      const input = p.part();
      const pairs = p.list();
      return cat(
        flag((a & 1) !== 0),
        flag((a & 2) !== 0),
        prefixed(program, prefixed(nulJoined(args), prefixed(nulJoined(pairs), prefixed(str(text), input)))),
      );
    }
    default:
      return null;
  }
}

// ── Replies, in the one shape ─────────────────────────────────────────────────────────────────

/** A reply whose payload is a socket: its handle, its own port, then the peer. */
const socketOf = (out: Uint8Array): Flat =>
  flat({ n: BigInt(readI32le(out)), m: BigInt(readI32le(out, 4)), text: unstr(out.subarray(8)) });

/** A `Change` reply: empty when it worked, else the fault category then the host's message. */
const changeOf = (out: Uint8Array): Flat =>
  out.length === 0 || out[0] === FAULT_NONE ? flat({ flags: 1 }) : flat({ fault: out[0], text: unstr(out.subarray(1)) });

/** A `Read` reply, whose first byte is the state: 0 data, 1 end, 2 failed. */
const readOf = (out: Uint8Array): Flat => {
  if (out.length === 0 || out[0] === 1) return flat({ flags: 1 });
  if (out[0] === 2) return flat({ fault: FAULT_OTHER, text: unstr(out.subarray(1)) });
  return flat({ bytes: out.slice(1) });
};

/** The launcher's reply to `op`, flattened as design 0013's answer table says. */
function answerOf(op: number, out: Uint8Array): Flat {
  switch (op) {
    case OP.NOW_MILLIS: case OP.MONOTONIC_NANOS: case OP.SLEEP_MILLIS:
      return flat({ n: readI64le(out) });
    case OP.ARG_COUNT: case OP.EXIT_CODE:
      return flat({ n: BigInt(readI32le(out)) });
    case OP.RANDOM_BYTES: case OP.ARG: case OP.READ_STDIN: case OP.READ_FILE:
      return flat({ bytes: out, flags: 1 });
    case OP.ENV:
      // One byte of presence in front: an unset variable and an empty one are different.
      return out[0] === 1 ? flat({ bytes: out.slice(1), flags: 1 }) : flat({});
    case OP.CWD:
      return flat({ text: unstr(out) });
    case OP.READ_CHUNK: case OP.RECV:
      return readOf(out);
    case OP.WRITE_FILE: case OP.MKDIR: case OP.REMOVE: case OP.RENAME: case OP.SET_EXECUTABLE: case OP.CHMOD:
      return changeOf(out);
    case OP.WRITE_STDOUT: case OP.WRITE_STDERR: case OP.SEND: case OP.SEND_TO: case OP.CLOSE_FILE:
    case OP.CLOSE_OUTPUT:
      return flat({ flags: 1 });
    case OP.STAT: case OP.LINK_STAT: {
      // exists, isFile, isDir as bytes, size and mtime as little-endian i64s, isSymlink, the fault,
      // isExecutable, then the mode.
      const fault = out[STAT_FAULT] ?? 0;
      if (fault !== FAULT_NONE) return flat({ fault });
      const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
      const kind = (out[0] === 1 ? 1 : 0) | (out[1] === 1 ? 2 : 0) | (out[2] === 1 ? 4 : 0) |
        (out[19] === 1 ? 8 : 0) | (out[STAT_EXEC] === 1 ? 16 : 0);
      const mode = out.length >= STAT_MODE + 4 ? dv.getUint32(STAT_MODE, true) & 0xffff : 0;
      return flat({ n: dv.getBigInt64(3, true), m: dv.getBigInt64(11, true), flags: kind | (mode << 16) });
    }
    case OP.READ_DIR: {
      // NUL-separated from the launcher; std reads each name followed by a NUL.
      const names = out.length === 0 ? [] : unstr(out).split("\u0000");
      return flat({ bytes: str(names.map((n) => n + "\u0000").join("")), flags: 1 });
    }
    case OP.CONNECT: case OP.LISTEN: case OP.ACCEPT: case OP.BIND_DATAGRAM: case OP.OPEN_FILE:
      return socketOf(out);
    case OP.RECEIVE_FROM: {
      // The peer's port, the peer's address length-prefixed, then the payload — in one answer.
      const peerLen = readI32le(out, 4);
      return flat({ bytes: out.slice(8 + peerLen), text: unstr(out.subarray(8, 8 + peerLen)), n: BigInt(readI32le(out)) });
    }
    case OP.SPAWN: case OP.SPAWN_SELF: {
      // Three handles, then — when the first is negative — why there is no child: -2 is a host that
      // cannot start programs at all.
      const handle = readI32le(out);
      if (handle < 0) {
        return flat({ fault: handle === -2 ? FAULT_UNSUPPORTED : FAULT_OTHER, text: unstr(out.subarray(12)) });
      }
      const err = BigInt.asUintN(32, BigInt(readI32le(out, 4)));
      const fs = BigInt(readI32le(out, 8));
      return flat({ n: BigInt(handle), m: BigInt.asIntN(64, err | (fs << 32n)) });
    }
    case OP.EXEC: {
      // Status, two lengths, the streams, then why it could not be started.
      const nOut = readI32le(out, 4);
      const nErr = readI32le(out, 8);
      const why = unstr(out.subarray(12 + nOut + nErr));
      if (why !== "") return flat({ fault: FAULT_OTHER, text: why });
      return flat({ n: BigInt(readI32le(out) | 0), bytes: out.slice(12, 12 + nOut + nErr), m: BigInt(nOut) });
    }
    default:
      return flat({});
  }
}

/** A request whose answer, if it is dropped before it is read, still holds something to close. */
const closerOf = (op: number): number | null => {
  switch (op) {
    case OP.CONNECT: case OP.LISTEN: case OP.ACCEPT: case OP.BIND_DATAGRAM: case OP.SPAWN: case OP.SPAWN_SELF:
      return OP.CLOSE_SOCKET;
    case OP.OPEN_FILE:
      return OP.CLOSE_FILE;
    default:
      return null;
  }
};

/**
 * Requests answered by a round trip this worker blocks on, inside `request` — a clock, an argument,
 * a write to a stream, a close. A write stays in order this way, and `Module.call`'s `wait` on an
 * argument cannot find the answer missing.
 */
const AT_ONCE = new Set<number>([
  OP.NOW_MILLIS, OP.MONOTONIC_NANOS, OP.RANDOM_BYTES, OP.ARG_COUNT, OP.ARG, OP.ENV, OP.CWD,
  OP.WRITE_STDOUT, OP.WRITE_STDERR, OP.CLOSE_OUTPUT, OP.CLOSE_SOCKET, OP.CLOSE_SEND, OP.CLOSE_FEED,
]);

// ── Modules loaded into this realm ────────────────────────────────────────────────────────────

/**
 * The modules this program has loaded, by handle — `issues/system/0240c`.
 *
 * One program is one realm here: a worker runs one program at a time, and a spawned child is a
 * different worker with its own copy of this module.
 */
type LoadedModule = {
  driven: Driven;
  app: Record<string, unknown>;
  /** The host value its tests are handed, built once at load: funcref slots are finite. */
  host: unknown;
  exports: Map<string, ExportSig>;
};
const loadedModules = new Map<number, LoadedModule>();
/** From 1, so that 0 is never a valid handle and a zeroed field cannot name a module. */
let nextLoaded = 1;

/** `load`: drive the module in this realm, its requests served over this same bridge. */
function load(b: Bridge, module: Uint8Array, asked: number): Flat {
  try {
    const manifest = manifestIn(module);
    if (manifest === null) return flat({ fault: FAULT_OTHER, text: "this module carries no wac.manifest section" });
    const driven = drive(module, manifest);
    const app = asAppModule(driven, manifest);
    const handle = nextLoaded++;
    loadedModules.set(handle, {
      driven,
      app,
      // **Narrowed to what was asked for** — `issues/system/0242c`. The launcher cannot tell this
      // module's calls from its loader's, so the narrowing is in the host it is handed.
      host: hostFor(b, app, asked),
      exports: new Map(manifest.exports.map((e) => [e.name, e])),
    });
    return flat({ n: BigInt(handle) });
  } catch (e) {
    // A module that will not compile or instantiate is a value the caller acts on.
    return flat({ fault: FAULT_OTHER, text: e instanceof Error ? e.message : String(e) });
  }
}

/** `call`: `flags` the status — 0 returned, 1 trapped, 2 no such export, 3 not callable — `n` the value. */
function call(handle: number, name: string, arg: number): Flat {
  const m = loadedModules.get(handle);
  if (m === undefined) return flat({ flags: 2, text: "no module on handle " + handle });
  const sig = m.exports.get(name);
  const f = m.app[name];
  if (sig === undefined || typeof f !== "function") return flat({ flags: 2, text: "no export named " + name });
  let args: unknown[];
  if (sig.params.length === 0) args = [];
  else if (sig.params.length === 1 && sig.params[0] === "i32") args = [arg];
  else if (sig.params.length === 1 && sig.params[0] === "__WacHost") {
    if (m.host === undefined) return flat({ flags: 3, text: "this module was built without __WacHost" });
    args = [m.host];
  } else return flat({ flags: 3, text: "cannot call " + name + "(" + sig.params.join(", ") + ")" });
  if (sig.ret !== "" && sig.ret !== "void" && sig.ret !== "i32" && sig.ret !== "string") {
    return flat({ flags: 3, text: name + " answers " + sig.ret });
  }
  try {
    const out = (f as CallableFunction)(...args);
    if (sig.ret === "string") return flat({ text: String(out ?? "") });
    if (sig.ret === "i32") return flat({ n: BigInt(Number(out) | 0) });
    return flat({});
  } catch {
    // **What the program said, not what the engine said.** `trap "…"` leaves its sentence in a global
    // `$trap$message` reads once the trap has unwound (`issues/lang/0147`). Empty for an engine trap —
    // a bounds check, a null dereference — as the native host reports one.
    let said = "";
    try {
      const read = m.driven.exports.$trap$message;
      const s = typeof read === "function" ? (read as CallableFunction)() : null;
      if (s !== null && s !== undefined) said = String(m.driven.fromWasm("string", s) ?? "");
    } catch { /* asking a module that has just trapped is itself allowed to fail */ }
    return flat({ flags: 1, text: said });
  }
}

/** `validate`: the engine is in this realm. A rejection is compiled again to get its sentence. */
function validate(module: Uint8Array): Flat {
  const bytes = module as BufferSource;
  if (WebAssembly.validate(bytes)) return flat({});
  try {
    new WebAssembly.Module(bytes);
    return flat({ fault: FAULT_OTHER, text: "the engine disagreed with itself about this module" });
  } catch (e) {
    return flat({ fault: FAULT_OTHER, text: e instanceof Error ? e.message : String(e) });
  }
}

// ── The host ──────────────────────────────────────────────────────────────────────────────────

/**
 * The value a program's `main` and its tests are handed, or `undefined` for a module that exports no
 * `__wacHost` — a `main` that declared nothing gets nothing.
 *
 * `grants` narrows a *loaded* module (`issues/system/0242c`); a program's own grants are the
 * launcher's, which refuses what the build did not ask for.
 */
export function hostFor(b: Bridge, app: Record<string, unknown>, grants?: number): unknown {
  const make = app.__wacHost;
  const answered = app.__wacAnswered;
  if (typeof make !== "function" || typeof answered !== "function") return undefined;

  /** Each request in flight on the bridge: what was asked, and its slot. */
  const flights = new Map<number, { op: number; t: Ticket }>();
  /** Dropped before they were answered, holding something to close when they are. */
  let dropped: { op: number; t: Ticket }[] = [];
  let h: unknown = undefined;

  const deliver = (id: number, f: Flat) => {
    if (id === 0) return;
    (answered as CallableFunction)(h, id, f.fault, f.text, f.bytes, f.n, f.m, f.flags);
  };
  const reply = (op: number, t: Ticket): Flat => {
    try {
      return answerOf(op, collect(b, t));
    } catch (e) {
      return failure(e);
    }
  };
  /** Close what a dropped request's answer opened, once it has one. */
  const reap = () => {
    if (dropped.length === 0) return;
    const still: typeof dropped = [];
    for (const d of dropped) {
      if (!isDone(b, d.t)) { still.push(d); continue; }
      const f = reply(d.op, d.t);
      const close = closerOf(d.op);
      if (f.fault === FAULT_NONE && close !== null) {
        try { hostCall(b, close, i32le(Number(f.n))); } catch { /* it closed itself */ }
      }
    }
    dropped = still;
  };
  /**
   * Every one of `ids` whose answer has landed, delivered. A snapshot: delivering may ask again.
   *
   * **Only those asked about.** An answer nobody waits for stays the host's (design/system/0013, settled before
   * step 6), so a request abandoned without being waited for can still be dropped and what it opened closed.
   */
  const deliverReady = (ids: number[]) => {
    for (const id of ids) {
      const f = flights.get(id);
      if (f === undefined || !isDone(b, f.t)) continue;
      flights.delete(id);
      deliver(id, reply(f.op, f.t));
    }
  };

  const request = (op: number, id: number, a64: bigint, b64: bigint, text: string, bytes: Uint8Array) => {
    reap();
    const a = Number(a64);
    const bb = Number(b64);
    if (op === 0) {
      // **An answer nobody has read is still the host's** (design 0013): in flight, its slot is given up,
      // and what it opens is closed when it lands.
      const f = flights.get(id);
      if (f === undefined) return;
      flights.delete(id);
      if (closerOf(f.op) === null) cancel(b, f.t);
      else dropped.push(f);
      return;
    }
    let need = NEEDS[op];
    if (op === OP.OPEN_FILE) need = a === 0 ? GRANT_READ : GRANT_WRITE;
    if (need !== undefined && grants !== undefined && (grants & need) === 0) {
      return deliver(id, flat({ fault: FAULT_NOT_GRANTED, text: REFUSED }));
    }
    switch (op) {
      case OP.LOAD: return deliver(id, load(b, bytes, a));
      case OP.CALL: return deliver(id, call(a, text, bb));
      case OP.UNLOAD: loadedModules.delete(a); return deliver(id, flat({}));
      case OP.VALIDATE: return deliver(id, validate(bytes));
    }
    const payload = payloadOf(op, a, bb, text, bytes);
    if (payload === null) {
      return deliver(id, flat({ fault: FAULT_UNSUPPORTED, text: `this host serves no request ${op}` }));
    }
    if (AT_ONCE.has(op)) {
      let f: Flat;
      try {
        f = answerOf(op, hostCall(b, op, payload));
      } catch (e) {
        f = failure(e);
      }
      return deliver(id, f);
    }
    let t: Ticket;
    try {
      t = submit(b, op, payload);
    } catch (e) {
      return deliver(id, failure(e));
    }
    flights.set(id, { op, t });
  };

  /**
   * Park until one of `ids` is answered, delivering every answer that has landed, and say which by its
   * **index** in `ids`; -1 when nothing did in time. The wait is on the completion counter in this
   * worker's own memory, and the deadline is `Atomics.wait`'s own timeout, so the host is not involved.
   */
  const waitAny = (ids: ArrayLike<number>, millis: number): number => {
    reap();
    const want = Array.from(ids);
    // Answered already — delivered by an earlier wait or inside `request`.
    const gone = want.findIndex((id) => !flights.has(id));
    if (gone >= 0) return gone;
    const tickets = want.map((id) => flights.get(id)!.t);
    const woke = waitOn(b, tickets, millis);
    deliverReady(want);
    if (woke === null) return -1;
    return tickets.findIndex((t) => t.slot === woke.slot && t.gen === woke.gen);
  };

  // Thrown, not acted on: the throw unwinds the program's wasm frames to whoever called `main`.
  const exitWith = (code: number) => { throw new WacExit(code); };

  // **A round trip per ask, and that is also why it works.** While the worker is parked the page's main
  // thread runs, and in a page that is where a keydown arrives — so parking is what lets the host have
  // seen the `^C`.
  const interrupted = (): boolean => readI32le(hostCall(b, OP.ASK_INTERRUPT, EMPTY)) !== 0;

  h = (make as CallableFunction)(request, waitAny, exitWith, interrupted);
  return h;
}

/** `main`'s arguments: the host value when it takes one, nothing when it declared nothing. */
export function mainArgs(b: Bridge, app: Record<string, unknown>): unknown[] {
  const h = hostFor(b, app);
  return h === undefined ? [] : [h];
}

export { HostCallError };
