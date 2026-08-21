// Node's implementation of the world.
//
// The same `Handlers` table as `deno.ts`, over Node's APIs. That the two are
// interchangeable is the point of the bridge: the wac side, the capability structs and
// the opcodes are identical, and only these dozen closures differ.
//
// **Node has no permission system**, so `grants` here is the whole boundary rather than
// half of it. Under Deno a build that withholds the filesystem is enforced twice — by the
// capability world and by the process — and under Node only by the world. That is a real
// difference and the README says so; it is not a reason to skip the grant, because the
// world is what an application is written against either way.

import { type Handlers } from "./respond.ts";
import { EMPTY_ARG, argBytes, i32le, i64le, readI32le, str, unstr } from "./call.ts";
import { GRANT_ENV, GRANT_NET, GRANT_READ, GRANT_WRITE, OP } from "./ops.ts";
import { randomBytes } from "./entropy.ts";
import { ChildStack, envRecord, joinPath, packCaptured, unpackExec, unpackPush } from "./child.ts";
import { ByteQueue } from "./queue.ts";
import {
  type Child,
  failedChild,
  moduleEntryFromSource,
  noSpawnHere,
  spawnChild,
  childHandles,
  FIRST_FREE_HANDLE,
  PARENT_FS_HANDLE,
  unpackSpawn,
  unpackSpawnSelf,
  want,
  type WorkerLike,
} from "./children.ts";
import { bridgeOf, newBridge } from "./layout.ts";
import { serveHostCalls } from "./respond.ts";
import {
  CHANGED_OK,
  FAULT_NOT_GRANTED,
  FAULT_UNSUPPORTED,
  Faulted,
  STAT_BYTES,
  STAT_EXEC,
  STAT_FAULT,
  changeBytes,
  execBytes,
  changed,
  readFailure,
  statFault,
} from "./faults.ts";

/** Node's pieces, described rather than imported, so this file checks under Deno. */
export type NodeIo = {
  readStdin(): Promise<Uint8Array>;
  /** One chunk of standard input, or empty at its end. */
  readStdinChunk(): Promise<Uint8Array>;
  /** A file opened for sequential reading; `read` answers empty at the end. */
  openFile(path: string): Promise<{ read(): Promise<Uint8Array>; close(): Promise<void> }>;
  /** A file opened for writing, truncated. */
  createFile(path: string): Promise<{ write(b: Uint8Array): Promise<void>; close(): Promise<void> }>;
  /**
   * The network, in the same shape Deno's is.
   *
   * Node's `net` is event-based, so the wrapper that gives it this shape lives in
   * `entryNode.ts` where the module is actually available. What crosses here is already
   * promise-shaped, which is all the bridge needs.
   */
  connect(host: string, port: number): Promise<NodeSock>;
  listen(address: string, port: number): Promise<NodeListener>;
  /** A bound UDP socket. See design/system 0007 for why this is not `connect` with a flag. */
  bindDatagram(address: string, port: number): Promise<NodeDatagram>;
  writeStdout(bytes: Uint8Array): Promise<void>;
  /** The error stream as bytes. Optional: a host without one falls back to `warn`'s line. */
  writeStderr?(bytes: Uint8Array): Promise<void>;
  stat(
    path: string,
  ): Promise<{ isFile: boolean; isDirectory: boolean; size: number; mtimeMillis: number; mode?: number }>;
  /**
   * `stat` without following the last component. Optional: a host that cannot tell answers as `stat`
   * does, which is honest for a filesystem with no links and wrong for nothing.
   */
  linkStat?(
    path: string,
  ): Promise<{
    isFile: boolean;
    isDirectory: boolean;
    size: number;
    mtimeMillis: number;
    isSymlink: boolean;
    /** Optional: an implementation with no POSIX bits leaves it out, and nothing is executable. */
    mode?: number;
  }>;
  readDir(path: string): Promise<string[]>;
};

/**
 * One bound datagram socket.
 *
 * `receive` answers the payload **and** its sender together. Two calls would let a program pair one
 * datagram's bytes with another's sender, and neither half would look wrong.
 */
export type NodeDatagram = {
  receive(): Promise<{ bytes: Uint8Array; peer: string; port: number }>;
  sendTo(bytes: Uint8Array, host: string, port: number): Promise<void>;
  close(): void;
  /** The port it was given, so binding to 0 is usable. */
  port?: number;
};

/** One connection, however the platform underneath spells it. */
export type NodeSock = {
  recv(): Promise<Uint8Array>;   // empty when the peer has closed
  send(b: Uint8Array): Promise<void>;
  close(): void;
  /**
   * End the outbound direction and keep reading — `issues/system/0215`.
   *
   * Optional because a `NodeSock` is whatever the generated launcher hands over, and one built
   * before this existed has no such method; `CLOSE_SEND` on a socket without it does nothing rather
   * than throwing, which is the same shape as closing an already-closed socket.
   */
  closeSend?(): void;
  /** The address at the other end, where the runtime says. Absent for one this program dialled. */
  peer?: string;
  /** This end's port, so a socket given an ephemeral one can say which it got. */
  port?: number;
};

export type NodeListener = {
  accept(): Promise<NodeSock>;
  close(): void;
  /** The port it was bound to, which is the answer `listen(…, 0)` needs. */
  port?: number;
};

export type NodeWorldOptions = {
  /**
   * The program's arguments.
   *
   * Strings are accepted because that is what a launcher has — `Deno.args` is already text, and an
   * operating system that handed us bytes gave them to the runtime first. Bytes are accepted because a
   * *parent* has them exactly, and a spawned child must receive what its parent sent rather than a
   * UTF-8 round trip of it. wac-mono 0065.
   */
  args?: (string | Uint8Array)[];
  /**
   * How to start a worker, when this launcher can.
   *
   * Injected because `node:worker_threads` is not importable from here — this file describes Node's
   * pieces rather than importing them, so that it type-checks under Deno — and because it is the
   * only part of spawning that differs between the hosts. `entryNode.ts` has `wt` and passes the
   * three lines that wrap it; absent, `spawn` says so rather than failing the program.
   */
  makeWorker?: (source: string) => WorkerLike;
  /**
   * This program's own worker bundle, for `spawnSelf`. Passed by the launcher, which has it because
   * it is what started the program.
   */
  selfSource?: string;
  /**
   * The generic wasm-child entry, already bundled, so `spawn` can start a **module** here too.
   *
   * The Node twin of `deno.ts`'s option, and it is a separate bundle rather than the same one: a
   * module is driven identically on both, but the worker loop it is handed to is `entryNode.ts`'s.
   * Absent means the host looks for `childWasmNode.ts` beside its own source, which is right from a
   * source tree and finds nothing in a built application. `issues/system/0144`.
   */
  moduleEntry?: string;
  /** Where relative paths resolve from, and what `cwd` reports. Absent means the process's own. */
  cwd?: string;
  /**
   * **May answer a promise, and every caller awaits it.**
   *
   * Declared `void` and implemented `async` — which TypeScript permits, since a `Promise<void>` is
   * assignable to `void` — this dropped the promise at each call site. Two consequences, one loud
   * and one silent: a rejection became an *unhandled* one and took the process down (issue 0115,
   * `yes | head -1` under load), and two writes could land in either order under backpressure,
   * because the guest was released before the first had finished. A spawned child's output goes
   * through here, and pushing to a queue is asynchronous exactly when the queue is full.
   */
  log?(line: string): void | Promise<void>;
  warn?(line: string): void | Promise<void>;
  fs?: { read?: boolean; write?: boolean };
  net?: boolean;
  /** Running a host *program* — `Cli.exec`. Left out means every call is refused. */
  run?: boolean;
  env?(name: string): string | undefined;
  /** The channel to this program's parent's filesystem, when it is a spawned child — see `deno.ts`. */
  parentFs?: { req: ByteQueue; rep: ByteQueue };
};

const EMPTY = new Uint8Array(0);

/** A read answer, tagged: 0 data, 1 end, 2 failed. See `Read` in platform.wac. */
function data(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length + 1);
  out[0] = 0;
  out.set(bytes, 1);
  return out;
}
const END = new Uint8Array([1]);
function failed(why: string): Uint8Array {
  const message = new TextEncoder().encode(why);
  const out = new Uint8Array(message.length + 1);
  out[0] = 2;
  out.set(message, 1);
  return out;
}

/**
 * A handle, this socket's own port, and the peer's address — which is what `Socket` decodes.
 *
 * The same shape the Deno host answers with: two i32s, then whatever follows is the address. Only
 * `accept` has a peer to name; the port is what a socket that asked for 0 was actually given.
 */
function withPeer(handle: number, peer: string, port = 0): Uint8Array {
  const text = new TextEncoder().encode(peer);
  const out = new Uint8Array(8 + text.length);
  const view = new DataView(out.buffer);
  view.setInt32(0, handle, true);
  view.setInt32(4, port, true);
  out.set(text, 8);
  return out;
}

/** A `warn` payload as a line of a captured error stream: its bytes, then a newline. */
function lineOf(p: Uint8Array): Uint8Array {
  const out = new Uint8Array(p.length + 1);
  out.set(p, 0);
  out[p.length] = 10;
  return out;
}

/**
 * `WAC_LOAD_GRACE_MS`, when it is set.
 *
 * The same knob `deno.ts` reads, for the same reason: only `spawn.test.ts` sets it, so that the one
 * test which has to wait out the ready deadline waits a second rather than thirty.
 */
function graceEnv(): number | undefined {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.WAC_LOAD_GRACE_MS;
  return raw === undefined ? undefined : Number(raw);
}

/** Node's globals, described rather than imported, so this file type-checks under Deno. */
type NodeProcess = { argv: string[]; env: Record<string, string | undefined> };
type NodeFs = {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  mkdir(path: string, opts: { recursive: boolean }): Promise<unknown>;
  rm(path: string, opts: { recursive: boolean; force: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /**
   * Optional, because a `NodeFs` standing in for something without POSIX bits cannot do it.
   *
   * Absent means `setExecutable` answers `FAULT_UNSUPPORTED` — the capability exists and this backing
   * refuses, which is the same shape the browser host reports and a different thing from not granting it.
   */
  chmod?(path: string, mode: number): Promise<void>;
};

export function nodeWorld(
  fs: NodeFs,
  proc: NodeProcess,
  io: NodeIo,
  opts: NodeWorldOptions = {},
): Handlers {
  const args = opts.args ?? proc.argv.slice(2);
  const log = opts.log ?? ((l: string) => console.log(l));
  const warn = opts.warn ?? ((l: string) => console.error(l));

  // The current streaming input; null means standard input. See the note in platform.wac.
  let source: { read(): Promise<Uint8Array>; close(): Promise<void> } | null = null;
  let sink: { write(b: Uint8Array): Promise<void>; close(): Promise<void> } | null = null;

  const sockets = new Map<number, NodeSock>();
  const listeners = new Map<number, NodeListener>();
  // Its own map: a datagram socket is neither a connection nor a listener, and a `recv` on one
  // would have no peer to report. design/system 0007.
  const datagrams = new Map<number, NodeDatagram>();
  /** Children by handle, in the same namespace as sockets: `waitAny` does not care which is which. */
  const children = new Map<number, Child>();
  /**
   * A child's error stream, by its own handle.
   *
   * Separate from `children` because it is a separate stream, and reading it is `recv` like anything
   * else — a handle is a handle, which is what lets `waitAny` watch a child's two streams and a
   * socket in one call.
   */
  const errStreams = new Map<number, ByteQueue>();
  /** A child's filesystem channel, by its own handle — see the note in `deno.ts`. */
  const fsChannels = new Map<number, { req: ByteQueue; rep: ByteQueue }>();
  let nextHandle = FIRST_FREE_HANDLE;

  /**
   * Start a child on `source`, with `want` narrowed to this world's own authority.
   *
   * Shared by `spawn` and `spawnSelf`, which differ only in where the source comes from. Asking for
   * more than the parent has is not an error: the child finds the capability denied.
   */
  const startChild = async (
    // A worker bundle as text, or a wasm module as bytes — `spawnChild` tells them apart.
    source: string | Uint8Array,
    childArgs: Uint8Array[],
    wanted: number,
    childCwd: string,
    inheritIn: boolean,
    serveFs: boolean,
  ): Promise<Uint8Array> => {
    const makeWorker = opts.makeWorker;
    if (makeWorker === undefined) {
      return noSpawnHere("this Node launcher was built without a way to start a worker");
    }
    const give = {
      read: (wanted & GRANT_READ) !== 0 && opts.fs?.read === true,
      write: (wanted & GRANT_WRITE) !== 0 && opts.fs?.write === true,
      net: (wanted & GRANT_NET) !== 0 && opts.net === true,
      env: (wanted & GRANT_ENV) !== 0 && opts.env !== undefined,
    };
    const h = nextHandle++;
    const child = spawnChild(source, childArgs, (sab, cargs, out, input, cerr, parentFs) => {
      const enc = new TextEncoder();
      // The child's stdio is the parent's queues. Everything else about its world — files, sockets,
      // the clock — is this world's, narrowed by `give`.
      // An inheriting child keeps `io`'s own readers, which are the process's standard input: it reads
      // the same stream its parent would have, streaming and shared. Issue 0042.
      const childIo: NodeIo = {
        ...io,
        ...(inheritIn ? {} : {
          readStdin: () => input.rest(),
          readStdinChunk: () => input.next(),
        }),
        writeStdout: async (b: Uint8Array) => {
          // See the note in `deno.ts`: a full queue must fail the write rather than growing.
          // Awaited: a full queue *waits* for the parent to read, and only a queue that has ended
          // refuses. The two were one answer, and a producer told to stop when it should have waited
          // truncated a redirection silently — see `ByteQueue.push`.
          if (!await out.push(b)) throw new Error("the child's output is not being read");
        },
        writeStderr: async (b: Uint8Array) => { await cerr.push(b); },
      };
      return serveHostCalls(bridgeOf(sab), nodeWorld(fs, proc, childIo, {
        args: cargs,
        ...(give.read || give.write ? { fs: { read: give.read, write: give.write } } : {}),
        ...(give.net ? { net: true } : {}),
        ...(give.env ? { env: opts.env } : {}),
        // A line of output is bytes on the handle, with the newline `log` implies.
        log: async (l: string) => { await out.push(enc.encode(l + "\n")); },
        warn: async (l: string) => { await cerr.push(enc.encode(l + "\n")); },
        makeWorker,
        // Its parent's filesystem, on a handle of its own — wac-mono 0116, and see `deno.ts` for
        // why this is passed unconditionally rather than as a grant.
        parentFs,
        selfSource: opts.selfSource,
        // And the entry for a child that is a module, so that a grandchild can start one too.
        moduleEntry: opts.moduleEntry,
        cwd: childCwd === "" ? opts.cwd : childCwd,
      }));
    }, newBridge, makeWorker, graceEnv(), opts.moduleEntry ?? moduleEntryFromSource("node"));

    // **A parent that will not serve says so before the child runs.** Ending the reply queue is
    // what makes `Fs.overParent` answer immediately instead of waiting: a child asks one question,
    // reads end-of-channel, and falls back to the host. Every spawner that predates the channel
    // passes false, so nothing that used to work now waits on a parent that was never going to
    // answer. See `spawnSelf` in platform.wac.
    if (!serveFs) child.fsRep.end();
    const why = await child.loaded;
    if (why !== "") {
      child.kill();
      return failedChild(why);
    }
    // Two handles for one child: its output and its error stream. Numbered from the same counter, so
    // `waitAny` can watch both beside a socket without knowing which is which.
    const eh = nextHandle++;
    const fh = nextHandle++;
    children.set(h, child);
    errStreams.set(eh, child.err);
    fsChannels.set(fh, { req: child.fsReq, rep: child.fsRep });
    return childHandles(h, eh, fh, "");
  };
  // `Faulted`, so a withheld capability arrives as its own category rather than as an `EACCES` lookalike:
  // `FAULT_DENIED` is the file saying no, and this is the program never having been given the file.
  const deny = (what: string) => {
    throw new Faulted(FAULT_NOT_GRANTED, `${what} not granted to this application`);
  };

  // A program running inside this one. `P` is the identity when nothing is pushed.
  const kids = new ChildStack();
  // `write` answers a bool and cannot carry a reason, so this is recorded for `outputError`. The
  // reads no longer need an equivalent: `Read` carries theirs.
  let outputFailure = "";
  const P = (path: string) => joinPath(opts.cwd ?? "", kids.path(path));

  return {
    [OP.NOW_MILLIS]: () => i64le(BigInt(Date.now())),
    [OP.MONOTONIC_NANOS]: () => i64le(BigInt(Math.round(performance.now() * 1e6))),
    // A timer, which is what makes a timeout expressible: waited on beside another ticket,
    // whichever lands first decides. Resolves to the monotonic nanoseconds at which it fired
    // rather than to nothing, so a caller can see the overshoot.
    //
    // `unref()` is deliberately absent: an outstanding timer holding the event loop open
    // is what keeps a worker parked on it from waiting forever.
    [OP.CWD]: () => str(opts.cwd !== undefined && opts.cwd !== "" ? opts.cwd : process.cwd()),
    [OP.SLEEP_MILLIS]: (p) =>
      new Promise<Uint8Array>((ok) =>
        setTimeout(() => ok(i64le(BigInt(Math.round(performance.now() * 1e6)))), readI32le(p))
      ),
    [OP.RANDOM_BYTES]: (p) => randomBytes(readI32le(p)),
    // `log` is standard output, so a child's lines are kept with the rest of its output rather
    // than appearing on the parent's terminal. Thirty of `box`'s applets write this way.
    [OP.LOG]: async (p) => {
      if (kids.active) { kids.write(lineOf(p)); return EMPTY; }
      await log(unstr(p));
      return EMPTY;
    },
    /**
     * Nobody can ask this host to interrupt, so the answer is no — the answer, not a stub.
     *
     * `Core.askInterrupt` is answered by whoever owns the keyboard. Here the terminal belongs to
     * whatever started the process, and over ssh to `sshd`, which is a wac program on the far side of
     * an encrypted socket. A host that cannot be asked truthfully reports that it has not been.
     */
    [OP.ASK_INTERRUPT]: () => i32le(0),
    [OP.WARN]: async (p) => {
      if (kids.warn(lineOf(p))) return EMPTY;
      await warn(unstr(p));
      return EMPTY;
    },

    [OP.PUSH_CHILD]: (p) => {
      const { argv, stdin, cwd, inheritInput } = unpackPush(p);
      kids.push(argv, stdin, cwd, inheritInput);
      return EMPTY;
    },
    [OP.POP_CHILD]: () => {
      const { out, err, truncated } = kids.pop();
      return packCaptured(out, err, truncated);
    },

    // A child has its own command line: an applet reading `cli.arg(1)` must see what the shell
    // typed, not what the shell itself was started with.
    [OP.ARG_COUNT]: () => i32le((kids.args() ?? args).length),
    [OP.ARG]: (p) => {
      const own = kids.args() ?? args;
      const i = readI32le(p);
      // The bytes, unchanged. A program that wants text says `string.fromBytes` on its own side.
      return i >= 0 && i < own.length ? argBytes(own[i]) : EMPTY_ARG;
    },
    [OP.ENV]: (p) => {
      const v = opts.env?.(unstr(p));
      if (v === undefined) return new Uint8Array([0]);
      const b = str(v);
      const out = new Uint8Array(1 + b.length);
      out[0] = 1;
      out.set(b, 1);
      return out;
    },

    [OP.READ_FILE]: async (p) => {
      if (!opts.fs?.read) deny("filesystem read");
      // Node hands back a Buffer, which is a Uint8Array — but a *view* into a pooled
      // allocation, so it is copied rather than parked in the bridge as it came.
      return new Uint8Array(await fs.readFile(P(unstr(p))));
    },

    // stdin and stdout need no grant: what the user pipes in and what the program prints
    // are the user's own doing, not a reach into something they did not offer.
    [OP.READ_STDIN]: async () => kids.readAll() ?? await io.readStdin(),
    [OP.WRITE_STDOUT]: async (p) => {
      if (kids.active) {
        if (!kids.write(p)) throw new Error("the child's output buffer is full");
        return EMPTY;
      }
      try {
        if (sink === null) { await io.writeStdout(p); return EMPTY; }
        await sink.write(p);
        return EMPTY;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        outputFailure = /EPIPE|broken pipe/i.test(message) ? "" : message;
        throw e;
      }
    },

    /**
     * Standard error as bytes. Not through `sink`, which is standard output's redirection: a `2>`
     * that followed a `1>` would leave a program no way to separate them.
     */
    [OP.WRITE_STDERR]: async (p) => {
      if (kids.active) { kids.warn(p); return EMPTY; }
      try {
        if (io.writeStderr === undefined) { warn(unstr(p)); return EMPTY; }
        await io.writeStderr(p);
        return EMPTY;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        outputFailure = /EPIPE|broken pipe/i.test(message) ? "" : message;
        throw e;
      }
    },

    /**
     * A worker on the source it is handed, with a world of its own.
     *
     * The same `spawnChild` the Deno and browser hosts use. What differs here is only how a worker
     * is made — Node takes a source string with `eval` rather than a module from a blob URL — which
     * is why that is an argument. A launcher that did not pass one says so in the shape a caller can
     * act on: -2, "there is no spawn here", which is not a fact about the program.
     */
    [OP.SPAWN]: (p) => {
      const { source, args, cwd, inheritIn, serveFs } = unpackSpawn(p);
      // **Bytes, whichever kind they are.** A worker bundle and a wasm module both start here now;
      // `spawnChild` wraps a module in a stub that drives it from its own manifest.
      return startChild(source, args, want(p), cwd, inheritIn, serveFs);
    },

    /** This same program again, with different arguments. See `spawnSelf` in platform.wac. */
    [OP.SPAWN_SELF]: (p) => {
      if (opts.selfSource === undefined) {
        return Promise.resolve(
          noSpawnHere("this launcher did not pass the program its own source"),
        );
      }
      const { args, cwd, inheritIn, serveFs } = unpackSpawnSelf(p);
      return startChild(opts.selfSource, args, want(p), cwd, inheritIn, serveFs);
    },
    [OP.CLOSE_FEED]: (p) => {
      children.get(readI32le(p))?.in.end();
      return EMPTY;
    },
    [OP.EXIT_CODE]: async (p) => {
      const c = children.get(readI32le(p));
      if (c === undefined) throw new Error("not a spawned worker");
      return i32le(await c.exit);
    },

    [OP.STAT]: async (p) => {
      const out = new Uint8Array(STAT_BYTES);
      const dv = new DataView(out.buffer);
      // Not granted is not absence — see the Deno host, which says why at length.
      if (!opts.fs?.read) {
        out[STAT_FAULT] = FAULT_NOT_GRANTED;
        return out;
      }
      const path = P(unstr(p));
      try {
        const st = await io.stat(path);
        out[0] = 1;
        out[1] = st.isFile ? 1 : 0;
        out[2] = st.isDirectory ? 1 : 0;
        dv.setBigInt64(3, BigInt(st.size), true);
        dv.setBigInt64(11, BigInt(st.mtimeMillis ?? 0), true);
        out[STAT_EXEC] = ((st.mode ?? 0) & 0o100) !== 0 ? 1 : 0;
      } catch (e) {
        out[STAT_FAULT] = statFault(e, path);
      }
      return out;
    },
    [OP.LINK_STAT]: async (p) => {
      const out = new Uint8Array(STAT_BYTES);
      const dv = new DataView(out.buffer);
      if (!opts.fs?.read) {
        out[STAT_FAULT] = FAULT_NOT_GRANTED;
        return out;
      }
      const path = P(unstr(p));
      try {
        const st = io.linkStat === undefined
          ? { ...(await io.stat(path)), isSymlink: false }
          : await io.linkStat(path);
        out[0] = 1;
        out[1] = st.isFile ? 1 : 0;
        out[2] = st.isDirectory ? 1 : 0;
        dv.setBigInt64(3, BigInt(st.size), true);
        dv.setBigInt64(11, BigInt(st.mtimeMillis ?? 0), true);
        out[19] = st.isSymlink ? 1 : 0;
        out[STAT_EXEC] = ((st.mode ?? 0) & 0o100) !== 0 ? 1 : 0;
      } catch (e) {
        out[STAT_FAULT] = statFault(e, path);
      }
      return out;
    },

    [OP.READ_DIR]: async (p) => {
      if (!opts.fs?.read) deny("filesystem read");
      const names = await io.readDir(P(unstr(p)));
      return str(names.join("\u0000"));
    },
    [OP.WRITE_FILE]: (p) => {
      if (!opts.fs?.write) return changeBytes(FAULT_NOT_GRANTED, "filesystem write not granted to this application");
      const n = readI32le(p);
      return changed(() => fs.writeFile(P(unstr(p.subarray(4, 4 + n))), p.subarray(4 + n)));
    },

    [OP.OPEN_INPUT]: async (p) => {
      const path = unstr(p);
      await source?.close();
      source = null;
      if (path === "") return CHANGED_OK;
      // A category rather than the host's sentence, as `openOutput` above — see `platform.wac`.
      if (!opts.fs?.read) return changeBytes(FAULT_NOT_GRANTED, "filesystem read not granted to this application");
      return await changed(async () => {
        source = await io.openFile(P(path));
      });
    },
    [OP.READ_CHUNK]: async () => {
      const fed = source === null ? kids.readChunk() : null;
      if (fed !== null) return fed.length === 0 ? END : data(fed);
      try {
        const got = source === null ? await io.readStdinChunk() : await source.read();
        return got.length === 0 ? END : data(got);
      } catch (e) {
        // The category's phrase where there is one; see the same line in `deno.ts`.
        return failed(readFailure(e));
      }
    },
    [OP.OUTPUT_ERROR]: () => str(outputFailure),

    [OP.OPEN_OUTPUT]: async (p) => {
      const path = unstr(p);
      await sink?.close();
      sink = null;
      if (path === "") return CHANGED_OK;
      if (!opts.fs?.write) return changeBytes(FAULT_NOT_GRANTED, "filesystem write not granted to this application");
      return await changed(async () => { sink = await io.createFile(P(path)); });
    },

    [OP.CONNECT]: async (p) => {
      if (!opts.net) deny("network access");
      const c = await io.connect(unstr(p.subarray(4)), readI32le(p));
      const h = nextHandle++;
      sockets.set(h, c);
      return withPeer(h, "", c.port ?? 0);
    },
    /** Bind an address and a port; empty means every interface. See `listen` in platform.wac. */
    [OP.LISTEN]: async (p) => {
      if (!opts.net) deny("network access");
      const l = await io.listen(unstr(p.subarray(4)), readI32le(p));
      const h = nextHandle++;
      listeners.set(h, l);
      return withPeer(h, "", l.port ?? 0);
    },
    /** Bind a datagram socket, under `listen`'s address rule. design/system 0007. */
    [OP.BIND_DATAGRAM]: async (p) => {
      if (!opts.net) deny("network access");
      const d = await io.bindDatagram(unstr(p.subarray(4)), readI32le(p));
      const h = nextHandle++;
      datagrams.set(h, d);
      return withPeer(h, "", d.port ?? 0);
    },
    /** One datagram and the peer that sent it, in one answer. */
    [OP.RECEIVE_FROM]: async (p) => {
      const d = datagrams.get(readI32le(p));
      if (d === undefined) throw new Error("not an open datagram socket");
      const got = await d.receive();
      const peer = new TextEncoder().encode(got.peer);
      const out = new Uint8Array(8 + peer.length + got.bytes.length);
      const view = new DataView(out.buffer);
      view.setInt32(0, got.port, true);
      view.setInt32(4, peer.length, true);
      out.set(peer, 8);
      out.set(got.bytes, 8 + peer.length);
      return out;
    },
    /** A datagram to a peer named in this call, which is what makes one socket serve many. */
    [OP.SEND_TO]: async (p) => {
      const d = datagrams.get(readI32le(p));
      if (d === undefined) throw new Error("not an open datagram socket");
      const port = readI32le(p.subarray(4));
      const hostLen = readI32le(p.subarray(8));
      await d.sendTo(p.slice(12 + hostLen), unstr(p.subarray(12, 12 + hostLen)), port);
      return EMPTY;
    },
    [OP.ACCEPT]: async (p) => {
      const l = listeners.get(readI32le(p));
      if (l === undefined) throw new Error("not a listening socket");
      const c = await l.accept();
      const h = nextHandle++;
      sockets.set(h, c);
      // The peer travels with the handle, so a server can refuse one that is not from this machine.
      return withPeer(h, c.peer ?? "", c.port ?? 0);
    },
    [OP.RECV]: async (p) => {
      const h = readI32le(p);
      // Handle 0 is standard input — see the note in `deno.ts`.
      if (h === 0) {
        const piped = await io.readStdinChunk();
        return piped.length === 0 ? END : data(piped);
      }
      const kid = children.get(h);
      if (kid !== undefined) {
        const fromChild = await kid.out.next();
        return fromChild.length === 0 ? END : data(fromChild);
      }
      const complaint = errStreams.get(h);
      if (complaint !== undefined) {
        const said = await complaint.next();
        return said.length === 0 ? END : data(said);
      }
      // The two ends of a child's filesystem channel — see the note in `deno.ts`.
      if (h === PARENT_FS_HANDLE && opts.parentFs !== undefined) {
        const answer = await opts.parentFs.rep.next();
        return answer.length === 0 ? END : data(answer);
      }
      const asking = fsChannels.get(h);
      if (asking !== undefined) {
        const request = await asking.req.next();
        return request.length === 0 ? END : data(request);
      }
      const c = sockets.get(h);
      if (c === undefined) return failed("not an open socket");
      try {
        const got = await c.recv();
        return got.length === 0 ? END : data(got);
      } catch (e) {
        return failed(e instanceof Error ? e.message : String(e));
      }
    },
    [OP.SEND]: async (p) => {
      const kid = children.get(readI32le(p));
      if (kid !== undefined) {
        // **Awaited, and its answer is the capability's answer.** `ByteQueue.push` waits for room
        // and answers false once the queue has ended, which is exactly what `send` promises — and
        // this line discarded both: a send after `closeFeed` reported success and dropped the bytes
        // (0121), and a send into a full queue did not wait, so backpressure did not hold (0120).
        // The runtime with no JavaScript in it has always answered `stream.write` here.
        //
        // Throwing is how a `Pending<bool>` says false on this side: `provider.ts`'s `ok` is
        // "collect did not throw", which is the same route `deny` already takes.
        if (!await kid.in.push(p.slice(4))) throw new Error("the child's input has ended");
        return EMPTY;
      }
      if (readI32le(p) === PARENT_FS_HANDLE && opts.parentFs !== undefined) {
        await opts.parentFs.req.push(p.slice(4));
        return EMPTY;
      }
      const answering = fsChannels.get(readI32le(p));
      if (answering !== undefined) {
        await answering.rep.push(p.slice(4));
        return EMPTY;
      }
      const c = sockets.get(readI32le(p));
      if (c === undefined) throw new Error("not an open socket");
      await c.send(p.subarray(4));
      return EMPTY;
    },
    /** End the outbound direction and keep reading — `issues/system/0215`. */
    [OP.CLOSE_SEND]: (p) => {
      const h = readI32le(p);
      try { sockets.get(h)?.closeSend?.(); } catch { /* already closed, or not a stream */ }
      return EMPTY;
    },
    [OP.CLOSE_SOCKET]: (p) => {
      const h = readI32le(p);
      try { sockets.get(h)?.close(); } catch { /* already closed */ }
      try { listeners.get(h)?.close(); } catch { /* already closed */ }
      // A child's handle ends its input and stops it, as in every host: `closeFeed` is the one that
      // ends the input alone.
      try { children.get(h)?.in.end(); children.get(h)?.kill(); } catch { /* gone */ }
      // Ending a filesystem channel is how a child parked on a request learns nobody will answer.
      const channel = fsChannels.get(h);
      if (channel !== undefined) { channel.req.end(); channel.rep.end(); }
      // **The child itself stays in the table.** Its status is still a question worth asking — a
      // parent that stops a child and wants to know it is gone asks `exitCode` next, which is what
      // supervising anything means — and `kill` has already settled that answer at -1. Dropping it
      // here made `exitCode` on a stopped child throw "not a spawned worker" and take the *parent*
      // down with it, on a call platform.wac describes as ordinary.
      sockets.delete(h);
      listeners.delete(h);
      errStreams.delete(h);
      fsChannels.delete(h);
      return EMPTY;
    },

    /** `Cli.exec` — a host program, run to completion. `issues/system/0165`. */
    [OP.EXEC_WITH]: async (p) => {
      const { path, args, env, stdin, clearEnv, inherit } = unpackExec(p);
      if (opts.run !== true) return execBytes(0, EMPTY, EMPTY, "Not granted to this application");
      try {
        const { spawn } = await import("node:child_process");
        return await new Promise<Uint8Array>((resolve) => {
          // Node replaces the whole environment when it is given one, where Deno adds unless it
          // is told to clear — so the merge is written out here rather than left to a default that
          // differs between the two hosts serving the same capability.
          const child = spawn(path, args, {
            stdio: inherit ? ["pipe", "inherit", "inherit"] : ["pipe", "pipe", "pipe"],
            env: clearEnv ? envRecord(env) : { ...process.env, ...envRecord(env) },
          });
          const out: Uint8Array[] = [];
          const err: Uint8Array[] = [];
          // Null when inherited — the bytes went to this process's own descriptors, which is what
          // the caller asked for, and there is no stream here to read them from.
          child.stdout?.on("data", (c: Uint8Array) => out.push(c));
          child.stderr?.on("data", (c: Uint8Array) => err.push(c));
          child.on("error", (e: Error) => resolve(execBytes(0, EMPTY, EMPTY, `${path}: ${e.message}`)));
          // A signalled child has no code; -1 rather than 0, so it is never read as success.
          // Node hands each stream back in chunks; `exec` answers one buffer per stream.
          const concat = (parts: Uint8Array[]): Uint8Array => {
            const whole = new Uint8Array(parts.reduce((n, c) => n + c.length, 0));
            let at = 0;
            for (const c of parts) {
              whole.set(c, at);
              at += c.length;
            }
            return whole;
          };
          child.on("close", (code: number | null) =>
            resolve(execBytes(code ?? -1, concat(out), concat(err), "")));
          // **Ignored, and both Rust hosts have always ignored it** — `let _ = write_all(&stdin)`.
          // A child that exits without reading its input closes the pipe, and `/bin/echo` does
          // exactly that: the bytes were not wanted, which is the child's business rather than a
          // failure of this call. Node raises it as an `error` *event* on the stream, so nothing
          // catches it and an EPIPE from `echo` took the whole host down — found by
          // `test/wac/exec_probe.wac`, which is the first program to run `echo` through this host.
          child.stdin?.on("error", () => {});
          // Always a pipe — both branches above ask for one, and only the *output* streams differ
          // between inherited and buffered. The `?` is the price of a union type, not a case.
          child.stdin?.end(stdin);
        });
      } catch (e) {
        return execBytes(0, EMPTY, EMPTY, `${path}: ${e instanceof Error ? e.message : e}`);
      }
    },
    [OP.MKDIR]: (p) => {
      if (!opts.fs?.write) return changeBytes(FAULT_NOT_GRANTED, "filesystem write not granted to this application");
      return changed(() => fs.mkdir(P(unstr(p.subarray(1))), { recursive: p[0] === 1 }));
    },
    [OP.REMOVE]: (p) => {
      if (!opts.fs?.write) return changeBytes(FAULT_NOT_GRANTED, "filesystem write not granted to this application");
      // `force: false` so that removing something absent fails, as `Deno.remove` does — and now that
      // the failure carries a category, `rm -f` can ignore exactly that one rather than all of them.
      return changed(() => fs.rm(P(unstr(p.subarray(1))), { recursive: p[0] === 1, force: false }));
    },
    [OP.RENAME]: (p) => {
      if (!opts.fs?.write) return changeBytes(FAULT_NOT_GRANTED, "filesystem write not granted to this application");
      const n = readI32le(p);
      return changed(() =>
        fs.rename(P(unstr(p.subarray(4, 4 + n))), P(unstr(p.subarray(4 + n))))
      );
    },
    [OP.SET_EXECUTABLE]: (p) => {
      if (!opts.fs?.write) return changeBytes(FAULT_NOT_GRANTED, "filesystem write not granted to this application");
      const chmod = fs.chmod;
      if (chmod === undefined) {
        return changeBytes(FAULT_UNSUPPORTED, "this filesystem has no mode bits to set");
      }
      const path = P(unstr(p.subarray(1)));
      const on = p[0] === 1;
      // The one bit, read-modify-write, and the execute bits following read — the same rule as the Deno
      // host, and it is `chmod +x`'s rule rather than a whole mode chosen here.
      return changed(async () => {
        const mode = (await io.stat(path)).mode ?? 0o644;
        const bits = on ? mode | ((mode & 0o444) >> 2) : mode & ~0o111;
        await chmod(path, bits & 0o7777);
      });
    },
  };
}
