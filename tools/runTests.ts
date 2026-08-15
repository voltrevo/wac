#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-run
// `deno task test`, with the worker count capped and Deno's code cache kept in bounds.
//
// **Not named `test.ts`, and that is load-bearing.** It was, for about an hour, and the suite ran
// itself: `deno test` collects `*_test.ts`, `*.test.ts` *and* bare `test.{ts,js,mjs,mts}`, so every
// suite run imported this file as a test module and executed its top level, which launches a suite.
// One child per generation, about 100 seconds apart, unbounded. It reached seventeen levels and load
// 122 on a five-core machine shared with two other agents, and the host had to be rebooted.
// `tools/discovery.test.ts` now fails if any file in the repo can be collected that way without
// declaring a test. wac-mono 0077.
//
// `deno test --parallel` defaults to one worker per core. That is right for a suite of pure
// computation and wrong for this one, because a test here is frequently a *process*:
// `packages/box` and `packages/sh` spawn a built wac binary per case, and each is an 85 MB Deno
// isolate. Five workers each holding one, plus the five workers themselves, is over a gigabyte of
// transient allocation — on a machine three agents share.
//
// The symptom was `packages/ssz/test/merkle_wac.test.ts` failing with a bare "Uncaught error" and
// passing on its own: a worker killed for memory, reported as though the test were wrong.
//
//   deno task test                      # everything, capped
//   deno task test packages/json        # a subset, same cap
//   DENO_JOBS=5 deno task test          # override, honoured as given
//
// **The cap is 4, and it is measured.** `tools/jobsSweep.sh` on an idle machine (load 1.7, 11.9 GB
// total, 5 cores), sampling `/sys/fs/cgroup/memory.current` through each run — re-measured
// 2026-08-13, issues/system 0142:
//
//   jobs   wall      peak      rise   result
//   1      893s    5439MB    2635MB   3230 passed
//   2      522s    6642MB    3821MB   3230 passed
//   3      347s    7302MB    5014MB   3230 passed
//   4      317s    7466MB    4883MB   3230 passed
//   5         -         -         -   FAILED exit=137, killed after 303s with no summary
//
// **Memory rises with workers**, about 1.2 GB each from one to three, and then flattens. The table
// this replaces said the opposite — *"memory barely moves; the rise is 2.5–3.3 GB whether one worker
// runs or four"* — and that was true of a suite a third this size, where a single test file's spawned
// binaries dominated the peak. It is not true now, and the sentence outlived the measurement because
// **the sweep had stopped running**: three missing flags, each of which reads as a broken tree rather
// than a broken tool. Fixed in the same commit as this table.
//
// The wall-clock argument for 4 over 3 is thin — 317s against 347s — and the memory argument is now
// the interesting one: 4 peaks at 7.5 GB on a box with 11.9. That is why `suiteGate.ts` asks for
// 5500 MB free rather than the 3000 it used to, and why five is not an option: it dies.
//
// **Five has failed twice, for two different reasons, and the second is the one that stands.** It
// first failed with `AddrInUse: Address already in use` — wac-mono 0069, tests taking a port by
// binding and releasing it and then binding again, which a fifth worker won often enough to redden a
// run. That was fixed (ports are held until the bind) and five then passed three full suites at
// 54–56s. Today it fails again, at `exit=137` after 303s with no summary: the kernel kills it. The
// port race is still fixed; the suite simply outgrew the machine at that width.
//
// Worth keeping both, because "five is fine now" was recorded from the first fix and would have been
// read as current.
//
// **The cap stays at 4 anyway.** 56s against 59s is a 5% gain for every core on a machine two other agents
// are also using, and this number should be the one that leaves room rather than the one that wins a
// benchmark. `DENO_JOBS=5` is there for anyone who disagrees on a machine they have to themselves.
//
// Four is also *kinder* to the other agents than two, which is the opposite of what a cap suggests: the
// run finishes in 59s instead of 95s, so the window during which this process holds three gigabytes is
// forty per cent shorter. What no per-process cap can do is bound the *machine* — three agents at 3 GB
// each is 9 GB of 11.9 — and that is 0031, which wants a token every heavy runner takes.
// `${DENO_JOBS:-2}` in the task itself would have been simpler and does not work: deno's task
// shell does not expand parameter defaults, and passes the text through literally.

import { refuseIfNested, SUITE_ENV } from "./suiteGuard.ts";
import { exclusiveTests, heavyTests, laneSplit } from "../harness/testLane.ts";
import { clearWarnings, warningsSoFar } from "./docCheck.ts";
import { takeSuiteSlot } from "./suiteGate.ts";

const DEFAULT_JOBS = 4;

/**
 * Deno's code cache, cleared when it is over the limit.
 *
 * Here rather than in a shell function so that there is one implementation: `tools/push.sh` calls this
 * file too. The cache keys on content and never evicts, and this repo runs a lot of unique scripts, so
 * it reached 28 GB on a 155 GB disk shared by three agents — wac-mono 0068.
 */
const CACHE_LIMIT_BYTES = 4 * 1024 * 1024 * 1024;

function guardCodeCache(): void {
  const dir = Deno.env.get("DENO_DIR") ?? `${Deno.env.get("HOME")}/.cache/deno`;
  const db = `${dir}/v8_code_cache_v2`;
  let size = 0;
  try {
    size = Deno.statSync(db).size;
  } catch {
    return; // no cache yet, nothing to bound
  }
  if (size <= CACHE_LIMIT_BYTES) return;
  console.log(
    `clearing Deno's code cache: ${Math.round(size / 1024 / 1024)} MB, over the ` +
      `${Math.round(CACHE_LIMIT_BYTES / 1024 / 1024)} MB limit`,
  );
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      Deno.removeSync(db + suffix);
    } catch {
      // Another runner cleared it first, or it was never there.
    }
  }
}

/** Everything Deno caches, for when the disk is actually full. `push.sh free` calls this. */
function freeCaches(): void {
  const dir = Deno.env.get("DENO_DIR") ?? `${Deno.env.get("HOME")}/.cache/deno`;
  for (const path of [`${dir}/v8_code_cache_v2`, `${dir}/v8_code_cache_v2-wal`,
    `${dir}/v8_code_cache_v2-shm`]) {
    try { Deno.removeSync(path); } catch { /* already gone */ }
  }
  try { Deno.removeSync(`${dir}/gen`, { recursive: true }); } catch { /* already gone */ }
}

// `runTests.ts free` is the disk-full path, called by `tools/push.sh`. It clears and returns; it does
// not run the suite.
if (Deno.args[0] === "free") {
  freeCaches();
  Deno.exit(0);
}
if (Deno.args[0] === "guard") {
  guardCodeCache();
  Deno.exit(0);
}

/**
 * Remove `/tmp/wac-*` left by runs that were **killed**, which is where the disk went.
 *
 * wac-mono 0136. 2,300 of these had accumulated by 2026-08-11 — 284 MB — and `push.sh` failed three
 * times that evening with `No space left on device: tmpdir`, which blocks every agent's push while
 * it lasts. Two prefixes were 89% of the count and leaked on *every* run; both are fixed at their
 * source, where a leak belongs.
 *
 * **The rest do not leak the way the issue said they did.** The shape almost every test file here
 * uses is a module-level temp directory and an `unload` listener, and that is measured to survive a
 * failing test: a failing `deno test` exits normally, `unload` fires, and the directory goes. What
 * it does not survive is the process being *killed* — SIGTERM and SIGKILL both leave the directory
 * behind, because no listener runs. On a machine three agents share, a stopped suite, a hung run
 * and the gate's own ceiling are ordinary events, so that is the case worth handling and it cannot
 * be handled by the test that created the directory.
 *
 * So it is swept here instead, at the start of the run that would otherwise create more. A day is
 * far longer than any suite, so nothing another agent is *using* can match: the newest thing this
 * removes is from yesterday. `/tmp/wac-doc-warnings` is a tally `docCheck.ts` keeps across a run's
 * processes and is not a directory anybody owns for a day, but it is named explicitly rather than
 * left to the age test to spare.
 */
function sweepStaleTemp(): void {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  let gone = 0;
  let bytes = 0;
  const stuck: string[] = [];
  try {
    for (const e of Deno.readDirSync("/tmp")) {
      // `wac-doc-warnings` is a tally `docCheck.ts` keeps across a run's processes, and
      // `wac-suite.lock` / `wac-suite-last-*` are `tools/suiteGate.ts`'s — the lock that stops two
      // agents running a suite at once. None is a directory somebody owns for a day, and the age
      // test would spare all three anyway; they are named because a sweep that could delete a lock
      // held by a live run is not something to leave resting on an arithmetic argument.
      if (!e.name.startsWith("wac-") || e.name === "wac-doc-warnings") continue;
      if (e.name === "wac-suite.lock" || e.name.startsWith("wac-suite-last-")) continue;
      const path = `/tmp/${e.name}`;
      try {
        const info = Deno.lstatSync(path);
        const at = info.mtime?.getTime() ?? now;
        if (now - at < DAY) continue;
        bytes += info.isFile ? info.size : 0;
        remove(path);
        gone++;
      } catch (e) {
        // **Counted and named, not swallowed.** The first version caught this and said nothing, and
        // a directory from 2026-08-05 survived every sweep for a week: `packages/box`'s `rm -rf`
        // fixture leaves `dr-x------ sub` behind, and neither `Deno.removeSync` nor `rm -rf` can
        // delete a file inside a directory it cannot write. A cleanup that fails quietly is how
        // 2,300 of these accumulated in the first place — the whole of 0136.
        stuck.push(`${path}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      }
    }
  } catch { /* no /tmp to read, which is not this tool's problem */ }
  if (gone > 0) {
    console.log(`swept ${gone} temp entr${gone === 1 ? "y" : "ies"} older than a day (0136)`);
  }
  if (stuck.length > 0) {
    console.log(
      `could not sweep ${stuck.length} (0136): ${stuck[0]}` +
        (stuck.length > 1 ? ` — and ${stuck.length - 1} more` : ""),
    );
  }
}

/**
 * Deno's transpile cache for files under `/tmp`, which can never be hit again.
 *
 * `guardCodeCache` above bounds `v8_code_cache_v2` because it reached 28 GB (wac-mono 0068). Its
 * sibling `gen/` has no bound, and on 2026-08-12 it held **6.8 GB, of which 6.2 GB was
 * `gen/file/tmp`** — transpiled output for staged copies made by `packages/platform/build.ts` and
 * `tools/mutate.ts`, keyed on a path in a temp directory that is deleted when the run ends. Counted
 * that day: 7,133 entries totalling 6.51 GB whose source no longer exists, against 40 MB that could
 * still be hit. On a disk with 13 GB free.
 *
 * So this is not a cache being evicted, it is dead weight being dropped: an entry whose source path
 * is gone cannot be a hit for anybody, and the nine live ones are left alone. That is why it needs
 * no size threshold and costs nothing — unlike clearing `gen` wholesale, which `runTests.ts free`
 * does on ENOSPC and which makes the next run re-transpile everything.
 *
 * **This is the mop, and 0068 says so.** `tools/prune-deno-cache.sh` has done the same thing since
 * that issue was written, by hand; putting it in the run is the "cheaper variant" that issue names,
 * *"keep the `/tmp` directory but call the prune at the end of `deno task test`"*. What it does not
 * do is change the rate: every build still orphans about a megabyte. The fix 0068 asks for is a
 * stable build path per package so the entries are *reused*, which is `harness/buildCache.ts` and
 * `packages/platform/build.ts` — and the reason it says "a sweep tool in `tools/` looks like a
 * solution and is a mop" is that the cache came back to 6.4 GB the same evening it was first
 * emptied. Duplicated here in TypeScript rather than shelling out to the script because this file
 * already owns the two other cleanups and a run should not depend on bash for one of three.
 */
function dropUnreachableTranspiles(): void {
  const dir = Deno.env.get("DENO_DIR") ?? `${Deno.env.get("HOME")}/.cache/deno`;
  const root = `${dir}/gen/file/tmp`;
  let gone = 0;
  let bytes = 0;
  try {
    for (const e of Deno.readDirSync(root)) {
      // The cache mirrors the source path and appends `.js`, so the source of
      // `gen/file/tmp/<name>.js` is `/tmp/<name>`. Both spellings are checked rather than assuming
      // the suffix, because a directory entry mirrors a directory and carries no suffix at all.
      const source = e.name.endsWith(".js") ? e.name.slice(0, -3) : e.name;
      if (existsSync(`/tmp/${source}`) || existsSync(`/tmp/${e.name}`)) continue;
      const path = `${root}/${e.name}`;
      try {
        bytes += sizeOf(path);
        Deno.removeSync(path, { recursive: true });
        gone++;
      } catch { /* another runner got there first */ }
    }
  } catch { /* no such cache, which is the normal state on a fresh machine */ }
  if (gone > 0) {
    console.log(
      `dropped ${gone} transpile(s) of temp files that no longer exist, ` +
        `${Math.round(bytes / 1024 / 1024)} MB (0068)`,
    );
  }
}

function existsSync(path: string): boolean {
  try {
    Deno.lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function sizeOf(path: string): number {
  const info = Deno.lstatSync(path);
  if (!info.isDirectory) return info.size;
  let total = 0;
  for (const e of Deno.readDirSync(path)) total += sizeOf(`${path}/${e.name}`);
  return total;
}

/**
 * Remove a path, making it removable first if it is not.
 *
 * A test that fixtures a permission failure leaves a directory it cannot itself delete —
 * `packages/box`'s `rm -rf` cases make `dr-x------` and `chmod 000`, which is the point of them.
 * `chmod` on the way down is what `box.test.ts` does at its own cleanup, for the same reason.
 */
function remove(path: string): void {
  try {
    Deno.removeSync(path, { recursive: true });
    return;
  } catch {
    // Fall through to the widening pass; if that fails too, the caller records it.
  }
  const widen = (p: string): void => {
    let info;
    try {
      info = Deno.lstatSync(p);
    } catch {
      return;
    }
    if (info.isSymlink) return;
    try {
      Deno.chmodSync(p, info.isDirectory ? 0o700 : 0o600);
    } catch { /* not ours to chmod: the removal below will say so */ }
    if (!info.isDirectory) return;
    try {
      for (const e of Deno.readDirSync(p)) widen(`${p}/${e.name}`);
    } catch { /* unreadable even after the chmod above */ }
  };
  widen(path);
  Deno.removeSync(path, { recursive: true });
}

// After the subcommands, which start no suite, and before anything expensive.
refuseIfNested("deno task test");

// **Before the code cache, the workers and everything else**: three agents share five cores, and the
// cheapest suite is the one that does not start. `tools/suiteGate.ts` carries the argument and the
// numbers. It refuses rather than queueing — including from `tools/push.sh`, deliberately: what to do
// when the machine is busy is the caller's decision, and a script that waits quietly for ninety
// minutes takes it away. A targeted run does not come through this file at all.
const releaseSuiteSlot = takeSuiteSlot();

guardCodeCache();
sweepStaleTemp();
dropUnreachableTranspiles();

const env = Deno.env.get("DENO_JOBS");
const override = env !== undefined && Number(env) > 0 ? Math.floor(Number(env)) : null;
const jobs = override ?? DEFAULT_JOBS;

console.log(
  override === null
    ? `${jobs} workers (measured — see issue 0075; DENO_JOBS=n overrides)`
    : `${jobs} workers (DENO_JOBS)`,
);

// `--unstable-net` is not a permission and is here anyway: `Deno.listenDatagram` does not exist
// without it, so a test of the datagram capability fails with "Deno.listenDatagram is not a
// function" rather than with anything about the code. Nothing else in the suite notices it, and a
// test that cannot run is worse than one that costs a flag. design/system 0007.
const PERMS = ["--allow-read", "--allow-write", "--allow-run", "--allow-net", "--allow-env",
  "--unstable-net"];

/**
 * `--heavy` is this file's own flag and must not reach `deno test`, which would read it as a target
 * and discover nothing — a pass over zero files, reported as success. Stripped here rather than at
 * the call site so there is one place that knows.
 */
const HEAVY_ONLY = Deno.args.includes("--heavy");
const passthrough = Deno.args.filter((a) => a !== "--heavy");

const run = async (args: string[], workers: number): Promise<number> => {
  const r = await new Deno.Command(Deno.execPath(), {
    args: ["test", ...args, ...PERMS, ...passthrough],
    env: { DENO_JOBS: String(workers), ...SUITE_ENV },
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  return r.code;
};

// No targets here: the gate runs whatever `deno test` discovers, so every declared file is in the lane.
const exclusive = laneSplit([], (await exclusiveTests()).map((e) => e.file)).alone;

// **The heavy lane, which a whole-suite run does not pay for.** Ten files hold about a gigabyte each
// at their peak, and the table above says the binding constraint is memory: four workers peak at
// 7.5 GB on a machine with 11.9, and five get killed. Running all of that to land a three-line change
// is what made pushes lose their own race, so these are excluded here and run by `deno task test:heavy`.
//
// **Measured per file, not ranked by duration**, and that changed the list. Attributing the suite
// log's durations to file headers put `packages/webrtc/test/dtlsserver.test.ts` fourth at 55s — but
// sampling its process tree gives **370 MB and 2.1 CPU-seconds across 58 seconds**, 0.04 of a core.
// It is not expensive, it is *waiting*, on DTLS retransmission timers. Excluding it would have cost a
// real handshake test on every push and saved the machine nothing. `packages/box/test/sealed.test.ts`
// went the same way at 484 MB and 0.06 cores. Both keep running. What a duration ranking measures is
// how long a worker slot is held; what kills this machine is what is resident while it holds it.
//
// **A named target still runs them.** `deno task test packages/wacc` asked for that package, so it
// gets all of it — the exclusion is for the run that discovers everything, which is the push. That
// leaves `deno task test:changed` covering a heavy file whenever the change is in its package, and
// it needs no knowledge of this lane to do it.
const declaredHeavy = await heavyTests();
const targeted = passthrough.some((a) => !a.startsWith("-"));
const heavy = Deno.env.get("WAC_HEAVY") === "1" || HEAVY_ONLY || targeted
  ? []
  : laneSplit([], declaredHeavy.map((e) => e.file)).alone;
const HEAVY_STAMP = "/tmp/wac-heavy-last";

// `deno task test:heavy` — the lane on its own, at two workers rather than four. These are the files
// that spawn processes and hold gigabytes; running them at the width tuned for the broad pass is how
// the machine gets killed, which is the thing the lane exists to stop.
if (HEAVY_ONLY) {
  if (declaredHeavy.length === 0) {
    console.error("no file declares `// test-lane: heavy`, so there is nothing to run");
    Deno.exit(1); // Not success: a lane that runs nothing is the failure this repo keeps finding.
  }
  console.log(`the heavy lane: ${declaredHeavy.length} file(s), two workers\n`);
  for (const h of declaredHeavy) console.log(`   ${h.file}  — ${h.why}`);
  // `releaseSuiteSlot` above, not a second `takeSuiteSlot()`: the slot is already held by the time
  // this runs, and taking it again is a run waiting on itself.
  const code = await run(["--parallel", ...declaredHeavy.map((h) => h.file)], 2);
  releaseSuiteSlot();
  // Stamped only on success, so "last run 20m ago" cannot mean "last *attempted*". A green lane is
  // the only thing that licenses skipping it on the next push.
  if (code === 0) {
    try {
      Deno.writeTextFileSync(HEAVY_STAMP, String(Date.now()));
    } catch { /* an unwritable stamp should not fail a green run */ }
  }
  Deno.exit(code);
}

// The parallel pass covers everything else. `--ignore` rather than an explicit file list, so a new test
// file is picked up by discovery exactly as it always was and nobody has to remember this exists.
// Before anything runs, so a previous suite's warnings are not counted as this one's.
clearWarnings();

const parallel = await run(
  // `site` is in `deno.json`'s `exclude`, but a `--ignore` on the command line *replaces* the
  // config's list rather than adding to it — so the moment this pass has an exclusive lane to
  // exclude, the website comes back into discovery and fails type-checking as vite-resolved
  // TypeScript does. It is named here as well, which is the only place both lists exist.
  ["--parallel", `--ignore=${["site", ...exclusive, ...heavy].join(",")}`],
  jobs,
);
if (heavy.length > 0) {
  let ago = "never on this machine";
  try {
    const mins = Math.round((Date.now() - Number(Deno.readTextFileSync(HEAVY_STAMP))) / 60000);
    ago = mins < 90 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
  } catch { /* no stamp: the lane has not run here */ }
  console.log(
    `\n${heavy.length} file(s) skipped as heavy — last run ${ago}. ` +
      `\`deno task test:heavy\` runs them; \`WAC_HEAVY=1 deno task test\` puts them in this pass.`,
  );
  for (const h of declaredHeavy) console.log(`   ${h.file}  — ${h.why}`);
}

// Then the ones that asked for the machine, sequentially and alone. Second rather than first because a
// failure in the broad pass is the more likely one and the more useful to see early.
let lane = 0;
if (exclusive.length > 0) {
  console.log(`\n${exclusive.length} file(s) run alone, by their own declaration (see tools/runTests.ts):`);
  for (const f of exclusive) console.log(`  ${f}`);
  lane = await run(exclusive, 1);
}

// **Doc warnings, in the footer.** A doc check prints where it runs, which on a four-to-eleven minute
// suite is eight hundred lines above where anyone is looking when it finishes. Saying how many there
// were — and how to make them fail — is what stops "warn instead of fail" becoming "nobody checks".
const warnings = warningsSoFar();
if (warnings > 0) {
  console.log(
    `\n${warnings} doc warning(s) — the suite does not fail for these. ` +
      `\`deno task docs\` runs the same checks and does.`,
  );
}

// Released before exiting rather than in a `finally`: `Deno.exit` runs no unwinding, so a lock let go
// anywhere but here would be a lock left behind on every ordinary run.
releaseSuiteSlot();

// Either failing fails the suite: a green parallel pass with a red lane is still a red suite, and
// exiting on the first code would hide whichever ran second.
Deno.exit(parallel !== 0 ? parallel : lane);
