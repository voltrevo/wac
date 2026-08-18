// Which tests to run for a given mutant, from a per-test coverage profile.
//
// A mutation on line 300 of x509.wac cannot be noticed by a test that never executes line
// 300. Running the whole package suite for every mutant spends most of a sweep proving
// that repeatedly. This builds the map once — test name to the set of source lines it
// executes — and hands the runner the handful of tests that could possibly react.
//
// The profile comes from `harness/wacProfile.ts`, which wraps `Deno.test` and diffs the
// coverage counters around each test body. Building it costs one instrumented run per
// test file, sequentially, and it is the dominant cost of a sweep: for `--package gzip`
// the scope is **380 test files and 26m45s**, before a single baseline or mutant runs
// (`issues/system/0139`, `issues/system/0161`).
//
// **So it is cached, keyed by the content of the tree it was taken from.** This comment
// claimed that cache for a long time before anything implemented it, which is the reason
// nobody could iterate on selection: seeing what a change to `selectTests` did meant
// paying the 26 minutes again. A profile is a pure function of the sources — which tests
// reach which lines — so unlike the *baseline* beside it, which is a timing measurement
// of a particular machine at a particular moment, it can be reused safely as long as the
// key is honest. The key is every byte the run could have read.
//
// ## Two rules that keep this from producing wrong answers
//
// **A line with no coverage point is never narrowed.** Not every line carries an
// instrumented point — the coverage build models branches, not statements — so "no test
// covers this line" and "this line is not a coverage point" look identical in the data
// and mean opposite things. Narrowing on the second selects nothing and scores the mutant
// as a survivor without running anything. So selection only applies when the line is
// known to the profile; otherwise the full scope runs, exactly as before.
//
// **A line covered by nothing is reported, not silently skipped.** That case is real and
// worth seeing: it separates "tests ran and noticed nothing" from "no test executes this
// line at all", which are different problems with different fixes and which today's
// single "survivor" verdict conflates.
//
// ## Tests that run the code in another process
//
// Attribution used to be blind to them, and that was not a small gap: a test which builds a binary and
// runs it as a child keeps its counters in the child, so it looked like a test that reaches nothing.
// For `packages/sh`, where every test works that way, the headline optimisation contributed exactly
// nothing — `selection: 0/117 mutant(s) ran only the tests that reach them`.
//
// A built program dumps its own counters now (`packages/platform/build.ts` instruments whenever
// `WAC_PROFILE` is set, so no test had to be edited) and `harness/wacProfile.ts` credits whatever
// appeared while a test was running to that test. So `0/117` is no longer a property of the tests, and
// a number like it in a future run means something is broken rather than something is subprocess-based.
// wac-mono 0024.

import { refuseIfNested, SUITE_ENV } from "../suiteGuard.ts";
import { contentKey } from "../../harness/buildCache.ts";
import { countTestsDeclaredHere, wacTestRegistrations } from "../../harness/testRegistrars.ts";
import { denoTestName } from "../../harness/wacTestRun.ts";
import { WAC_BIN } from "./native.ts";


export type Profile = {
  /** "file:line" to the tests that execute it. */
  lines: Map<string, string[]>;
  /** Every line the profile knows about, so an unknown line can be told from an unhit one. */
  known: Set<string>;
  /** Test name to the file that defines it, for building the run command. */
  home: Map<string, string>;
  testFiles: string[];
  /**
   * How long each test file took, in milliseconds, measured while profiling.
   *
   * Free to collect — the profile already runs every file once, on its own — and it is what
   * lets the runner put the cheap files first. With `--fail-fast`, the order decides how much
   * of a scope a killed mutant actually pays for, and Deno's own discovery order is
   * alphabetical, which in `packages/ssh` puts the one in-process suite behind two that each
   * spawn a real OpenSSH client.
   */
  cost: Map<string, number>;
};

type Raw = { entry: string; all: string[]; tests: Record<string, string[]> };

/**
 * Test files cheapest first, so `--fail-fast` stops early as often as possible.
 *
 * Ordering only ever changes *when* a verdict is reached, never what it is: a killed mutant is
 * killed by whichever test notices, and every file still runs when nothing does. That is what
 * makes this safe where narrowing is not — under-selection is a wrong answer, a bad order is
 * only a slow one.
 *
 * An unmeasured file sorts last rather than first. If the profile never ran it, the honest
 * assumption is that it is the expensive or awkward one.
 */
export function byCost(files: string[], profile: Profile | undefined): string[] {
  const sorted = [...files].sort();
  if (profile === undefined) return sorted;
  return sorted.sort((a, b) => {
    const ca = profile.cost.get(a) ?? Number.POSITIVE_INFINITY;
    const cb = profile.cost.get(b) ?? Number.POSITIVE_INFINITY;
    return ca === cb ? a.localeCompare(b) : ca - cb;
  });
}

/** Every test file under the given package directories. */
/** Every `*_test.wac` under these directories — the entries `wac test` runs. */
export async function wacEntriesIn(dirs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const d of dirs) {
    const walk = async (p: string) => {
      try {
        for await (const e of Deno.readDir(p)) {
          const q = `${p}/${e.name}`;
          if (e.isDirectory) await walk(q);
          else if (e.name.endsWith("_test.wac")) out.push(q);
        }
      } catch { /* a directory that does not exist contributes nothing */ }
    };
    await walk(d);
  }
  return out.sort();
}

export async function testFilesIn(dirs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const d of dirs) {
    const walk = async (p: string) => {
      try {
        for await (const e of Deno.readDir(p)) {
          const q = `${p}/${e.name}`;
          if (e.isDirectory) await walk(q);
          else if (e.name.endsWith(".test.ts")) out.push(q);
        }
      } catch { /* a directory that does not exist contributes nothing */ }
    };
    await walk(d);
  }
  return out.sort();
}

/**
 * Run each test file once with the profiler attached and read back what it covered.
 *
 * Sequentially and without `--parallel`: the profiler diffs one global counter array
 * around each test body, so two tests running at once would each be credited with the
 * other's lines. Files are independent processes, so this is about tests within a file.
 */
/**
 * Everything under `work` that could change what a test reaches, as key material.
 *
 * **Content, not mtimes.** The staged directory is a fresh `cp -r` every run, so every mtime is
 * new and a stamp-based key would miss every time — and a key that never hits is indistinguishable
 * from having no cache, which is the state this replaces.
 *
 * Deliberately everything rather than a curated list: a profile says which tests reach which lines,
 * and *any* source or test the run imports can change that. A list of directories somebody has to
 * keep in step is how a stale profile gets served, and a stale profile under-selects — the failure
 * that reports as a better score.
 */
export async function treeKey(work: string, testFiles: string[]): Promise<string> {
  const parts: string[] = ["profile-v2", ...testFiles];
  const skip = new Set([".git", "node_modules", ".cache", "target"]);
  const walk = async (dir: string): Promise<void> => {
    const names: Deno.DirEntry[] = [];
    for await (const e of Deno.readDir(dir)) names.push(e);
    names.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const e of names) {
      if (skip.has(e.name)) continue;
      const p = `${dir}/${e.name}`;
      if (e.isDirectory) {
        await walk(p);
      } else if (e.name.endsWith(".wac") || e.name.endsWith(".ts") || e.name.endsWith(".json")) {
        parts.push(p.slice(work.length), await Deno.readTextFile(p).catch(() => ""));
      }
    }
  };
  await walk(work);
  return await contentKey(parts);
}

/**
 * `Map`s and a `Set` do not survive `JSON.stringify`, so the stored shape is explicit — and the test
 * names are **interned**, which is not premature.
 *
 * `lines` maps every covered `file:line` to the tests that reach it, and a test reaches thousands of
 * lines. One real profile holds 2,276,536 name references drawn from 1,643 distinct names averaging
 * 51 characters: written out longhand that is **133 MB for one profile**, and there is one per state
 * of the tree, so a day of editing fills a disk. Indices into a name table make the same profile
 * about a tenth of that.
 */
export type StoredProfile = {
  /** Every test name once; `lines` and `home` hold indices into this. */
  names: string[];
  lines: [string, number[]][];
  known: string[];
  home: [number, string][];
  testFiles: string[];
  cost: [string, number][];
};

/** How many profiles to keep. Each is tens of megabytes and only the current tree's can hit. */
const KEEP = 3;

const CACHE_DIR = ".cache/mutate-profile";

export async function readCached(key: string): Promise<Profile | null> {
  try {
    const raw = JSON.parse(await Deno.readTextFile(`${CACHE_DIR}/${key}.json`)) as StoredProfile;
    const n = raw.names;
    return {
      lines: new Map(raw.lines.map(([l, ids]) => [l, ids.map((i) => n[i])])),
      known: new Set(raw.known),
      home: new Map(raw.home.map(([i, f]) => [n[i], f])),
      testFiles: raw.testFiles,
      cost: new Map(raw.cost),
    };
  } catch {
    return null;
  }
}

/**
 * Keep the newest `KEEP` profiles and remove the rest.
 *
 * **Only the current tree's key can ever hit**, so every older file is dead the moment a byte
 * changes. Keeping a few rather than one costs disk and buys the case that actually happens while
 * working: edit, look, undo, look again.
 */
async function evict(): Promise<void> {
  try {
    const files: { path: string; at: number }[] = [];
    for await (const e of Deno.readDir(CACHE_DIR)) {
      if (!e.isFile || !e.name.endsWith(".json")) continue;
      const path = `${CACHE_DIR}/${e.name}`;
      files.push({ path, at: (await Deno.stat(path)).mtime?.getTime() ?? 0 });
    }
    files.sort((a, b) => b.at - a.at);
    for (const f of files.slice(KEEP)) await Deno.remove(f.path).catch(() => {});
  } catch { /* nothing to evict */ }
}

export async function writeCached(key: string, p: Profile): Promise<void> {
  const index = new Map<string, number>();
  const names: string[] = [];
  const id = (name: string): number => {
    let i = index.get(name);
    if (i === undefined) {
      i = names.length;
      names.push(name);
      index.set(name, i);
    }
    return i;
  };
  const stored: StoredProfile = {
    // `home` first, so every test the profile knows about has an index even if it reaches no line.
    home: [...p.home].map(([name, file]) => [id(name), file]),
    lines: [...p.lines].map(([line, tests]) => [line, tests.map(id)]),
    names,
    known: [...p.known],
    testFiles: p.testFiles,
    cost: [...p.cost],
  };
  try {
    await Deno.mkdir(CACHE_DIR, { recursive: true });
    // Written to a temp name and renamed, so a reader never sees half a profile: two sweeps can run
    // at once here, and a truncated JSON parses as a *miss*, which is survivable, or as a shorter
    // profile, which is not.
    const tmp = `${CACHE_DIR}/${key}.${crypto.randomUUID()}.tmp`;
    await Deno.writeTextFile(tmp, JSON.stringify(stored));
    await Deno.rename(tmp, `${CACHE_DIR}/${key}.json`);
    await evict();
  } catch { /* a cache that cannot be written is not a reason to fail the run */ }
}

/**
 * The `wac` binary this runner will use, or null when there is none built.
 *
 * **From the repo, not from the staged copy** — and this is a function rather than a string so that
 * a test can ask the same question the runner asks. `wac` is a *tool* here, like `deno` itself; the
 * stage holds the *subject*, and `native/v8/target/release/` is a build artefact staging does not
 * carry. Built as `${work}/${WAC_BIN}` it found nothing, every one of 368 files quietly fell back to
 * `deno test`, and nothing said so: a missing binary is a case this is meant to tolerate, so the
 * silence was indistinguishable from a machine that has not built one. It cost a 40-minute run to
 * notice, and a test that passed the path in by hand could not have caught it.
 *
 * The subject still comes from the stage: the command runs with `cwd: work` and a relative entry.
 */
export async function nativeBinary(): Promise<string | null> {
  const path = `${Deno.cwd()}/${WAC_BIN}`;
  return await Deno.stat(path).then((s) => s.isFile ? path : null).catch(() => null);
}

/** What a native pass contributed for one wrapper, already in the Deno spelling. */
type NativeShare = { all: string[]; tests: Record<string, string[]>; ms: number };

/**
 * Profile a wrapper's wac tests with `wac test --coverage` instead of a `deno test` subprocess.
 *
 * Returns null whenever the answer would be *narrower* than the Deno path's, because a narrower
 * profile is the under-selecting one: a line that looks unreached is a mutant scored against tests
 * that were never run. Three ways that happens, and each is a `null` here rather than a partial
 * merge —
 *
 *  - the file declares host-side tests too (`countTestsDeclaredHere`), so the native run cannot see
 *    all of it;
 *  - a `wacTestRun` call whose arguments are computed, so this cannot tell what it registers;
 *  - the native run **skipped** a test for want of a host oracle. 17 of this repository's files are
 *    mixed that way — `rsa_test.wac` runs 3 of its 12 here — and a profile of the 3 reads exactly
 *    like a complete one. That is why `wac test` records `skipped` at all (`issues/system/0161`).
 *
 * The names are translated to the spelling the *wrapper* registers, because execution still goes
 * through `deno test --filter`. A native profile holding `test_basics` against a suite that calls it
 * `map: basics` filters to nothing, exits 0, and scores the mutant as survived.
 */
/**
 * A profile for one `*_test.wac` entry, run directly by the binary.
 *
 * **`nativeShare` without the wrapper.** That one exists because a `.test.ts` *registers* wac tests and
 * execution went back through `deno test --filter`, so its names had to be translated into the wrapper's
 * spelling. A package whose tests are wac files has no wrapper and is run by `wac test`, so the names are
 * the exports' own and no translation is wanted — translating them is how a filter comes to match
 * nothing and a mutant is scored against a run of zero tests. `issues/system/0183`.
 *
 * Declines the same way it does: a profile listing anything in `skipped` is partial, and a partial
 * profile scores a mutant against tests that never ran.
 */
export async function wacShare(
  work: string,
  entry: string,
  binary: string,
): Promise<NativeShare | null> {
  const dir = await Deno.makeTempDir({ prefix: "wac-wacprof-" });
  try {
    const began = performance.now();
    await new Deno.Command(binary, {
      // The grants the suite's own wac lane passes: a test skipped for want of one contributes no
      // coverage, and code only that test reaches then looks unreached.
      args: ["test", "--coverage", "--allow-read", "--allow-write", "--allow-run", "--allow-env", entry],
      cwd: work,
      env: { WAC_PROFILE: dir },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const ms = performance.now() - began;
    let doc: { all?: string[]; tests?: Record<string, string[]>; skipped?: string[] } | null = null;
    for await (const e of Deno.readDir(dir)) {
      if (!e.name.endsWith(".json")) continue;
      const d = JSON.parse(await Deno.readTextFile(`${dir}/${e.name}`));
      if (d.entry === entry || d.entry.endsWith(`/${entry}`)) doc = d;
    }
    if (doc === null || !Array.isArray(doc.skipped) || doc.skipped.length > 0) return null;
    const tests: Record<string, string[]> = {};
    for (const [name, pts] of Object.entries(doc.tests ?? {})) tests[name] = pts;
    return Object.keys(tests).length === 0 ? null : { all: doc.all ?? [], tests, ms };
  } catch {
    return null;
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

export async function nativeShare(
  work: string,
  testFile: string,
  binary: string,
): Promise<NativeShare | null> {
  let src: string;
  try {
    src = await Deno.readTextFile(`${work}/${testFile}`);
  } catch {
    return null;
  }
  if (countTestsDeclaredHere(src) > 0) return null;
  const reg = wacTestRegistrations(src);
  if (reg.found.length === 0 || reg.unresolved > 0) return null;

  const dir = await Deno.makeTempDir({ prefix: "wac-native-prof-" });
  try {
    const all: string[] = [];
    const tests: Record<string, string[]> = {};
    let ms = 0;
    for (const { entry, prefix } of reg.found) {
      const began = performance.now();
      await new Deno.Command(binary, {
        args: ["test", "--coverage", entry],
        cwd: work,
        env: { WAC_PROFILE: dir },
        stdout: "piped",
        stderr: "piped",
      }).output();
      ms += performance.now() - began;

      let doc: { all?: string[]; tests?: Record<string, string[]>; skipped?: string[] } | null = null;
      for await (const e of Deno.readDir(dir)) {
        if (!e.name.endsWith(".json")) continue;
        const d = JSON.parse(await Deno.readTextFile(`${dir}/${e.name}`));
        if (d.entry === entry || d.entry.endsWith(`/${entry}`)) doc = d;
      }
      // No profile, or one the host had to leave incomplete: take the Deno path for the whole file.
      if (doc === null || !Array.isArray(doc.skipped) || doc.skipped.length > 0) return null;
      for (const p of doc.all ?? []) all.push(p);
      for (const [name, pts] of Object.entries(doc.tests ?? {})) {
        tests[denoTestName(entry, prefix, name)] = pts;
      }
    }
    return Object.keys(tests).length === 0 ? null : { all, tests, ms };
  } catch {
    return null;
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

export async function buildProfile(
  work: string,
  testFiles: string[],
  log: (s: string) => void,
  opts: { noCache?: boolean; noNative?: boolean } = {},
): Promise<Profile> {
  // **Here, not at import.** This module also exports the pure part — `selectTests`, `planFor`,
  // `filterFor` — and a guard at module scope means a *test* of those cannot import the file: it called
  // `Deno.exit(2)` from outside any test and took the isolate with it. The guard belongs where the suite
  // is actually spawned, which is this function. `mutate.ts` guards its own entry as well, so the sweep
  // path is covered twice and the library path not at all, which is the right way round. wac-mono 0077.
  refuseIfNested("the mutation profiler");
  const key = opts.noCache ? null : await treeKey(work, testFiles).catch(() => null);
  if (key !== null) {
    const hit = await readCached(key);
    if (hit !== null) {
      log(`  profile: reused ${key.slice(0, 12)} — ${hit.home.size} test(s), no run needed`);
      return hit;
    }
  }
  const dir = await Deno.makeTempDir({ prefix: "wac-profile-" });
  const cost = new Map<string, number>();
  // Taken natively where that is provably not narrower; everything else still goes through Deno.
  const native = new Map<string, NativeShare>();
  const binary = await nativeBinary();
  if (binary !== null && !opts.noNative) {
    for (const f of testFiles) {
      // A wac entry is profiled directly; a `.test.ts` is asked whether it is a pure wrapper first.
      const share = f.endsWith("_test.wac")
        ? await wacShare(work, f, binary)
        : await nativeShare(work, f, binary);
      if (share !== null) {
        native.set(f, share);
        cost.set(f, share.ms);
      }
    }
    if (native.size > 0) log(`  profile: ${native.size} file(s) taken from \`wac test --coverage\``);
  }
  try {
    for (const f of testFiles) {
      if (native.has(f)) continue;
      const began = performance.now();
      const cmd = new Deno.Command("deno", {
        // `--unstable-net` for the reason `tools/runTests.ts` gives beside its own copy. It matters
        // more here than anywhere: this run is what decides **which tests reach which lines**, so a
        // net test that fails to start contributes no coverage, and every mutant in code only those
        // tests reach is then run against the wrong tests or thought unreachable.
        args: ["test", "--no-check", "--allow-read", "--allow-write", "--allow-run",
               "--allow-net", "--allow-env", "--unstable-net", "--quiet", f],
        cwd: work,
        env: { WAC_PROFILE: dir, ...SUITE_ENV },
        stdout: "piped",
        stderr: "piped",
      });
      const { code } = await cmd.output();
      // Timed even when it fails: a file that dies early is cheap, and ordering it first costs
      // nothing. The number is only ever used to sort.
      cost.set(f, performance.now() - began);
      // A file that fails while profiling still contributes whatever it covered before
      // it failed. The baseline check is what decides whether a red suite is usable; this
      // is only attribution.
      if (code !== 0) log(`  profile: ${f} exited ${code}; using partial coverage`);
    }

    const lines = new Map<string, string[]>();
    const home = new Map<string, string>();
    const known = new Set<string>();
    for (const [file, share] of native) {
      for (const p of share.all) known.add(p);
      for (const [test, pts] of Object.entries(share.tests)) {
        // `home` is the *wrapper*, not the `.wac`: it is what the runner hands `deno test`.
        home.set(test, file);
        for (const p of pts) {
          if (!lines.has(p)) lines.set(p, []);
          lines.get(p)!.push(test);
        }
      }
    }
    for await (const e of Deno.readDir(dir)) {
      if (!e.name.endsWith(".json")) continue;
      const raw = JSON.parse(await Deno.readTextFile(`${dir}/${e.name}`)) as Raw;
      const file = raw.entry.replace(/^.*\/wac-mono\//, "");
      // `known` is every instrumented line, so a line that is in it with no tests means
      // "nothing executes this" rather than "the instrumentation does not model this".
      for (const p of raw.all ?? []) known.add(p);
      for (const [test, pts] of Object.entries(raw.tests)) {
        home.set(test, file);
        for (const p of pts) {
          if (!lines.has(p)) lines.set(p, []);
          lines.get(p)!.push(test);
        }
      }
    }
    const built = { lines, known, home, testFiles, cost };
    if (key !== null) await writeCached(key, built);
    return built;
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

/**
 * The tests that could react to a mutation at these lines.
 *
 * `null` means "cannot narrow, run everything in scope" — either the profile does not
 * know the line, or a name cannot be expressed as a filter. An empty array means the
 * profile knows the line and no test reaches it.
 */
export function selectTests(p: Profile, locations: string[]): string[] | null {
  const picked = new Set<string>();
  let anyKnown = false;
  for (const loc of locations) {
    if (!p.known.has(loc)) continue;
    anyKnown = true;
    for (const t of p.lines.get(loc) ?? []) picked.add(t);
  }
  // *Any* known line, not every one. A mutation spans a whole syntactic construct — an
  // `extreme` mutant replaces an entire function body — and most interior lines are plain
  // statements the coverage build does not model, since it instruments branches. Requiring
  // every line to be known meant one unmodelled statement discarded the whole selection,
  // which is how 83 of 235 mutants ended up running the full scope for no reason.
  //
  // Sound because control enters a construct through its entry: a test that executes an
  // interior line must have reached the line that dominates it, and that is the line
  // carrying the point. Verified the only way that counts — the verdicts are unchanged.
  if (!anyKnown) return null;
  // Selecting on *any* known line is fine; concluding "nothing executes this" from it is
  // not. An edit span need not contain the line its coverage point sits on — a function
  // whose signature wraps has its entry point above where the span begins — so a span can
  // hold known-but-uncovered interior lines while the covered entry is outside it. Read
  // literally that says no test reaches the function, and `extreme/tls/client/
  // tlsClientInit` was reported exactly that way for a function every client test calls.
  //
  // So the empty answer is only trusted when every line of the span is accounted for.
  // Otherwise fall back, which costs time and cannot be wrong.
  if (picked.size === 0 && !locations.every((l) => p.known.has(l))) return null;
  return [...picked].sort();
}

/**
 * What to run for a mutant at these lines, as one decision rather than three flags.
 *
 *   - `narrow` — the profile names the tests that reach it. Run those.
 *   - `widen`  — the profile cannot say. Run the whole scope; slow, never wrong.
 *   - `unhit`  — the profile accounts for every line of the span and no test hits any of them.
 *
 * **`unhit` is not "skip".** It used to be: the runner recorded such a mutant as unmeasurable and left it
 * out of the score. That is wrong for anything the compiler can fold — `perrCtorBrace() { return 27; }` is
 * inlined into its call sites, so its own line's counter stays at zero while the constant it returns
 * reaches every caller, and gutting it fails two tests. So `unhit` means "run everything, and if it
 * survives, say that nothing executes the line" — the useful half of the old message, without the verdict
 * the counter cannot support. This is the shape the whole file argues for: under-selection is a wrong
 * answer, over-selection is only slow. wac-mono 0005.
 */
export type Plan =
  | { readonly kind: "narrow"; readonly tests: string[] }
  | { readonly kind: "widen" }
  | { readonly kind: "unhit" };

export function planFor(p: Profile, locations: string[]): Plan {
  const picked = selectTests(p, locations);
  if (picked === null) return { kind: "widen" };
  if (picked.length === 0) return { kind: "unhit" };
  return { kind: "narrow", tests: picked };
}

/** A `--filter` that matches exactly these test names and nothing else. */
export function filterFor(names: string[]): string | null {
  if (names.length === 0) return null;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Deno treats a value wrapped in slashes as a regex; anchoring makes it exact, so a
  // name that is a prefix of another cannot drag it in.
  return `/^(?:${escaped.join("|")})$/`;
}
