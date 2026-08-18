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
// The symptom was `packages/ssz`'s merkleization test — then a host-side one, now
// `packages/ssz/test/wac/merkle_test.wac` — failing with a bare "Uncaught error" and passing on its
// own: a worker killed for memory, reported as though the test were wrong.
//
//   deno task test                      # everything, capped
//   deno task test packages/json        # a subset, same cap
//   DENO_JOBS=5 deno task test          # override, honoured as given
//
// **The cap is 4, and it is measured.** `tools/jobsSweep.sh` on a quiet machine (load 0.6, 11.9 GB
// total, 5 cores), sampling `/sys/fs/cgroup/memory.current` and `memory.stat`'s `anon` through each
// run — re-measured 2026-08-15, after the heavy lane, issues/system 0142 and 0154:
//
//   jobs   wall      peak      rise      anon   result
//   1      689s    6795MB    3691MB    4123MB   3377 passed
//   2      379s    7569MB    4745MB         -   3377 passed
//   3      279s    7557MB    5166MB         -   3377 passed
//   4      259s    7893MB    5158MB    5905MB   3377 passed      <- the default
//   5      231s    7672MB    5359MB         -   3377 passed
//
// **Every width is 18–27% faster than before the heavy lane**, which is what that lane was for: the
// ten files it takes out of this pass are about a gigabyte resident each. 893s at one worker is now
// 689s, and 317s at four is 259s.
//
// **And five no longer dies.** It was `exit=137`, killed by the kernel after 303s with no summary,
// in the 2026-08-13 sweep; it now passes in 231s and is the fastest width measured. That is worth
// knowing and is *not* a reason to raise this cap — see below.
//
// **`anon` is the column to read for "will this fit".** `memory.current` charges the cgroup for page
// cache too, and the cache this suite reads through is 18 GB, so the peak grew between the two
// sweeps while the suite shrank. `anon` cannot be reclaimed — only swapped or OOM-killed — and it is
// what `tools/suiteGate.ts` should be compared against. At one worker the suite needs about 4.1 GB
// of it and at four about 5.9 GB, which is the spread that makes a single floor wrong at both ends.
// (The two ranges are maxima of separately-timed extrema, so at jobs=4 `anon` exceeds `rise`: the
// kernel was evicting cache while anonymous memory grew. Read them as upper bounds.)
//
// The wall-clock argument for 4 over 3 is thinner than it looks — 259s against 279s — and the memory
// argument is the interesting one: four needs about 5.9 GB of anonymous memory on a box with 11.9
// that three agents share. That is why `suiteGate.ts` asks for a floor at all.
//
// **Five has now failed twice and passed twice, and the history is why the cap does not move.** It
// first failed with `AddrInUse` — wac-mono 0069, tests binding a port, releasing it and binding
// again, which a fifth worker won often enough to redden a run. That was fixed (ports are held until
// the bind) and five passed three full suites. On 2026-08-13 it failed again at `exit=137`: the
// suite had outgrown the machine at that width. On 2026-08-15, with the heavy lane taking ten
// gigabyte-sized files out of this pass, it passes again and is the fastest width measured.
//
// So "five works" has been true, then false, then true, twice for reasons that had nothing to do
// with each other. That is the argument for leaving the default at four rather than chasing the
// fastest number: the width that fits is a property of the machine on the day, and this default is
// the one that should still be right when the suite grows again.
//
// **The cap stays at 4 anyway.** 231s against 259s is an 11% gain for a fifth of every core on a
// machine two other agents are also using, and this number should be the one that leaves room rather
// than the one that wins a benchmark. `DENO_JOBS=5` is there for anyone who disagrees on a machine
// they have to themselves.
//
// Four is also *kinder* to the other agents than one, which is the opposite of what a cap suggests:
// the run finishes in 259s instead of 689s, so the window during which this process holds five
// gigabytes is a third as long. What no per-process cap can do is bound the *machine* — three agents
// at 5 GB each is 15 GB of 11.9 — and that is 0031, which wants a token every heavy runner takes.
// `issues/system/0154` is what happens without one: the agent with the least headroom is pushed to
// the widest-and-slowest configuration it can afford and then loses every race to the push.
// `${DENO_JOBS:-2}` in the task itself would have been simpler and does not work: deno's task
// shell does not expand parameter defaults, and passes the text through literally.

import { refuseIfNested, SUITE_ENV } from "./suiteGuard.ts";
import { killedLaneNote } from "./killedLane.ts";
import { exclusiveTests, heavyTests, isWacTest, laneSplit, wacTestDirs } from "../harness/testLane.ts";
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
// `runTests.ts sweep` reclaims without running anything: the stale temp directories and the
// transpiles of sources that are gone. The suite does both on the way in, but a disk at 95% is
// exactly the moment you do not want to run a suite to clean up after one.
if (Deno.args[0] === "sweep") {
  sweepStaleTemp();
  dropUnreachableTranspiles();
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
 * One mirror directory against the sources it mirrors, recursively.
 *
 * The cache mirrors an absolute source path under `gen/file/` and appends `.js` to files, so the
 * source of `gen/file/home/x/y.ts.js` is `/home/x/y.ts`. An entry whose source is gone can never be
 * hit again by anybody, which is what makes removing it free rather than a cache eviction.
 *
 * Recursive, because the thing that grows is a *directory* of staged builds and dropping it whole is
 * the point. A directory whose source still exists is descended into instead.
 */
function dropOrphanedTranspiles(mirror: string, source: string): { gone: number; bytes: number } {
  let gone = 0;
  let bytes = 0;
  let entries: Deno.DirEntry[];
  try {
    entries = [...Deno.readDirSync(mirror)];
  } catch {
    return { gone, bytes };                     // no such mirror, which is the normal state
  }
  for (const e of entries) {
    const stem = e.name.endsWith(".js") ? e.name.slice(0, -3) : e.name;
    const path = `${mirror}/${e.name}`;
    if (existsSync(`${source}/${stem}`) || existsSync(`${source}/${e.name}`)) {
      if (e.isDirectory) {
        const r = dropOrphanedTranspiles(path, `${source}/${e.name}`);
        gone += r.gone;
        bytes += r.bytes;
      }
      continue;
    }
    try {
      bytes += sizeOf(path);
      Deno.removeSync(path, { recursive: true });
      gone++;
    } catch { /* another runner got there first */ }
  }
  return { gone, bytes };
}

/**
 * Deno's transpile cache for sources that no longer exist, which can never be hit again.
 *
 * `guardCodeCache` above bounds `v8_code_cache_v2` because it reached 28 GB (wac-mono 0068). Its
 * sibling `gen/` has no bound, and on 2026-08-12 it held **6.8 GB, of which 6.2 GB was
 * `gen/file/tmp`** — transpiled output for staged copies made by `packages/platform/build.ts` and
 * `tools/mutate.ts`, keyed on a path in a temp directory that is deleted when the run ends. So this
 * swept `gen/file/tmp`, and it worked.
 *
 * **Then the staging moved and the sweep did not.** 0068's real fix was a stable build path per
 * package — `harness/buildCache.ts` — which put the staged copies in the *repository's* `.cache`
 * instead of `/tmp`. Measured 2026-08-15: `gen/file/tmp` held **1.6 MB** and this agent's
 * `gen/file/<workspace>/.cache/stage` held **5.7 GB**, against 465 MB of `.cache` on disk — 2,615
 * mirrored staging directories for 120 that still exist. Three agents, 17 GB, on a disk at 95%.
 *
 * A mop pointed at the floor the spill used to be on is not a mop. So it walks the whole mirror from
 * its root and asks the same question of every entry, which is what `tools/prune-deno-cache.sh` has
 * done since 2026-08-05 — and whose comment describes this exact failure, in this exact cache, from
 * the other side: *"an earlier version walked two levels and so only ever saw `gen/file/tmp/*` …
 * which is the failure mode where a cleanup tool reports success and does nothing."* That script
 * also said this file already did it. It did not.
 *
 * **Including other agents' entries, deliberately**, on that script's own argument: an entry is
 * removed only when the path it was built from is gone, so a surviving entry can still be hit and a
 * removed one never could. The disk is shared, and a sweep that only tidied one third of it would
 * leave the machine full anyway.
 *
 * **This is still the mop, and 0068 still says so.** What it does not do is change the rate: every
 * build orphans another staging directory. The fix that issue asks for is reuse, not sweeping.
 */
function dropUnreachableTranspiles(): void {
  const dir = Deno.env.get("DENO_DIR") ?? `${Deno.env.get("HOME")}/.cache/deno`;
  // **The whole mirror, from the root.** `gen/file/<absolute path without its leading slash>`, so an
  // empty source root makes the first level `/home`, `/tmp` and their siblings — which is why this
  // takes one call rather than a list of places somebody has to keep current. A list is what had it
  // looking only at `/tmp`.
  const { gone, bytes } = dropOrphanedTranspiles(`${dir}/gen/file`, "");
  if (gone > 0) {
    console.log(
      `dropped ${gone} transpile(s) of sources that no longer exist, ` +
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

// Announced below the heavy-lane branch rather than here, because that branch runs at two and a run
// that says "4 workers" immediately before "the heavy lane: two workers" is a contradiction the
// reader has to resolve.
const jobsLine = override === null
  ? `${jobs} workers (measured — see issue 0075; DENO_JOBS=n overrides)`
  : `${jobs} workers (DENO_JOBS)`;

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
// **Split by runner, because the lanes are now read from both kinds of test file.** `--ignore` here
// reaches `deno test`, which is handed `.test.ts` paths; the wac files declaring the same lanes are
// excluded further down, from the command that actually runs them. Before 2026-08-18 the lane module
// could not see a wac test at all, so this filter had nothing to do and the wac declarations did
// nothing either.
const exclusive = laneSplit([], (await exclusiveTests()).map((e) => e.file)).alone
  .filter((f) => !isWacTest(f));

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
const skipHeavy = !(Deno.env.get("WAC_HEAVY") === "1" || HEAVY_ONLY || targeted);
const heavy = skipHeavy
  ? laneSplit([], declaredHeavy.map((e) => e.file).filter((f) => !isWacTest(f))).alone
  : [];
/**
 * The wac half of the same lane, for `wac test --ignore`.
 *
 * **Measured before wiring it up, because the declarations had never been honoured.** Eight wac
 * files say `// test-lane: heavy` and every one of them ran on every push — the lane module read
 * only `.test.ts`, so the list that builds the exclusion could not see them. Together they are
 * **460s of a 1451s suite**; `packages/wacc/test/wac/checked_test.wac` alone is 173s. That is about
 * a third of the push gate spent on files whose authors had already said they were too expensive
 * for one.
 */
const heavyWac = skipHeavy
  ? declaredHeavy.map((e) => e.file).filter(isWacTest)
  : [];
/**
 * When the heavy lane last passed, for the notice below.
 *
 * **Not `/tmp/wac-heavy-last`, which is what this was and which never survived.** `tools/suiteGate.ts`
 * owns `/tmp/wac-heavy-*` for its presence notes and sweeps the ones whose pid is gone; a bare
 * timestamp parses as JSON, has no pid, and was therefore deleted on every gate check. The lane then
 * reported "last run never on this machine" permanently — a wrong answer that no error accompanied,
 * which is the whole failure mode this notice exists to prevent. `tools/suiteGate.test.ts` holds the
 * case, and the sweep now only removes notes it can recognise.
 */
const HEAVY_STAMP = "/tmp/wac-lane-heavy-last";

/** The binary both wac lanes go through — declared here because the heavy branch below runs one. */
const WAC_BIN = `${Deno.cwd()}/native/v8/target/release/wac`;

// `deno task test:heavy` — the lane on its own, at two workers rather than four. These are the files
// that spawn processes and hold gigabytes; running them at the width tuned for the broad pass is how
// the machine gets killed, which is the thing the lane exists to stop.
if (HEAVY_ONLY) {
  if (declaredHeavy.length === 0) {
    console.error("no file declares `// test-lane: heavy`, so there is nothing to run");
    Deno.exit(1); // Not success: a lane that runs nothing is the failure this repo keeps finding.
  }
  console.log(`the heavy lane: ${declaredHeavy.length} file(s), two workers\n`);
  // Two rather than `jobs`: these are the files that hold about a gigabyte each, and running them at
  // the width tuned for a pass of mostly-cheap tests is how the machine gets killed.
  for (const h of declaredHeavy) console.log(`   ${h.file}  — ${h.why}`);
  // **Both runners, because the lane holds both kinds of file now.** Handing a `_test.wac` to
  // `deno test` is a target it cannot read; leaving it out of this branch while the broad pass
  // excludes it is worse still, because the file would then run nowhere and the suite would be
  // quietly smaller. Whichever way that mistake is made it looks like a faster green run.
  const heavyTs = declaredHeavy.map((h) => h.file).filter((f) => !isWacTest(f));
  const heavyWacFiles = declaredHeavy.map((h) => h.file).filter(isWacTest);
  let code = heavyTs.length > 0 ? await run(["--parallel", ...heavyTs], 2) : 0;
  if (heavyWacFiles.length > 0) {
    const r = await new Deno.Command(WAC_BIN, {
      args: [
        "test",
        "--allow-read",
        "--allow-write",
        "--allow-run",
        "--allow-env",
        "--allow-net",
        ...heavyWacFiles,
      ],
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    // 4 is "every test in that file needs a host oracle", which is not a failure — the same rule the
    // broad wac pass below follows.
    if (code === 0 && r.code !== 0 && r.code !== 4) code = r.code;
  }
  releaseSuiteSlot();
  // Stamped only on success, so "last run 20m ago" cannot mean "last *attempted*". A green lane is
  // the only thing that licenses skipping it on the next push.
  if (code === 0) {
    try {
      Deno.writeTextFileSync(HEAVY_STAMP, String(Date.now()));
    } catch (e) {
      // **Said, not swallowed.** The first version caught this silently, and when the stamp was being
      // deleted by the gate's sweep there was nothing anywhere to read — a green lane that never
      // recorded it looks exactly like a green lane. It still does not fail the run: the tests passed,
      // and that is the answer somebody asked for.
      console.log(`(the lane passed, but its stamp could not be written: ${
        e instanceof Error ? e.message : String(e)
      })`);
    }
  }
  Deno.exit(code);
}

console.log(jobsLine);

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
// **And the same wac tests again, through `wac`.**
//
// 205 files here are wac programs, run with no Deno in the path at all — which is where this
// repository is going (`issues/lang/0003`, and the goal of not needing TypeScript after
// bootstrapping).
//
// **This lane used to be a second opinion and is now the only one.** Each of these files was once a
// wac program that a `.test.ts` wrapper also registered with Deno, and running both while both
// existed was how you knew the wrappers were safe to delete. All sixteen registrars are gone
// (`issues/system/0161`), and so is every `.test.ts` for a package that has finished converting — so
// for most of what is below, a failure here is not a disagreement with the Deno passes above. It is
// the only place the test runs at all.
//
// Skipped when the binary is absent, which is the ordinary state of a fresh checkout — it is built
// by `cargo` from a seed that is gitignored. `tools/seedFresh.test.ts` is what says the seed is
// current; this only says whether the tests pass through it.

let native = 0;
if (await Deno.stat(WAC_BIN).then(() => true).catch(() => false)) {
  // **This lane was one process walking every directory in turn, and that was 266s of a suite whose
  // Deno half already runs four ways.** It is now a queue of directories at the same `jobs` workers,
  // which is 94s measured on this box — the floor is the slowest single directory (`packages/wacc`,
  // 56s), so there is a further split available inside a directory if that ever becomes the thing.
  //
  // A queue rather than four fixed shares: a share needs a cost per directory to be fair, and a table
  // of measured costs is a table that rots. Longest-first would need the same table. What a queue
  // needs is nothing, and its imbalance is bounded by one directory.
  //
  // **Each block is printed whole when its directory finishes**, rather than inherited, because four
  // workers writing to one terminal interleave `── file` headers with the failures they belong to.
  const all = await wacTestDirs("packages");
  // **A target narrows this lane too, and it did not before.** `deno task test packages/tty/` ran
  // every wac test in the repository — 266s of unrelated work behind a two-second target — because the
  // lane's path was the literal string `packages/`. A target that names no wac directory says so rather
  // than running everything or quietly running nothing.
  const named = passthrough.filter((a) => !a.startsWith("-"));
  const dirs = named.length === 0
    ? all
    : all.filter((d) => named.some((t) => d === t || d.startsWith(t.replace(/\/+$/, "") + "/") || t.startsWith(d)));
  const wacJobs = Math.max(1, Math.min(jobs, dirs.length));
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  console.log(
    `\n── the same wac tests, through \`wac test\` — ` +
      `${count(dirs.length, "directory", "directories")}, ${count(wacJobs, "worker", "workers")}`,
  );
  if (dirs.length === 0) {
    console.log(
      `   nothing here: ${named.join(", ")} names no directory holding \`*_test.wac\`, so this lane ` +
        `ran nothing. That is not the same as passing.`,
    );
  }
  // **`--allow-read`, so a test that declares a capability actually runs.** A wac test may name
  // `(Core core, Cli cli)` and read its own fixtures — `issues/system/0161` step 4 — and without a
  // grant `wac test` skips it by name. Skipped in this lane *and* ignored in Deno's, which cannot
  // supply a `Cli` at all, would mean such a test never runs anywhere while looking accounted for.
  //
  // Read, write and run — and it is not a widening of what this suite already has: the Deno pass
  // above runs with `-A`. It narrows the gap between the two lanes rather than opening anything.
  //
  // **Broader than read because a test cannot say which grant it wants.** The signature is
  // `(Core core, Cli cli)` and `wac test` grants a `Cli` if *any* grant was asked for, so a test
  // needing `--allow-write` is not skipped without it — it runs and fails at the first `mkdir`.
  // `packages/wacc/test/wac/selfhost_test.wac` is the first that needs more than reading, and it
  // found this. `issues/system/0172` is the granularity that would let a lane grant narrowly.
  //
  // **`--allow-env` was added on 2026-08-17 and the reason is worth keeping.** A differential
  // against Foundry's `cast` has to find it, and this repository keeps it in `~/tools/foundry` —
  // reachable only through `HOME`. `Deno.env.get` needed no permission, so the host-side version
  // of that test never noticed; here, a lane without this flag found nothing on `PATH`, warned
  // that the second oracle was not running, and passed. A differential comparing nothing, wearing
  // a green tick. `packages/abi/test/wac/cast_test.wac` now separates "could not look" from "is
  // not there" and fails on the first, which is what turned this from invisible into a red test.
  // **`--allow-net`, added 2026-08-18, and the reason is the same one `--allow-env` has.** Six wac
  // test files bind a socket — `freePort` in `packages/wactest/src/daemon.wac` asks the kernel for
  // a port by binding zero — and `cli.listen` needs this grant. Without it the handle comes back
  // negative and `freePort` answers -1, so the test reports **"no free port"**: a sentence about
  // port exhaustion, on a machine with twenty-eight thousand of them free. Five tests failed that
  // way on every run since they were written, and the message is convincing enough that I read it
  // as contention on a shared box, re-ran them by hand *with the flag*, saw them pass, and
  // credited the wrong variable. `deno test` runs with `-A`, so this narrows the gap between the
  // lanes rather than opening anything. `issues/system/0173` is the granularity that would let a
  // test say it needs this rather than a lane granting it to everyone.
  // 4 is "every test in that file needs a host oracle", which is most of `tor` and `tls` and is
  // not a failure. `wac test` folds those into its own summary and exits 0; anything else here is
  // a real disagreement with the Deno path and should stop the suite.
  const flags = [
    "test",
    "--allow-read",
    "--allow-write",
    "--allow-run",
    "--allow-env",
    "--allow-net",
    ...(heavyWac.length > 0 ? ["--ignore", heavyWac.join(",")] : []),
  ];
  let next = 0;
  const codes: number[] = [];
  const blocks: string[] = [];
  const worker = async () => {
    while (next < dirs.length) {
      const dir = dirs[next++];
      const r = await new Deno.Command(WAC_BIN, {
        args: [...flags, dir],
        stdout: "piped",
        stderr: "piped",
      }).output();
      const text = new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr);
      blocks.push(text);
      codes.push(r.code);
      console.log(text.trimEnd());
    }
  };
  await Promise.all(Array.from({ length: wacJobs }, () => worker()));
  // **The lane's own count, because a summary per directory is not a summary.** Thirty-nine blocks
  // each saying "6 files: 6 ok" is how a lane that stopped running half its directories would read as
  // fine. If the arithmetic does not add up, that is said rather than papered over.
  let files = 0;
  let summaries = 0;
  for (const block of blocks) {
    // `files?`, because a walk that found one file says "1 file:" — and matching only the plural is
    // how the count below first reported itself short.
    for (const m of block.matchAll(/^(\d+) files?: /gm)) {
      files += Number(m[1]);
      summaries++;
    }
  }
  console.log(
    summaries === dirs.length
      ? `   ${count(files, "wac test file", "wac test files")} across ` +
        `${count(dirs.length, "directory", "directories")}`
      : `   ${files} wac test files, but ${summaries} of ${dirs.length} directories reported a ` +
        `summary — the count above is short by whatever the silent ones hold`,
  );
  // 4 is "every test in that file needs a host oracle", which is most of `tor` and `tls` and is not a
  // failure — `wac test` folds those into its own summary and exits 0, so it should not reach here.
  // The first non-zero is taken rather than the worst: with one directory per process there is no
  // ranking between two different failures, and the blocks above say what each was.
  native = codes.find((c) => c !== 0) ?? 0;
  // **Said here, because nothing else says it.** This lane's failures are not in either summary
  // above, so a run where it alone fails prints two `0 failed` lines and then exits non-zero — and
  // the reader goes looking in the wrong place. It cost exactly that once. `issues/system/0172`.
  if (native !== 0) {
    console.log(
      `\n== the \`wac test\` lane failed (exit ${native}) ==\n` +
        "   The Deno summaries above can both say `0 failed` and the suite still exit non-zero:\n" +
        "   this is a third pass, and its failures are the `FAIL` lines printed just above.\n",
    );
  }
} else {
  console.log("\n── `wac test` skipped: no binary at native/v8/target/release/wac");
}

// **A killed lane says so**, because nothing else does — see `killedLaneNote`.
for (const [name, code] of [["parallel", parallel], ["exclusive", lane], ["`wac test`", native]] as [string, number][]) {
  const note = killedLaneNote(name, code);
  if (note !== "") console.log(note);
}

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
Deno.exit(parallel !== 0 ? parallel : lane !== 0 ? lane : native);
