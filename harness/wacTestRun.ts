// Run tests that are written in wac.
//
// Discovery needs nothing from the language: wacCompile returns the export names, so
// every export called `test*` returning `string` is a test. Empty return means pass;
// anything else is the failure report.
//
// Registered as regular Deno tests, one per wac test function, so wac tests and host-side
// tests appear in the same run and the same output.
//
//   await wacTestRun("packages/gzip/test/wac/huffman_test.wac");
//
// ## Tests that need something from the host
//
// A test may take parameters, and `hostArgs` supplies them. The case that matters is an
// **oracle** — an independent implementation to compare against. A differential test is
// the strongest kind this repo has, and needing one from JavaScript is the reason most
// tests here were written in TypeScript rather than in wac. wac has no import syntax and
// no mutable module-level state, so the only way in is as an argument:
//
//   export string test_sha256(fn[u8[](u8[], i32)] ref) { … }
//
//   await wacTestRun(entry, "hash", [ (bytes, bits) => nodeHash(bytes, bits) ]);
//
// Arguments are positional and every test gets the same ones, trimmed to the number it
// declares — so one file mixes oracle-taking and pure tests freely, and a pure test still
// compiles to a module with no imports at all, which is checkable on the binary.
//
// The oracle has to be **synchronous**, because a wasm call cannot await. `node:crypto`
// is synchronous where WebCrypto is not, and `Deno.Command().outputSync()` covers
// anything reachable as a subprocess; between them every oracle this repo uses is
// available. A worker plus `Atomics.wait` would make an async one look synchronous, and
// is deliberately not used: it puts something that can deadlock inside the part of the
// system whose job is to fail clearly, and the mutation runner scores a hang as a kill.

import { wacCompile } from "wac/wacCompile.ts";
import { wacBindgen } from "wac/wacBindgen.ts";
import { wacFiles } from "./wacFiles.ts";
import { profileDir, registerProfiled } from "./wacProfile.ts";

const CACHE_DIR = ".cache";
const tempName = (base: string) => `${base}.${crypto.randomUUID()}.tmp`;

/**
 * Compile a wac test file and register each `test*` export as a Deno test.
 *
 * @param entry     path to the .wac file, relative to the repo root
 * @param prefix    label prefix, defaulting to the file's stem
 * @param hostArgs  values for tests that declare parameters, passed positionally
 */
/**
 * The name a wac test is registered under, from the name it has in the wac file.
 *
 * **Exported because something else has to compute it.** `wac test` knows these tests by their
 * export names — `test_basics` — and the Deno suite knows them as `map: basics`, so anything
 * translating between the two paths has to spell this rule again. `tools/mutate.ts` selects tests
 * from a coverage profile and runs them with `deno test --filter <name>`, and a filter that matches
 * nothing exits 0 with "0 passed, 0 filtered out": the mutant is then scored as **surviving**, and
 * the mutation score goes *up* because the tests stopped running. A second copy of this rule that
 * drifted would fail exactly that way, silently. `issues/system/0161`.
 */
export function denoTestName(entry: string, prefix: string | undefined, nativeName: string): string {
  const label = prefix ?? entry.split("/").pop()!.replace(/\.wac$/, "");
  return `${label}: ${nativeName.replace(/^test_?/, "")}`;
}

export async function wacTestRun(
  entry: string,
  prefix?: string,
  hostArgs: unknown[] = [],
): Promise<void> {
  // Before the compiler is asked to do anything, so a stale checkout says so itself
  // rather than surfacing as a parse error in whichever test used a new feature. This was
  // dropped when the runner was rewritten to go through bindgen, and the gap showed
  // immediately: a pin bump left every `.test.ts` failing with a clear message and every
  // wac test passing, which is the wrong way round for a check that exists to explain.
  // Instrumented when profiling, exactly as `wacBind` does it — and it was not, which made every
  // wac-written test invisible to the mutation runner's selection. The line was *known*, because some
  // other file's instrumented build contributed it, and belonged to no test, because this path wrote no
  // profile at all: `install()` is called by `registerProfiled`, so a file that never registers never
  // wraps `Deno.test` and never writes its attribution. The runner read that as "nothing executes this"
  // and excluded the mutant from the score rather than reporting it — wac-mono 0090, where `std`'s
  // `i32Eq` was called untested by four cases that build a `Map` with it.
  // **wacc, unless `WAC_TEST_FROM=reference`.** A wac test file is a wac program, and the compiler
  // that builds every package here should build these too — otherwise the day a test uses a feature
  // only wacc has, it cannot be run at all. What made the switch safe to make rather than to hope
  // about: across all 137 wac test files in this repository the two compilers agree *exactly* on
  // which exports are tests, and neither declines any of them. `issues/lang/0105`.
  const files = await wacFiles(entry);
  const useWacc = Deno.env.get("WAC_TEST_FROM") !== "reference";

  let tests: { name: string; ret: string; params: { type: string }[] }[];
  let glue: string;
  let covPoints: { index: number; file: string; line: number; col: number; kind: string }[] = [];

  if (useWacc) {
    const { waccApi, waccArtifacts } = await import("./waccBuild.ts");
    const api = await waccApi();
    const paths = [...files.keys()];
    const sources = paths.map(p => files.get(p)!);
    const diags = api.diagnoseFiles(paths, sources, entry);
    if (diags !== "") throw new Error(`wac test file failed to compile: ${entry}\n${diags}`);
    const art = await waccArtifacts(files, entry, { coverage: profileDir !== undefined });
    glue = art.glue;
    covPoints = art.covPoints;
    // **`parseSigs`, not a `split(",")`.** A parameter's type can carry commas of its own —
    // `fn[bool(u8[],u8[])]` is one argument — and splitting naively made `test_sha256_agrees_with
    // _the_host` look as though it wanted two, so every crypto test failed asking for arguments it
    // already had. The nesting-aware split lives with the generator that needs it.
    const { parseSigs } = await import("../packages/wacc/tools/waccBindgen.ts");
    tests = parseSigs(api.exportSigsFiles(paths, sources, entry))
      .filter(sig => sig.name.startsWith("test") && sig.ret === "string")
      .map(sig => ({ name: sig.name, ret: sig.ret, params: sig.params.map(t => ({ type: t })) }));
  } else {
    const result = wacCompile(files, entry, profileDir ? { coverage: true } : {});
    if (!result.ok) {
      const lines = result.diagnostics.map(d =>
        `  ${d.file}:${d.line}:${d.col} [${d.phase}] ${d.message}`);
      throw new Error(`wac test file failed to compile: ${entry}\n${lines.join("\n")}`);
    }
    for (const d of result.diagnostics) {
      console.warn(`warning: ${d.file}:${d.line}:${d.col} ${d.message}`);
    }
    glue = wacBindgen(result.compiled);
    covPoints = result.compiled.coverage ?? [];
    tests = result.compiled.exports.filter(e => e.name.startsWith("test") && e.ret === "string");
  }

  if (tests.length === 0) {
    throw new Error(
      `${entry} exports no tests. A test is an export named test* returning string.`);
  }
  // **A test may name a capability instead of an oracle**, and this lane has none to give: a bound
  // module is plain wasm with no imports, where `wac test --allow-…` hands the real `Cli` over.
  // Those are registered *ignored* rather than skipped silently or — as they were until 2026-08-16 —
  // thrown on, which failed the whole wrapper and took every other test in the file with it. The
  // native runner names them and carries on; this is the same answer in Deno's vocabulary, so the
  // two lanes agree about which tests exist. `issues/system/0161` step 4.
  const wantsCapability = (t: { params: { type: string }[] }) =>
    t.params.some(p => p.type === "Core" || p.type === "Cli");
  const capability = tests.filter(wantsCapability);
  tests = tests.filter(t => !wantsCapability(t));

  // Named rather than counted, because "expected 1 argument" without saying which test
  // wanted it sends you reading the whole file.
  const hungry = tests.find(t => t.params.length > hostArgs.length);
  if (hungry) {
    throw new Error(
      `${entry}: ${hungry.name} takes ${hungry.params.length} argument(s) and ` +
      `${hostArgs.length} were supplied. Pass them as wacTestRun's third parameter.`);
  }
  for (const t of capability) {
    Deno.test({
      name: `${denoTestName(entry, prefix, t.name)} (wants ${
        t.params.map(p => p.type).join(", ")
      } — run it with \`wac test --allow-…\`)`,
      ignore: true,
      fn: () => {},
    });
  }

  // Through bindgen rather than a bare instantiate: that is what marshals a JS function
  // into a callback the module can hold, and what turns the returned report into a string
  // without hand-rolling the accessors.
  await Deno.mkdir(CACHE_DIR, { recursive: true });
  // A separate name under profiling, because the two builds are different binaries and a module is
  // cached by its path for the life of the process.
  const outPath = `${CACHE_DIR}/${profileDir ? "prof_" : ""}${entry.replaceAll("/", "_")}.gen.ts`;
  const tmpPath = tempName(outPath);
  await Deno.writeTextFile(tmpPath, glue);
  await Deno.rename(tmpPath, outPath);
  const mod = await import(`${Deno.cwd()}/${outPath}`) as Record<string, unknown>;

  if (profileDir) {
    // The counter array is allocated by `__cov_init`, not at instantiation; without it the first
    // instrumented branch traps on a null pointer. Registered *before* the tests are declared, so the
    // `Deno.test` wrapper is in place when they are — the whole point is per-test attribution.
    (mod.__cov_init as () => void)();
    registerProfiled({
      points: covPoints,
      counts: () => {
        const len = (mod.__cov_len as () => number)();
        const get = mod.__cov_get as (i: number) => number;
        return Array.from({ length: len }, (_, i) => get(i));
      },
    });
  }

  for (const t of tests) {
    const fn = mod[t.name] as (...a: unknown[]) => string;
    // **`test_traps_*` expects the trap**, and the rule is the export name because that is all
    // `wac test` has to go on — the two lanes have to agree about which tests these are, or a file
    // passes natively and fails here. `issues/system/0161`.
    const wantsTrap = t.name.startsWith("test_traps_") || t.name.startsWith("testTraps");
    Deno.test(denoTestName(entry, prefix, t.name), () => {
      if (wantsTrap) {
        let trapped = false;
        try {
          fn(...hostArgs.slice(0, t.params.length));
        } catch (e) {
          // Only a *trap*. A host-side `TypeError` from bad glue would otherwise read as the thing
          // the test is about, and the test would pass for a reason it never checked.
          if (!(e instanceof WebAssembly.RuntimeError)) throw e;
          trapped = true;
        }
        if (!trapped) throw new Error("returned instead of trapping");
        return;
      }
      const report = fn(...hostArgs.slice(0, t.params.length));
      if (report !== "") throw new Error(report);
    });
  }
}
