// A natively-built profile says what the Deno-built one says, for a wrapper it is allowed to take.
//
// `buildProfile` takes a pure `wacTestRun` wrapper's coverage from `wac test --coverage` instead of
// spawning `deno test` for it. That is only sound if the two paths agree — and the failure if they
// do not is silent in the worst direction: a native profile that knows *fewer* tests reach a line
// makes `selectTests` narrow to a subset, and a mutant those missing tests would have killed is
// recorded as a survivor. The score goes up.
//
// So this compares them directly, per test and per line. It became reasonable to expect exact
// agreement only after `issues/system/0163`: until then the Deno path compiled the subject with the
// reference while `wac test` used wacc, so the two were not even instrumenting the same program.
//
// **The comparison is canaried**, because "two paths agree" is also what a comparison that compared
// nothing reports. The last case points the native side at a different file and requires a
// disagreement.

import { countTestsDeclaredHere, wacTestRegistrations } from "../../harness/testRegistrars.ts";
import { denoTestName } from "../../harness/wacTestRun.ts";
import { WAC_BIN } from "./native.ts";
import { ROOT } from "../../harness/programs.ts";

/**
 * The subjects: three wac entries from three packages, cheap to run.
 *
 * **These were wrapper filenames and are entries now**, because the thing they named stopped
 * existing twice. The first three were seams and the wrapper collapse deleted them; the
 * replacements were seams too and the second batch took those. Both times this read a missing file
 * and reported a `NotFound` rather than a claim about profiles.
 *
 * An oracle-supplying wrapper is not a usable substitute, which was the next thing tried: its tests
 * are *skipped* natively — that is what "needs an oracle from the host" means — so the two profiles
 * cannot match and the comparison has nothing to say.
 *
 * So the subject is the wac entry, which is what both sides were really profiling all along. Named
 * rather than discovered, still: picking whatever entry happens to be first would make the subject
 * move under whoever reads a failure.
 */
const DRIVER = "harness/wac/hostless.test.ts";

/** Three entries from three packages, named so a subject that stops existing fails here. */
const SUBJECTS: [string, string][] = [
  // The prefix is `quic`, not `varint` — the label is not derived from the filename, and guessing
  // it produced a subject with no cases and an error that read as a broken profiler.
  ["packages/quic/test/wac/varint_test.wac", "quic"],
  ["packages/bytes/test/wac/buf_test.wac", "buf"],
  ["packages/std/test/wac/map_test.wac", "map"],
];

type Tests = Record<string, string[]>;
type Profiled = { entry: string; tests: Tests; all?: string[] };

async function profileWith(cmd: string, args: string[]): Promise<Profiled[]> {
  const dir = await Deno.makeTempDir({ prefix: "wac-share-" });
  try {
    await new Deno.Command(cmd, {
      args,
      cwd: ROOT,
      env: { WAC_PROFILE: dir },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const out: Profiled[] = [];
    for await (const e of Deno.readDir(dir)) {
      if (!e.name.endsWith(".json")) continue;
      out.push(JSON.parse(await Deno.readTextFile(`${dir}/${e.name}`)));
    }
    return out;
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

const denoArgs = (f: string) =>
  ["test", "--no-check", "--allow-all", "--unstable-net", "--quiet", f];

/**
 * The driver's Deno-side profile, taken once.
 *
 * `--filter` was tried first and does not do what it looks like it does here: `--filter varint`
 * matched one of that entry's three cases and `--filter "varint:"` matched none. Profiling the whole
 * driver once and selecting from the result is both correct and cheaper — it is one run rather than
 * three, and `all` is then unambiguously the whole module's table, which is the asymmetry this file
 * measures.
 */
let driverProfile: Profiled | undefined;
async function denoSide(): Promise<Profiled> {
  if (driverProfile === undefined) {
    driverProfile = (await profileWith(Deno.execPath(), denoArgs(DRIVER)))[0];
  }
  return driverProfile;
}

async function haveBinary(): Promise<boolean> {
  try {
    return (await Deno.stat(`${ROOT}/${WAC_BIN}`)).isFile;
  } catch {
    return false;
  }
}

/**
 * Both sides of one wac entry, native names already translated to the registered spelling.
 *
 * **The Deno side runs the driver with a filter**, because there are no single-registration seams
 * left to name — `harness/wac/hostless.test.ts` registers all of them, so profiling it unfiltered
 * would compare fifty-five entries against one. The filter narrows the *cases*; the `all` table it
 * accumulates is still the whole module's, which is the asymmetry this file exists to measure and
 * is if anything sharper for it.
 */
async function bothSides(
  entry: string,
  prefix: string,
): Promise<{ deno: Tests; native: Tests; denoAll: Set<string>; nativeAll: Set<string> }> {
  const whole = await denoSide();
  // This entry's cases out of the driver's, by the label they were registered under.
  const mine: Tests = {};
  for (const [k, v] of Object.entries(whole?.tests ?? {})) {
    if (k.startsWith(`${prefix}: `)) mine[k] = v;
  }
  const d: Profiled = { entry: DRIVER, tests: mine, all: whole?.all };
  const n = (await profileWith(`${ROOT}/${WAC_BIN}`, ["test", "--coverage", entry]))[0];
  const native: Tests = {};
  for (const [k, v] of Object.entries(n?.tests ?? {})) native[denoTestName(entry, prefix, k)] = v;
  return {
    deno: d?.tests ?? {},
    native,
    denoAll: new Set(d?.all ?? []),
    nativeAll: new Set(n?.all ?? []),
  };
}

Deno.test("the two profile paths name the same tests and reach the same lines", async () => {
  if (!await haveBinary()) return;
  for (const [entry, prefix] of SUBJECTS) {
    const { deno, native } = await bothSides(entry, prefix);

    // Compared nothing is not agreement. A wrapper whose Deno run produced no tests would otherwise
    // pass every assertion below.
    const refs = Object.values(deno).reduce((n, v) => n + v.length, 0);
    if (Object.keys(deno).length === 0 || refs === 0) {
      throw new Error(`${entry}: the Deno path produced ${Object.keys(deno).length} tests and ` +
        `${refs} line references — there is nothing here to compare`);
    }

    const dk = Object.keys(deno).sort(), nk = Object.keys(native).sort();
    if (dk.join("|") !== nk.join("|")) {
      const missing = dk.filter((k) => !nk.includes(k));
      throw new Error(
        `${entry}: the native profile names ${nk.length} test(s), the Deno one ${dk.length}. ` +
          `Missing natively: ${missing.slice(0, 3).join(", ")}. Every line reached only by those ` +
          `would read as unreached, and a mutant on it would be narrowed to tests that cannot ` +
          `notice it.`,
      );
    }
    for (const k of dk) {
      const a = [...new Set(deno[k])].sort().join(",");
      const b = [...new Set(native[k] ?? [])].sort().join(",");
      if (a !== b) {
        throw new Error(
          `${entry}: "${k}" reaches ${deno[k].length} line(s) through Deno and ` +
            `${(native[k] ?? []).length} natively. The two builds are not instrumenting the same ` +
            `program.`,
        );
      }
    }
  }
});

Deno.test("the native `all` table is a subset of Deno's, never wider", async () => {
  if (!await haveBinary()) return;
  // **Not equality, and the difference is understood.** A wrapper's Deno-side profile accumulates
  // `all` from every module instrumented in that process; the native run knows only the entry's own
  // import closure, so the native table is smaller and never wider.
  //
  // packages/tls/test/fuzz_wac.test.ts was the fourth subject here and was the sharpest case —
  // unbackticked because it no longer exists, and `tools/wac/links_test.wac` checks that every backticked
  // repository path names a file that does; it cannot tell a citation from one being disavowed —
  // 8151 points through Deno against 1077 natively, with zero points the Deno side lacked. It is
  // gone: its wac test reads its own certificates with `pemBundle` and takes its entropy from
  // `Core.randomBytes`, so it needs no wrapper (`issues/system/0161`). `record_wac` stands in, from
  // the same package and the same shape of import closure.
  //
  // Subset is the direction that is safe. `known` is what separates "the profile knows this line and
  // nothing reaches it" from "the profile has never heard of this line": the first narrows, the
  // second **widens** and runs the whole scope. So a smaller `known` costs time. A *wider* one would
  // let a line be narrowed on evidence the Deno path never had, which is the failure worth a test.
  //
  // Measured over a whole scope the difference nearly vanishes — 23,749 covered lines against
  // 23,710 — because other wrappers contribute the same lines to the union.
  for (const [entry, prefix] of SUBJECTS) {
    const { denoAll, nativeAll } = await bothSides(entry, prefix);
    if (denoAll.size === 0) throw new Error(`${entry}: the Deno path knew no points at all`);
    const onlyNative = [...nativeAll].filter((p) => !denoAll.has(p));
    if (onlyNative.length > 0) {
      throw new Error(
        `${entry}: the native profile knows ${onlyNative.length} point(s) the Deno one does not, ` +
          `e.g. ${onlyNative[0]}. A line only the native side knows can be *narrowed* on evidence ` +
          `the other path never had, instead of widening to the whole scope.`,
      );
    }
  }
});

Deno.test("and the comparison can disagree, which is what makes the one above mean something", async () => {
  if (!await haveBinary()) return;
  const wrapper = "packages/std/test/map.test.ts";
  const deno = (await profileWith(Deno.execPath(), denoArgs(wrapper)))[0]?.tests ?? {};
  // Deliberately the wrong subject on the native side.
  const other = (await profileWith(`${ROOT}/${WAC_BIN}`, [
    "test",
    "--coverage",
    "packages/quic/test/wac/varint_test.wac",
  ]))[0]?.tests ?? {};
  if (Object.keys(deno).sort().join("|") === Object.keys(other).sort().join("|")) {
    throw new Error(
      "profiling two different files produced the same test names, so the comparison above is not " +
        "comparing anything",
    );
  }
});

Deno.test("a pure wrapper is actually taken natively, not silently left to Deno", async () => {
  if (!await haveBinary()) return;
  // The bug this exists for: `buildProfile` looked for the binary inside the *staged* copy, which
  // does not carry `native/v8/target/release/`. Every one of 368 files fell back to `deno test` and
  // nothing said so — a missing binary is a case this is meant to tolerate, so the silence was
  // indistinguishable from a machine that has not built one. It cost a 40-minute run to notice.
  const { nativeBinary, nativeShare } = await import("./profile.ts");
  // **Asked the way the runner asks it.** An earlier version of this test passed the binary path in
  // by hand, so it kept passing while `buildProfile` looked somewhere else entirely — the canary
  // did not fire because the test was not exercising the decision that was wrong.
  const binary = await nativeBinary();
  if (binary === null) {
    throw new Error(
      `\`nativeBinary()\` found nothing, so every file falls back to \`deno test\` silently. ` +
        `The binary is at ${ROOT}/${WAC_BIN}; the runner is looking somewhere else.`,
    );
  }

  // **The real driver still qualifies — asked statically, which is what the decision is.** This used
  // to take `nativeShare` of the driver itself, and that is a native coverage run over all fifty-six
  // of its registrations: 33s, the second-largest test in the suite, to answer a question about a
  // file's *shape*. Qualifying means every registration is readable and the file declares no host
  // tests of its own, and both are properties of the text.
  //
  // It is worth keeping in some form, because it is the one thing here that watches production: a
  // `Deno.test` added to the driver would send every profile back to the Deno path with no message,
  // and a synthetic fixture would never notice.
  const driverSource = await Deno.readTextFile(`${ROOT}/${DRIVER}`);
  const driverReg = wacTestRegistrations(driverSource);
  if (driverReg.found.length < 2 || driverReg.unresolved > 0) {
    throw new Error(
      `${DRIVER} has ${driverReg.found.length} readable registration(s) and ${driverReg.unresolved} ` +
        `it cannot read. An unreadable one is a wac test whose lines nobody profiles natively, and ` +
        `fewer than two means the loop below is not being exercised at all.`,
    );
  }
  if (countTestsDeclaredHere(driverSource) !== 0) {
    throw new Error(
      `${DRIVER} declares host-side tests now, so \`nativeShare\` refuses it and every profile goes ` +
        `back to \`deno test\` — correctly, and silently. Move them to a file of their own.`,
    );
  }

  // **And the taking itself, on two registrations rather than fifty-six.** Same fixture technique and
  // same `.cache` placement as the refusal case below, for the same reason: the entries have to
  // resolve from `ROOT` or the run fails and `nativeShare` returns null for the wrong reason.
  const FIXTURE = [
    `import { wacTestRun } from "../harness/wacTestRun.ts";`,
    `await wacTestRun("packages/quic/test/wac/varint_test.wac", "quic");`,
    `await wacTestRun("packages/std/test/wac/option_test.wac", "option");`,
    ``,
  ].join("\n");
  const reg = wacTestRegistrations(FIXTURE);
  if (reg.found.length !== 2 || reg.unresolved > 0) {
    throw new Error(
      `the fixture has ${reg.found.length} readable registration(s) and ${reg.unresolved} it cannot ` +
        `read; it must be a file that would be taken, or what follows answers a different question`,
    );
  }
  if (countTestsDeclaredHere(FIXTURE) !== 0) {
    throw new Error("the fixture declares host-side tests, which is the case the file below covers");
  }

  const rel = ".cache/nativeShare_pure_subject.test.ts";
  await Deno.mkdir(`${ROOT}/.cache`, { recursive: true });
  try {
    await Deno.writeTextFile(`${ROOT}/${rel}`, FIXTURE);
    const share = await nativeShare(ROOT, rel, binary);
    if (share === null) {
      throw new Error(
        "a pure wrapper was not taken natively. Either the binary is not where `buildProfile` looks, " +
          "or the file stopped qualifying — both leave the whole profile on the Deno path with no " +
          "message.",
      );
    }
    if (Object.keys(share.tests).length === 0) throw new Error("taken natively but with no tests");
    // Both registrations, because `nativeShare` loops and a version that took the first and stopped
    // would leave every later entry's lines unprofiled.
    const prefixes = new Set(Object.keys(share.tests).map((k) => k.slice(0, k.indexOf(": "))));
    if (!prefixes.has("quic") || !prefixes.has("option")) {
      throw new Error(
        `the native share covers ${[...prefixes].join(", ") || "nothing"}; it must cover both ` +
          `registrations, or the entries after the first go unprofiled`,
      );
    }
    // Names must already be in the spelling the wrapper registers, because execution is still Deno's.
    const first = Object.keys(share.tests)[0];
    if (first.indexOf(": ") < 0) {
      throw new Error(`native share named a test "${first}"; expected the registered spelling`);
    }
  } finally {
    await Deno.remove(`${ROOT}/${rel}`).catch(() => {});
  }
});

Deno.test("a file that also declares host tests is left to Deno", async () => {
  // The refusal half: a file that registers wac tests *and* declares its own `Deno.test`s must be
  // left to Deno, because a native profile of it would know only the wac tests and every line that
  // only the host-side ones reach would read as unreached — the under-selecting direction.
  //
  // **The subject is synthetic, and that is the point.** It was
  // packages/wactest/test/assert.test.ts until 2026-08-18, when `issues/system/0161` retired that
  // file — and no file in the tree has the shape any more, so a test that needs one would have had
  // to wait for a file to happen to grow it back. Writing the subject states the rule directly, and
  // the rule is about the two properties rather than about any file that carries them.
  //
  // **`ROOT/.cache` rather than a temp directory, and the reason is the canary.** `nativeShare`
  // reads `work/testFile`, so a temp directory would hold the fixture fine — but `work` is also the
  // cwd it runs `wac test` from, and from a temp directory the registered entry would not resolve.
  // The run would fail, `doc` would be null, and `nativeShare` would return null *anyway*: delete
  // the refusal this case is named for and it would still pass. Under `ROOT` the entry resolves, so
  // removing the refusal makes a profile come back and the case fails, which is the only version of
  // it worth having. `.cache` is in `deno.json`'s `exclude` and in `.gitignore`, so the fixture is
  // invisible to the test walk that would otherwise try to run it.
  const FIXTURE = [
    `import { wacTestRun } from "../harness/wacTestRun.ts";`,
    `await wacTestRun("packages/std/test/wac/option_test.wac", "option");`,
    `Deno.test("a host-side test declared in the same file", () => {});`,
    ``,
  ].join("\n");

  // **The controls, because `null` is also what "nothing here to take" looks like.** `nativeShare`
  // returns null for an unreadable file, for one with no registrations, and for one with a
  // registration it cannot read — so a subject failing any of those would give the right answer for
  // the wrong reason, and would keep giving it after the refusal itself was deleted.
  const reg = wacTestRegistrations(FIXTURE);
  if (reg.found.length === 0 || reg.unresolved > 0) {
    throw new Error(
      `the fixture has ${reg.found.length} readable registration(s) and ${reg.unresolved} it ` +
        `cannot read; it must be a file that would otherwise be taken, or the refusal below is ` +
        `answering a different question`,
    );
  }
  if (countTestsDeclaredHere(FIXTURE) === 0) {
    throw new Error("the fixture declares no host-side tests, which is the property under test");
  }

  const rel = ".cache/nativeShare_dual_subject.test.ts";
  await Deno.mkdir(`${ROOT}/.cache`, { recursive: true });
  try {
    await Deno.writeTextFile(`${ROOT}/${rel}`, FIXTURE);
    // The binary is never reached while the refusal stands: it is static, ahead of the first
    // `wac test` spawn. So this case runs whether or not one is built, which the version keyed to a
    // real file did not — it began `if (!await haveBinary()) return`, and on a checkout without one
    // the refusal went unasserted rather than untested-and-said-so.
    const { nativeShare } = await import("./profile.ts");
    const share = await nativeShare(ROOT, rel, WAC_BIN);
    if (share !== null) {
      throw new Error(
        "a wrapper that also declares host-side tests was taken natively; the tests it declares " +
          "here would be missing from the profile and every line only they reach would read as " +
          "unreached",
      );
    }
  } finally {
    await Deno.remove(`${ROOT}/${rel}`).catch(() => {});
  }
});
