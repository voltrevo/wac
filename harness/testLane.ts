// Which test files need the machine to themselves.
//
// A file declares it near the top:
//
//     // test-lane: exclusive — a real OpenSSH server per case, on a real port
//
// and both entry points — `wac task test` and `wac task test:changed` — run it in a pass of its own,
// sequentially, after the parallel one.
//
// **Why a lane rather than another workaround.** Three ssh files each start a real sshd on a real port,
// and under five parallel workers one of them resets during the handshake about once in eight suite runs
// (wac-mono 0082's seventh member). Around that we had already accumulated `harness/port.ts` holding a
// listener until the bind, `harness/reap.ts` killing sshds orphaned by a killed run, a deliberately
// unanchored pattern because sshd rewrites its argv, and a `MaxStartups` hypothesis waiting to be tried.
// Four workarounds for one decision: running tests that want exclusive resources concurrently with
// everything else. The lane removes the decision.
//
// **Declared in the file, not listed here**, for the same reason the dead-export check reads imports
// rather than a table of package names: a list is wrong the first time somebody writes a server test
// somewhere new, and wrong silently. `tools/lane.test.ts` checks that every declaration gives a reason.

/** `// test-lane: exclusive — why`, at the start of a line. */
export const LANE = /^\/\/\s*test-lane:\s*exclusive\b\s*(?:[—-]\s*)?(.*)$/m;

/**
 * `// test-lane: heavy — why`, the second lane.
 *
 * **Exclusive is about correctness; heavy is about cost.** An exclusive file wants the machine to
 * itself because sharing it makes the test *wrong*. A heavy file is perfectly correct beside
 * everything else and simply costs more than a whole-suite run should pay. So the rules differ: an
 * exclusive file still runs on every push, in a pass of its own; a heavy file does not run in the
 * whole-suite pass at all, though naming its path still runs it.
 *
 * **Heavy means resident, not slow**, and the two come apart. `issues/system/0142` measured four
 * workers peaking at 7.5 GB on a machine with 11.9 and five being killed, so memory is what bounds
 * this suite. A test that holds a worker for a minute while waiting on a network timer costs a
 * *slot*; a test holding a gigabyte of corpus costs the thing that runs out. Ranking by duration
 * proposed the DTLS server-role test, now `packages/webrtc/test/wac/dtlsserver_test.wac` — 58
 * seconds, and 370 MB at 0.04 of a core.
 * Sampling the process tree is what tells them apart, and it is worth doing before adding a file.
 *
 * **The reason must name a cost**, because "this is slow" is what every test would say if asked. A
 * number — megabytes resident, seconds, cores held — is what lets the next person judge whether it
 * is still true, and `tools/lane.test.ts` requires one.
 */
export const HEAVY = /^\/\/\s*test-lane:\s*heavy\b\s*(?:[—-]\s*)?(.*)$/m;

/**
 * Every lane there is, so that a consumer can ask for "all of them" rather than name two.
 *
 * **The second lane desynchronised an instrument within a day of existing.** `tools/jobsSweep.sh`
 * builds the suite's `--ignore` from this module precisely so it measures the suite that runs, and
 * it asked for `exclusiveTests` by name — so when `heavy` arrived it kept running ten files the
 * suite skips, and would have reported a peak somebody then set `DENO_JOBS` from. Its own comment
 * had predicted that failure for a *different* reason and still did not prevent it.
 *
 * So the list is here and a caller iterates it. Adding a third lane means adding it here, and
 * everything that asks for every declared file follows without being edited.
 */
const LANES = [LANE, HEAVY];

export type Exclusive = { file: string; why: string };

/**
 * Which runner owns a declared file — the two lanes are handed to different commands.
 *
 * **This module read `.test.ts` and nothing else until 2026-08-18**, which made every lane
 * declaration in a wac test *inert*: eight files said `// test-lane: heavy` and all eight ran on
 * every push, because the exclusion is built from this list and this list could not see them.
 * Measured before fixing it, they were **460s of a 1451s suite** — `checked_test.wac` alone 173s.
 * The declarations were not wrong and nobody had ignored them; the instrument could not read the
 * majority of its own subject, which is the same failure the note above records for `jobsSweep.sh`
 * one level along.
 */
export const isWacTest = (file: string): boolean => file.endsWith("_test.wac");

/**
 * The directories that hold wac tests, which is the unit `wac test` builds for.
 *
 * `issues/system/0192` made a directory's test files share one build — one aggregate module,
 * instantiated per file — so a directory is the smallest piece that can be handed to a worker without
 * paying for that build twice. `tools/runTests.wac` runs the lane as a queue of these.
 *
 * A directory is included when it holds a test file directly. A directory that only *contains* such
 * directories is not: handing `packages/` to one worker is what this replaced.
 */
/**
 * Every root the `wac test` lane walks.
 *
 * **One list, because two of them desynchronised the day there was a second root.** `core/` became a
 * source tree with tests in `design/lang/0009` step 3 and is deliberately not under `packages/` — it
 * ships inside the compiler. `tools/runTests.wac` was taught to walk it and `tools/lane.test.ts`, the
 * guard that checks nothing is registered outside the lane, still said `packages` — so the guard
 * failed on a file the lane *did* run. That is the same shape as this module's note about
 * `jobsSweep.sh`: a consumer that assembles the list rather than asking for it.
 */
export const LANE_ROOTS = ["packages", "core"];

/** Every directory of wac tests the lane walks, across every root. */
export async function wacLaneDirs(): Promise<string[]> {
  const out: string[] = [];
  for (const root of LANE_ROOTS) out.push(...await wacTestDirs(root));
  return out;
}

export async function wacTestDirs(root: string): Promise<string[]> {
  const dirs = new Set<string>();
  const here: string[] = [];
  for await (const e of Deno.readDir(root)) {
    if (e.isFile && isWacTest(e.name)) dirs.add(root);
    if (e.isDirectory) here.push(`${root}/${e.name}`);
  }
  for (const sub of here) {
    for (const found of await wacTestDirs(sub)) dirs.add(found);
  }
  return [...dirs].sort();
}

/**
 * The wac test files directly in one directory, sorted as the walk sorts them.
 *
 * `tools/runTests.wac` splits a large directory into chunks of files, and the chunks have to be lists the
 * runner assembled rather than a range it guessed: `wac test` sorts what it collects, so a caller that
 * wants half of a directory has to name which half.
 */
export async function wacTestFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile && isWacTest(e.name)) out.push(`${dir}/${e.name}`);
  }
  return out.sort();
}

/**
 * Every file that declares *any* lane — what the suite's parallel pass does not run by default.
 *
 * `tools/jobsSweep.sh` and anything else that has to reproduce the suite's own `--ignore` should ask
 * for this rather than assembling it, because assembling it is the thing that went wrong.
 */
export async function declaredLaneFiles(roots?: string[]): Promise<string[]> {
  const all: string[] = [];
  for (const lane of LANES) all.push(...(await declaredTests(lane, roots)).map((e) => e.file));
  return [...new Set(all)].sort();
}

/** Every test file that has declared itself exclusive, with the reason it gave. */
export const exclusiveTests = (roots?: string[]): Promise<Exclusive[]> => declaredTests(LANE, roots);

/** Every test file that has declared itself heavy, with the reason it gave. */
export const heavyTests = (roots?: string[]): Promise<Exclusive[]> => declaredTests(HEAVY, roots);

async function declaredTests(
  lane: RegExp,
  roots = ["packages", "harness", "tools"],
): Promise<Exclusive[]> {
  const out: Exclusive[] = [];
  const walk = async (dir: string): Promise<void> => {
    for await (const e of Deno.readDir(dir)) {
      const path = `${dir}/${e.name}`;
      if (e.isDirectory) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === ".cache") continue;
        await walk(path);
      } else if (e.name.endsWith(".test.ts") || e.name.endsWith("_test.wac")) {
        const m = lane.exec(await Deno.readTextFile(path));
        if (m !== null) out.push({ file: path, why: m[1].trim() });
      }
    }
  };
  for (const root of roots) await walk(root);
  out.sort((a, b) => a.file.localeCompare(b.file));
  return out;
}

/**
 * How a set of targets divides into the parallel pass and the lane.
 *
 * Pure, and separately tested, because both callers got it wrong in different ways when it was inline:
 * `tools/testChanged.ts` compared a *directory* target against a *file* path so nothing ever matched,
 * and its whole-suite mode passes no targets at all, where "no targets" means everything rather than
 * nothing. Neither mistake failed anything — the suite passed, in parallel, exactly as before, and said
 * nothing either way. That is the shape of bug this repo keeps finding, so this one is a function with
 * cases rather than four lines repeated twice.
 *
 * `targets` empty means "whatever `deno test` discovers", so every declared file is in the lane.
 */
export function laneSplit(targets: string[], declared: string[]): { alone: string[]; ignore: string[] } {
  const alone = targets.length === 0
    ? [...declared]
    : declared.filter((f) => targets.some((t) => f.startsWith(t)));
  return { alone, ignore: alone };
}
