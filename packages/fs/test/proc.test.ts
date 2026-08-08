// The process table, and `/proc`'s format against the host's own `/proc`.
//
// design/0001 step 3. Two halves, and they have different oracles.
//
// The **table** has none: pids, parents and states are ours by decision, so what is checked is that the
// rules it claims hold — a pid is never reused, a row outlives the process until it is reaped, a signal
// to something that has exited is refused rather than recorded.
//
// The **format** has a real one, and it is the whole reason to test this way: this machine has a
// `/proc`, written by Linux, answering the same three files. A `status` of our own invention would pass
// any expectation typed here and fail the first program that parsed it, so every shape assertion below
// is taken from the host's file rather than from what I thought Linux wrote. Where we are a subset —
// four keys against Linux's fifty — that is asserted *as* a subset, so a key we invent fails.

import { wacBind } from "../../../harness/wacBind.ts";
import "../../../harness/spawnRetry.ts";

/** Local, because this repo has no third-party dependencies. Structural, because listings are arrays. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const mod = await wacBind("packages/fs/src/proc.wac") as unknown as {
  Procs: { create(): ProcsHandle };
  "Vec$string": { create(): VecHandle };
};

type VecHandle = { push(s: string): void };
type ProcsHandle = {
  start(ppid: number, argv: VecHandle, now: bigint): number;
  find(pid: number): { pid: number; ppid: number; state: number; exitCode: number } | null;
  has(pid: number): boolean;
  exited(pid: number, code: number): boolean;
  reap(pid: number): number;
  signal(pid: number, sig: number): boolean;
  takeSignal(pid: number): number;
  pids(): Int32Array | number[];
  len(): number;
};

const fs = await wacBind("packages/fs/src/fs.wac") as unknown as {
  Fs: { inMemory(now: bigint): FsHandle };
  "Vec$string": { create(): VecHandle };
};

type FsHandle = {
  enter(argv: VecHandle): number;
  mountSynth(at: string, random: unknown): void;
  readFile(path: string): { ok: boolean; bytes: Uint8Array; error: string };
  readDir(path: string): string[] | null;
  stat(path: string): { exists: boolean; isFile: boolean; size: bigint };
  procs: ProcsHandle;
};

function words(v: { create(): VecHandle }, ...xs: string[]): VecHandle {
  const argv = v.create();
  for (const x of xs) argv.push(x);
  return argv;
}

Deno.test("a pid is never reused, so a stale pid is not another process", () => {
  const procs = mod.Procs.create();
  const first = procs.start(0, words(mod["Vec$string"], "sh"), 0n);
  assertEquals(first, 1);
  procs.exited(first, 0);
  assertEquals(procs.reap(first), 0);
  assertEquals(procs.has(first), false);
  // The reason this matters: something holding pid 1 from before must not now be talking to a
  // different process. Linux reuses pids and lives with the race; nothing here has to.
  assertEquals(procs.start(0, words(mod["Vec$string"], "wc"), 0n), 2);
});

Deno.test("a row outlives the process until somebody takes the status", () => {
  const procs = mod.Procs.create();
  const pid = procs.start(1, words(mod["Vec$string"], "false"), 0n);
  assertEquals(procs.exited(pid, 3), true);
  // Still there — this is the zombie, and it is the only reason `$?` can be asked for later.
  assertEquals(procs.has(pid), true);
  assertEquals(procs.find(pid)?.state, 1);
  assertEquals(procs.exited(pid, 9), false, "a second exit does not overwrite the first status");
  assertEquals(procs.reap(pid), 3);
  assertEquals(procs.reap(pid), -1, "and there is nothing left to take twice");
});

Deno.test("a signal to something that has exited is refused, not recorded", () => {
  const procs = mod.Procs.create();
  const pid = procs.start(1, words(mod["Vec$string"], "yes"), 0n);
  assertEquals(procs.signal(pid, 2), true);
  assertEquals(procs.takeSignal(pid), 2);
  assertEquals(procs.takeSignal(pid), 0, "collected once");
  procs.exited(pid, 0);
  // The failure this guards is a `kill` that reports success against a corpse: the caller believes it
  // stopped something, and nothing was running to stop.
  assertEquals(procs.signal(pid, 15), false);
  assertEquals(procs.signal(9999, 15), false);
});

// ── The format, against this machine's own /proc ──────────────────────────────

/** The host's answer, or null on a system without a Linux `/proc` — in which case there is no oracle. */
function host(path: string): string | null {
  try {
    return Deno.readTextFileSync(path);
  } catch {
    return null;
  }
}

function keysOf(status: string): string[] {
  return status.split("\n").filter((l) => l.length > 0).map((l) => l.slice(0, l.indexOf(":")));
}

function mounted(): FsHandle {
  const f = fs.Fs.inMemory(0n);
  // `mountSystem` would want a `randomBytes`; `/proc` alone needs none of it, and mounting it directly
  // is what keeps this test about `/proc` rather than about how a session is built.
  f.mountSynth("/proc", null);
  f.enter(words(fs["Vec$string"], "sh", "-c", "ps"));
  return f;
}

Deno.test("/proc/<pid>/cmdline is NUL-separated and NUL-terminated, as the host's is", () => {
  const theirs = host("/proc/self/cmdline");
  if (theirs === null) return;
  // The canary: if the host's file were empty, every claim below would hold vacuously.
  assertEquals(theirs.length > 0, true, "the host's own cmdline is empty — nothing is being compared");
  assertEquals(theirs.endsWith("\0"), true, "the host terminates rather than separates");

  const f = mounted();
  const ours = new TextDecoder().decode(f.readFile("/proc/1/cmdline").bytes);
  assertEquals(ours.endsWith("\0"), true);
  // Split the same way for both, and the argv comes back whole.
  assertEquals(ours.split("\0").slice(0, -1), ["sh", "-c", "ps"]);
  assertEquals(theirs.split("\0").slice(0, -1).length > 0, true);
});

Deno.test("/proc/<pid>/comm is one line with a newline, as the host's is", () => {
  const theirs = host("/proc/self/comm");
  if (theirs === null) return;
  assertEquals(theirs.endsWith("\n"), true);
  assertEquals(theirs.slice(0, -1).includes("\n"), false, "one line");

  const f = mounted();
  const ours = new TextDecoder().decode(f.readFile("/proc/1/comm").bytes);
  assertEquals(ours, "sh\n");
});

Deno.test("/proc/<pid>/status uses the host's Key:\\tvalue shape and only real keys", () => {
  const theirs = host("/proc/self/status");
  if (theirs === null) return;
  const theirKeys = keysOf(theirs);
  assertEquals(theirKeys.length > 10, true, "the host's status is unexpectedly short — bad oracle");
  // Tab-separated is the shape, taken from theirs rather than assumed.
  assertEquals(theirs.split("\n")[0].includes(":\t"), true);

  const f = mounted();
  const ours = new TextDecoder().decode(f.readFile("/proc/1/status").bytes);
  const ourKeys = keysOf(ours);
  assertEquals(ourKeys, ["Name", "State", "Pid", "PPid"]);
  // **Every key we print is a key Linux prints.** This is the assertion that would catch an invented
  // field, which is the failure mode a hand-written expectation cannot see: `Threads: 1` would look
  // perfectly reasonable in a test I wrote and be a number this system does not have.
  for (const k of ourKeys) {
    assertEquals(theirKeys.includes(k), true, `we print ${k} and Linux does not`);
  }
  for (const line of ours.split("\n").filter((l) => l.length > 0)) {
    assertEquals(line.includes(":\t"), true, line);
  }
  assertEquals(ours.includes("State:\tR (running)"), true);
  // And the host writes its state the same way: a letter, a space, a parenthesised word.
  assertEquals(/^State:\t[A-Z] \([a-z ]+\)$/.test(
    theirs.split("\n").find((l) => l.startsWith("State:")) ?? "",
  ), true);
});

Deno.test("/proc lists a pid per process and `self`, and stat gives a real size", () => {
  const f = mounted();
  const pid = f.procs.start(1, words(fs["Vec$string"], "wc", "-l"), 0n);
  assertEquals(f.readDir("/proc"), ["1", String(pid), "self"]);
  assertEquals(f.readDir("/proc/" + pid), ["cmdline", "comm", "status"]);

  // Linux reports 0 for these and this deliberately does not — a size of zero on a file `cat` then
  // reads bytes from is the sort of detail that makes a reader distrust the rest.
  const body = f.readFile("/proc/" + pid + "/cmdline").bytes;
  assertEquals(Number(f.stat("/proc/" + pid + "/cmdline").size), body.length);
  assertEquals(new TextDecoder().decode(body), "wc\0-l\0");

  // A pid that has gone is a missing file rather than an empty one.
  f.procs.exited(pid, 0);
  f.procs.reap(pid);
  assertEquals(f.readFile("/proc/" + pid + "/status").ok, false);
  assertEquals(f.stat("/proc/" + pid).exists, false);
  assertEquals(f.readDir("/proc"), ["1", "self"]);
});
