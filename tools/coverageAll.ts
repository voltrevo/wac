// Every package's coverage task, in one run, with the failures named.
//
//   deno task coverage:all
//   deno task coverage:all --verbose    # each failing task's output, in full
//
// ## Why this exists
//
// There are eighteen `coverage:*` tasks and, until this file, no way to run them but by hand, one at a
// time. So nobody did — and three of them had been exiting 1 for days without anyone noticing:
//
//   - `zstd`, four exemptions pinned to lines the code had moved off;
//   - `gzip`, two of the same;
//   - `crypto`, one of the same, plus `sha1.wac` compiled into the run and never once called — 41 branch
//     points reading 0%, which is a hole in the driver rather than in the tests.
//
// Each of those tasks was working exactly as designed. The check that catches a moved exemption is good,
// and it fired, and it printed the right thing every time. It just printed it where nothing was looking.
//
// This is deliberately **not** wired into `tools/push.sh`: putting a red check in the gate makes every
// other agent's push fail for something they did not do. When the reds below go green, this belongs in
// the gate, because a check nobody runs rots back into the state above.
//
// It did. As of 2026-08-11 three tasks exited 1 — `crypto` (wac-mono 0101, 45 uncovered points), `fs`
// (wac-mono 0134, red since `remote.wac` arrived on 2026-08-09 with 92 branch points the probe never
// called) and `gzip` (one reachable point). Sixteen were green.
//
// `fs` and `gzip` went green on 2026-08-12 and eighteen are green now; `crypto` (0101) is the one
// left, and it has grown from 45 uncovered points to 57 since that issue was filed, because
// `rsa.wac` gained PSS signing and new code arrives unmeasured while the task that would say so is
// deliberately not in the gate. **How long it took to notice is the number that matters here**:
// `fs` exited 1 for three days, on every run nobody made, while the package's README stated a
// figure from before the file it was missing existed.
//
// **A green ratchet does not defend a percentage.** What it fails on is a point that is neither driven
// nor recorded — so code can arrive with its exemptions written down and the number falls while the task
// stays green, which is how four package READMEs came to state a figure that was years of ticks old in
// repository time. A figure quoted in prose is dated for that reason.

import { announceHeavy } from "./suiteGate.ts";

// Announced so `tools/suiteGate.ts` can see this from another agent's suite: this builds
// programs and runs them, and nothing else made it visible. issues/system 0142.
const doneHeavy = announceHeavy("coverage:all");
globalThis.addEventListener("unload", () => doneHeavy());

const verbose = Deno.args.includes("--verbose");
const startedAll = performance.now();

/**
 * Every `coverage:*` task there is, read from `deno.json` rather than listed here.
 *
 * **It was a literal, and it had drifted.** Nineteen names against twenty-one tasks: `raster` and
 * `wacpkg` existed, were never swept, and so had ratchets that nothing enforced — a sweep that
 * silently covers less than it claims reads exactly like one that covers everything, until the
 * package it skipped regresses. Both passed when this was found, which is the only reason it cost
 * nothing. Deriving it means adding a task is the whole of adding it to the sweep.
 */
const TASKS = (JSON.parse(Deno.readTextFileSync("deno.json")) as { tasks: Record<string, string> })
  .tasks;
const PACKAGES = Object.keys(TASKS)
  .filter((t) => t.startsWith("coverage:") && t !== "coverage:all")
  .map((t) => t.slice("coverage:".length))
  .sort();

/**
 * Where a package's driver actually is, read out of the *command* rather than assumed.
 *
 * `packages/<pkg>/cov.ts` is wrong for `core`, whose tree is at the repository root — and the version
 * of this that assumed it reported `core` as having no driver at all while `core/cov.ts` sat there.
 * The same assumption would be wrong for the next tree that moves. The command names its own file, so
 * that is what is read: `deno run -A core/cov.ts` and
 * `… covreport.wac -- packages/codec/test/cov_exercise.wac …` both give it up to a regex.
 */
const driverOf = (pkg: string): string | null =>
  (TASKS[`coverage:${pkg}`] ?? "").match(/\S+\.(?:ts|wac)(?=\s|$)/g)
    ?.find((f) => !f.endsWith("covreport.wac")) ?? null;

type Result = { pkg: string; code: number; ms: number; output: string };

/**
 * Four at a time, because nineteen packages one after another is 38s of every push.
 *
 * `tools/push.sh` runs this after the suite and before the push, so nothing else is on the machine —
 * and each of these is one `deno run` over one package's probes, not the gigabyte-scale builds the
 * heavy lane holds back. Four is the width measured for the suite's own passes; the same number here
 * needs no separate argument.
 *
 * **Each line is printed when its package finishes, so they arrive out of order.** That is why the
 * package name was already on every line: the order was never what identified them. The summary and the
 * failure reports below read `results`, which is sorted back into `PACKAGES` order, so what a reader
 * scans for a red is stable even though the log is not.
 */
const WORKERS = 4;
const results: Result[] = [];
let next = 0;
const worker = async () => {
  while (next < PACKAGES.length) {
    const pkg = PACKAGES[next++];
    const started = performance.now();
    const cmd = new Deno.Command("deno", {
      args: ["task", `coverage:${pkg}`],
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout, stderr } = await cmd.output();
    const output = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);
    const ms = performance.now() - started;
    results.push({ pkg, code, ms, output });
    console.log(`${code === 0 ? "ok  " : "FAIL"}  coverage:${pkg}  ${(ms / 1000).toFixed(1)}s`);
  }
};
await Promise.all(Array.from({ length: Math.min(WORKERS, PACKAGES.length) }, () => worker()));
results.sort((a, b) => PACKAGES.indexOf(a.pkg) - PACKAGES.indexOf(b.pkg));

const failed = results.filter((r) => r.code !== 0);
// **Summed, not elapsed, and it says so.** These overlap now, so the sum is the work done rather than
// the time taken — reporting it as elapsed would make a 4x speedup look like no change at all.
const total = results.reduce((n, r) => n + r.ms, 0) / 1000;
const elapsed = (performance.now() - startedAll) / 1000;
/**
 * How many of these can actually fail — and it is four of twenty-one.
 *
 * **The line below used to read `19/19 passed`, which is not what happened.** Only `crypto`, `fs`,
 * `gzip` and `zstd` end their driver with a failure path; the other seventeen finish with `report(...)`
 * and exit 0 whatever they measured. So a run where a package lost half its coverage says `passed`
 * about it, and the paragraph `tools/push.sh` prints underneath — "a package above is below its
 * recorded coverage" — is true of four of them.
 *
 * Counted by looking for a failure path in each driver rather than hardcoded, so the number follows the
 * drivers instead of aging into another wrong figure. Whether the other seventeen *should* assert a
 * floor is a decision about each package, not something to infer here; naming the count is what stops
 * the summary from claiming it either way.
 */
const kinds = await Promise.all(results.map(async (r) => {
  // **Either driver, and "neither" is its own answer.** A package's driver is `cov.ts` until it moves
  // to `test/cov_exercise.wac` (`issues/system/0161`), and reading only the first meant a converted
  // package fell through `.catch(() => "")` into "reports" — which happens to be right for one with no
  // failure path and would be a silent wrong answer for one that has it. A task with no driver at all
  // is a task pointing at nothing, so it says so rather than being counted as harmless.
  const path = driverOf(r.pkg);
  const src = path === null ? null : await Deno.readTextFile(path).catch(() => null);
  // A task whose command names no driver, or names one that is not there, is a task pointing at
  // nothing — said out loud rather than counted among the harmless ones.
  if (src === null || path === null) return "no driver";
  // **A wac driver is exercises and nothing else *unless it ratchets*.** That was "always reports"
  // until 2026-08-20, when a coverage floor got a wac spelling: `tools/wac/covledger.wac` holds the
  // shared two-way ratchet and a package's driver calls it with its own pins
  // (`packages/gzip/test/cov_ledger.wac` is the first). So the marker is the call — not a `return 1;`
  // somewhere in the file, which would be a classification pretending to be a measurement.
  //
  // "floor" rather than "entries", and that is the stronger of the two: the shared ratchet fails when a
  // point nothing reaches has no entry *and* when an entry it carries has been covered or has drifted.
  if (path.endsWith(".wac")) return /\bratchet\(/.test(src) ? "floor" : "reports";
  if (!/Deno\.exit\(1\)/.test(src)) return "reports";
  // The two shapes differ in what they hold you to. One fails when a point nothing reaches has no
  // entry — a coverage floor. The others fail only when an entry they already carry has drifted onto
  // the wrong line, which is rot-proofing for the ledger and says nothing about whether coverage fell.
  return /branch point\(s\) uncovered/.test(src) ? "floor" : "entries";
}));
const count = (k: string) => kinds.filter((x) => x === k).length;

console.log(
  `\n${results.length - failed.length}/${results.length} ran in ${elapsed.toFixed(0)}s ` +
    `(${total.toFixed(0)}s of work at ${WORKERS} workers) — ${count("floor")} hold a coverage floor, ` +
    `${count("entries")} only check their own exemptions have not drifted, ${count("reports")} report ` +
    `and cannot fail` + (count("no driver") > 0 ? `, ${count("no driver")} have no driver at all` : ""),
);

for (const r of failed) {
  // The reason, not just the fact: a bare "FAIL" is the same silence this file exists to end. Each of
  // these lines is what that task's own report already said — repeated here so one screen has all of it.
  //
  // **`is listed as unreach` and not the whole sentence**, because the whole sentence was one word too
  // specific. `packages/crypto/cov.ts` says "is listed as unreached but was covered" and
  // gzip's `cov.ts` said "unreachable" — so a stale gzip entry of that kind exited 1 and had its
  // only explanation filtered out here. What reached the screen was the *continuation* line, "That
  // reason no longer holds — drop the entry.", which matched on `no longer holds` by accident: a reason
  // with its subject removed, naming no file and no line. gzip says "unreached" now as well, and this
  // matches the prefix so the next spelling cannot repeat it.
  const lines = r.output.split("\n").filter((l) =>
    /no longer holds|is listed as unreach|branch point\(s\) uncovered|^error/.test(l)
  );
  console.log(`\n── coverage:${r.pkg} (exit ${r.code})`);
  for (const l of verbose ? r.output.split("\n") : lines) console.log(`   ${l.replace(/\x1b\[[0-9;]*m/g, "")}`);
  if (!verbose && lines.length === 0) {
    console.log("   (nothing matched the known failure shapes — re-run with --verbose)");
  }
}

if (failed.length > 0) Deno.exit(1);
