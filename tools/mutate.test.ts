// The literal operator's shape sampling, on inputs small enough to count by hand.
//
// This is worth a test rather than a measurement because the failure mode is silent and one-sided:
// if the classification is too coarse the sweep quietly stops asking real questions, and the only
// symptom is a *better* number. That is the same shape as the baseline bug the tool's own header
// warns about — a red suite scoring every mutant as killed and reporting a perfect result.
//
// The measured per-file effects are in `issues/closed/0027-…`; these are the invariants.

import { generate, type GenerateStats } from "./mutate/operators.ts";
import { testDirsFor } from "./mutate/types.ts";

const stats = (): GenerateStats => ({ literalSampled: 0, literalSkipped: 0, shapes: 0 });
const literals = (src: string, perShape?: number) => {
  const st = stats();
  const ms = generate("packages/x/src/y.wac", src, ["literal"], st, perShape);
  return { count: ms.length, names: ms.map((m) => m.name), st };
};

Deno.test("a long constant table yields three mutants, not one per entry", () => {
  const table = Array.from({ length: 200 }, (_, i) => i * 3).join(", ");
  const { count, st } = literals(`const i32[] T = i32[](${table});\n`);
  // Three for the interior class, plus the few entries near `(` and `)` whose token neighbourhood
  // genuinely differs. Far fewer than 200 is the property; the exact boundary count is not.
  if (count > 12) throw new Error(`expected a handful of mutants, got ${count}`);
  if (count < 3) throw new Error(`expected at least three mutants, got ${count}`);
  if (st.literalSkipped < 180) throw new Error(`expected most entries skipped, skipped ${st.literalSkipped}`);
});

Deno.test("the three samples are spread through the table, not the first three", () => {
  // Distinct values so a mutant name identifies which entry it came from.
  const table = Array.from({ length: 300 }, (_, i) => 1000 + i).join(", ");
  const { names } = literals(`const i32[] T = i32[](${table});\n`);
  const picked = names
    .map((n) => /\/(\d+)→/.exec(n)?.[1])
    .filter((v): v is string => v !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  if (picked.length < 3) throw new Error(`expected at least three values, got ${picked.join(",")}`);
  const span = picked[picked.length - 1] - picked[0];
  // Sampling the first three would give a span of 2. Anything near the table's full width is fine.
  if (span < 200) {
    throw new Error(
      `samples span only ${span} of a 300-entry table — they are clustered, not spread: ${picked.join(",")}`,
    );
  }
});

Deno.test("distinct statements are distinct shapes, so ordinary logic is not sampled away", () => {
  // Seven literals in seven different syntactic neighbourhoods: none is a repeat of another, so
  // every one must still be mutated. This is the half of the rule that keeps the sweep useful.
  const src = `i32 f(i32 n) {
  if (n < 7) { return 3; }
  i32 a = n * 5;
  i32 b = a >> 2;
  while (b > 11) { b = b - 4; }
  return b;
}
`;
  const { st } = literals(src);
  if (st.literalSkipped !== 0) {
    throw new Error(`sampled away ${st.literalSkipped} literal(s) from code that repeats nothing`);
  }
});

Deno.test("each function's table is its own class, so none is left untested", () => {
  // FIVE tables, deliberately more than the three samples a single class would get. Two would not
  // discriminate: with three samples spread first/middle/last across two lumped tables, both
  // happen to get one anyway, and the test passes with the scoping broken. It has to be possible
  // for a table to receive nothing before "every table receives something" means anything.
  const words = (base: number) =>
    Array.from({ length: 12 }, (_, i) => `  v[${i}] = ${base + i};`).join("\n");
  const fn = (n: number, base: number) =>
    `u32[] f${n}() {\n  u32[] v = u32[12]();\n${words(base)}\n  return v;\n}\n`;
  const bases = [1000, 2000, 3000, 4000, 5000];
  const { names } = literals(bases.map((b, i) => fn(i, b)).join("\n"));
  const values = names
    .map((n) => Number(/\/(\d+)→/.exec(n)?.[1]))
    .filter((v) => Number.isFinite(v));
  const missing = bases.filter((b) => !values.some((v) => v >= b && v < b + 12));
  if (missing.length > 0) {
    throw new Error(
      `tables at ${missing.join(", ")} got no mutant — their classes were merged with another's`,
    );
  }
});

Deno.test("each module-level const table is its own class, so none is left untested", () => {
  // The case that was wrong in the first version: everything at module level shared one scope, so
  // six separate tables in unicode/src/tables.wac became a single class of 8758 members and got
  // three samples for the lot. Five tables here for the same reason as above — with two, spread
  // sampling covers both by accident and the test cannot see the fault.
  const run = (base: number) => Array.from({ length: 60 }, (_, i) => base + i).join(", ");
  const bases = [1000, 2000, 3000, 4000, 5000];
  const src = bases.map((b, i) => `const i32[] T${i} = i32[](${run(b)});`).join("\n") + "\n";
  const { names } = literals(src);
  const values = names
    .map((n) => Number(/\/(\d+)→/.exec(n)?.[1]))
    .filter((v) => Number.isFinite(v));
  const missing = bases.filter((b) => !values.some((v) => v >= b && v < b + 60));
  if (missing.length > 0) {
    throw new Error(
      `module-level tables at ${missing.join(", ")} got no mutant — scoped by declaration, each ` +
        `should contribute its own samples`,
    );
  }
});

Deno.test("--no-sample generates one mutant per literal", () => {
  const table = Array.from({ length: 200 }, (_, i) => i * 3).join(", ");
  const src = `const i32[] T = i32[](${table});\n`;
  const all = literals(src, Number.POSITIVE_INFINITY);
  if (all.count !== 200) throw new Error(`expected 200 mutants unsampled, got ${all.count}`);
  if (all.st.literalSkipped !== 0) throw new Error(`--no-sample skipped ${all.st.literalSkipped}`);
  // And sampling must be purely subtractive: every sampled mutant is one the full run also emits.
  const sampled = new Set(literals(src).names);
  const full = new Set(all.names);
  for (const n of sampled) {
    if (!full.has(n)) throw new Error(`sampling invented a mutant the full run does not emit: ${n}`);
  }
});

// --- --sample -------------------------------------------------------------------------------

import { sampleMutants } from "./mutate/sample.ts";
import type { Mutant } from "./mutate/types.ts";

const fake = (file: string, i: number): Mutant => ({
  name: `m/${file}/${i}`,
  origin: "operator",
  edits: [{ file, start: i, end: i + 1, replacement: "1", was: "0" }],
});

// Deliberately lopsided, the shape that makes stratification matter: one file holds 96% of them.
const population = [
  ...Array.from({ length: 480 }, (_, i) => fake("packages/p/src/big.wac", i)),
  ...Array.from({ length: 10 }, (_, i) => fake("packages/p/src/small.wac", i)),
  ...Array.from({ length: 10 }, (_, i) => fake("packages/p/src/tiny.wac", i)),
];

Deno.test("a sample is the requested size and drawn from the population", () => {
  const got = sampleMutants(population, 30, 1);
  if (got.length !== 30) throw new Error(`expected 30, got ${got.length}`);
  const names = new Set(population.map((m) => m.name));
  for (const m of got) {
    if (!names.has(m.name)) throw new Error(`sample contains a mutant not in the population: ${m.name}`);
  }
  if (new Set(got.map((m) => m.name)).size !== got.length) throw new Error("sample repeats a mutant");
});

Deno.test("the same seed reproduces a draw and a different seed changes it", () => {
  const key = (ms: Mutant[]) => ms.map((m) => m.name).join("|");
  if (key(sampleMutants(population, 30, 7)) !== key(sampleMutants(population, 30, 7))) {
    throw new Error("same seed gave two different draws — --seed= cannot reproduce anything");
  }
  if (key(sampleMutants(population, 30, 7)) === key(sampleMutants(population, 30, 8))) {
    throw new Error("different seeds gave the same draw — the seed is not being used");
  }
});

Deno.test("small files are represented, which a uniform draw would not guarantee", () => {
  // A uniform draw of 9 from this population picks from small.wac with probability 10/500 per
  // mutant, so it would usually return nine from big.wac and nothing about the other two files.
  const got = sampleMutants(population, 9, 3);
  const files = new Set(got.map((m) => m.edits[0].file));
  if (files.size !== 3) {
    throw new Error(`sample of 9 spans ${files.size} file(s), not 3: ${[...files].join(", ")}`);
  }
});

Deno.test("asking for the whole population, or more, returns it unchanged", () => {
  if (sampleMutants(population, population.length, 1).length !== population.length) {
    throw new Error("sampling the full size did not return everything");
  }
  if (sampleMutants(population, 99999, 1).length !== population.length) {
    throw new Error("sampling more than the population did not return everything");
  }
  if (sampleMutants(population, 0, 1).length !== population.length) {
    throw new Error("--sample=0 should be treated as no sampling, not an empty run");
  }
});

Deno.test("a body that already is the default yields no extreme mutant", () => {
  // `packages/box/src/applets/nc.wac` has `i32 STDIN() { return 0; }`, and the `extreme` operator's
  // replacement for an `i32` is `{ return 0; }` — the same program. It was reported as a surviving
  // mutant for as long as the operator existed, because no test can tell a program from itself, and the
  // byte-comparison against a rebuilt wasm did not catch it either. Whitespace does not count: the two
  // spellings of the same body are the same body.
  const names = (src: string) =>
    generate("packages/demo/src/x.wac", src, ["extreme"], stats()).map((m) => m.name).sort();

  const spaced = names("i32 zero() { return 0; }");
  if (spaced.length !== 0) throw new Error(`\`{ return 0; }\` is the operator's own text: ${spaced}`);
  const tight = names("i32 zero() {return 0;}");
  if (tight.length !== 0) throw new Error(`the same body without spaces is the same body: ${tight}`);
  const one = names("i32 one() { return 1; }");
  if (one.join(",") !== "extreme/demo/x/one") {
    throw new Error(`a body that differs from the default is still mutated, got: ${one}`);
  }
});

Deno.test("the mutation runner runs tests with the flags the suite runs them with", async () => {
  // `tools/runTests.ts` is the suite; `tools/mutate.ts` runs the same tests under a mutated tree. A
  // flag one has and the other lacks makes scopes red at baseline, and this tool then excludes those
  // mutants as *unmeasurable* — correctly, and quietly enough that the headline still reads like a
  // score.
  //
  // That happened: `--unstable-net` arrived in the suite when the datagram capability landed and not
  // here, so `--package fmt` reported `17/17 mutants killed` with fifteen excluded, ten of them the
  // whole of `ftoa`. `issues/system/0005` had four of those written down as *surviving*.
  //
  // Compared as sets rather than by order, and only for flags the mutation runner has a reason to
  // want: permissions and unstable features. `--fail-fast` and `--quiet` are this tool's own.
  const flagsIn = (src: string) =>
    new Set((src.match(/"--(?:allow-[a-z]+|unstable-[a-z-]+)"/g) ?? []).map((s) => s.slice(1, -1)));
  const read = async (f: string) => await Deno.readTextFile(new URL(f, import.meta.url));
  const suite = flagsIn(await read("./runTests.ts"));

  // Every runner that builds its own `deno test` argument list. `mutate.ts` is the one that drifted;
  // `mutate/profile.ts` is the one where drifting costs most, since it decides which tests reach
  // which lines, so a test that fails to start contributes no coverage and the mutants in code only
  // it reaches are then run against the wrong tests. `testChanged.ts` is the edit loop, where a
  // missing flag is met as `Deno.listenDatagram is not a function` before anything else.
  for (const runner of ["./mutate.ts", "./mutate/profile.ts", "./testChanged.ts"]) {
    const has = flagsIn(await read(runner));
    const missing = [...suite].filter((f) => !has.has(f));
    if (missing.length > 0) {
      throw new Error(
        `tools/${runner.replace("./", "")} runs tests without ${missing.join(", ")}, which ` +
          `tools/runTests.ts passes. A test that cannot start is not a test that failed: it is one ` +
          `whose absence the runner reports as something else.`,
      );
    }
  }

  // **And the sweep, which is a shell script and was therefore outside this check entirely.**
  // `tools/jobsSweep.sh` runs the whole suite at each worker count to produce the table
  // `runTests.ts` chooses its default width from, and it had drifted three ways at once: no
  // `--ignore` (discovery picks up `site/tools`, which does not type-check, so it aborted in two
  // seconds), no `--unstable-net` (24 datagram failures, and it correctly refuses to time a failed
  // run), no `WAC_SCHED`. The table went stale, `runTests.ts` kept asserting "memory barely moves
  // whether one worker runs or four" — by then false, it climbs about 1.2 GB per worker — and the
  // suite gate admitted runs with less memory available than the suite needs to start.
  // `issues/system/0142`.
  //
  // Nothing failed while that was true, because an instrument nobody runs on a schedule reports
  // nothing at all. So the flags are checked here even though the sweep is not: the loop above reads
  // quoted TypeScript arguments and a bash array spells them bare, which is the only reason this
  // needed its own paragraph rather than another entry in the list.
  // **Comments stripped first, or this checks nothing.** The script explains every flag it passes in
  // the paragraph above the array, so a match over the whole file finds each one whether or not the
  // command still carries it — which is what the first version of this did, and it passed with
  // `--unstable-net` deleted from the array and left in the prose beside it. A guard that reads a
  // file's own description of itself is a guard that cannot see the file change.
  const sweep = (await read("./jobsSweep.sh"))
    .split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
  const sweepFlags = new Set(sweep.match(/--(?:allow-[a-z]+|unstable-[a-z-]+)/g) ?? []);
  const sweepMissing = [...suite].filter((f) => !sweepFlags.has(f));
  if (sweepMissing.length > 0) {
    throw new Error(
      `tools/jobsSweep.sh runs the suite without ${sweepMissing.join(", ")}, which ` +
        `tools/runTests.ts passes. The sweep's whole output is a timing table, and a run that ` +
        `fails to start produces one that is wrong rather than one that is missing.`,
    );
  }
  // `export`, not a mention: the line reads `export WAC_SCHED="${WAC_SCHED:-seed}"`, so a check for
  // the bare name passes on a script that renamed the variable it exports and left the default in
  // place. Found by canarying exactly that.
  if (!/export\s+WAC_SCHED=/.test(sweep)) {
    throw new Error(
      "tools/jobsSweep.sh does not set WAC_SCHED, so it times a differently-scheduled suite than " +
        "the one it is measuring for.",
    );
  }
  if (!/--ignore/.test(sweep)) {
    throw new Error(
      "tools/jobsSweep.sh passes no --ignore, so discovery picks up site/tools and the run aborts " +
        "before any test starts.",
    );
  }
});

Deno.test("a red baseline's reason is a failure, not a test whose name contains 'error'", async () => {
  // The heuristic that reported `a new image is an empty world, not an error ... ok` as the reason a
  // 23-package scope was red. It is a *passing* test; the word is in its name. Following it cost an
  // hour, and the actual cause was a missing flag mentioned nowhere in that line.
  const { firstFailureLine } = await import("./mutate/why.ts");

  const transcript = [
    "running 2 tests from ./packages/fs/test/image.test.ts",
    "a new image is an empty world, not an error ... ok (277ms)",
    "the datagram capability answers ... FAILED (12ms)",
    "error: Test failed",
  ].join("\n");
  const why = firstFailureLine(transcript);
  if (!why.includes("FAILED")) {
    throw new Error(`reported "${why}" rather than the line that actually failed`);
  }
  if (why.includes("not an error")) {
    throw new Error(`reported a passing test's name: "${why}"`);
  }

  // Coloured input is the only kind this ever sees.
  const coloured = "\x1b[0mthe datagram capability answers ... \x1b[31mFAILED\x1b[0m (12ms)";
  if (!firstFailureLine(coloured).includes("FAILED")) {
    throw new Error("ANSI-coloured verdicts are not recognised");
  }

  // And when nothing failed by name, Deno's own error line is the fallback rather than nothing.
  if (!firstFailureLine("error: Module not found\nsomething ... ok").startsWith("error:")) {
    throw new Error("the fallback to deno's own error line does not fire");
  }
});

Deno.test("a mutant's deadline is never shorter than its scope's own baseline", async () => {
  // `min(cap, baseline × 10)` goes below the baseline once a scope takes more than a minute, and a
  // deadline below the baseline cannot tell a hung mutant from an undetected one: an undetected
  // mutant runs to completion in about baseline time, so it would be timed out and scored as killed.
  //
  // Not hypothetical. Adding `--unstable-net` let the net tests actually run rather than fail fast,
  // the slowest scope went to 673s, and the tool printed `slowest 673.1s -> 600s`.
  const { deadlineFor } = await import("./mutate/deadline.ts");

  for (const baseline of [1_000, 30_000, 59_000, 60_001, 120_000, 673_100, 3_600_000]) {
    const d = deadlineFor(baseline);
    if (d <= baseline) {
      throw new Error(
        `a ${(baseline / 1000).toFixed(0)}s baseline gets a ${(d / 1000).toFixed(0)}s deadline — ` +
          `an undetected mutant takes about baseline time, so it would be timed out and counted killed`,
      );
    }
  }

  // The cap still binds where it can, so a hung mutant does not hold a slot for hours.
  if (deadlineFor(1_000) > 600_000) throw new Error("the cap stopped applying to short baselines");
  // And the floor still lifts a very fast scope off a hair-trigger.
  if (deadlineFor(100) < 30_000) throw new Error("the floor stopped applying");
});

Deno.test("a mutant's own package is tested first, so a kill stops at the tests that kill it", () => {
  // `issues/system/0139`: nine minutes before the first mutant runs, and each kill paying for every
  // alphabetically-earlier package first. The set is right — a mutant in `std` could be caught by
  // anything that depends on it — and the *order* is what `--fail-fast` makes expensive.
  //
  // Guarded because the fix is one `sort` away from being undone and the symptom is a slow run, not
  // a failure. It landed in `8f0f5bcd` with nothing holding it.
  const dirs = testDirsFor(["std"], ["bignum", "box", "std", "url"]);
  if (dirs[0] !== "packages/std") {
    throw new Error(`the mutant's own package is not first: ${dirs.join(", ")}`);
  }
  // The set is unchanged — narrowing it would report survivors that something does catch.
  if ([...dirs].sort().join(",") !== ["packages/bignum", "packages/box", "packages/std", "packages/url"].join(",")) {
    throw new Error(`the set changed, not just the order: ${dirs.join(", ")}`);
  }
  // Two owners both come before the rest, and each side stays deterministic.
  const two = testDirsFor(["std", "fmt"], ["bignum", "fmt", "std", "url"]);
  if (two[0] !== "packages/fmt" || two[1] !== "packages/std") {
    throw new Error(`both owners should lead, sorted: ${two.join(", ")}`);
  }
});
