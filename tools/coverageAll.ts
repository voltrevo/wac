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

const PACKAGES = [
  "bignum", "bytes", "codec", "crypto", "datetime", "fmt", "fs", "gzip", "http", "json",
  "regex", "server", "sh", "ssh", "std", "stream", "unicode", "url", "zstd",
];

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
console.log(
  `\n${results.length - failed.length}/${results.length} passed in ${elapsed.toFixed(0)}s ` +
    `(${total.toFixed(0)}s of work at ${WORKERS} workers)`,
);

for (const r of failed) {
  // The reason, not just the fact: a bare "FAIL" is the same silence this file exists to end. Each of
  // these lines is what that task's own report already said — repeated here so one screen has all of it.
  const lines = r.output.split("\n").filter((l) =>
    /no longer holds|is listed as unreached but was covered|branch point\(s\) uncovered|^error/.test(l)
  );
  console.log(`\n── coverage:${r.pkg} (exit ${r.code})`);
  for (const l of verbose ? r.output.split("\n") : lines) console.log(`   ${l.replace(/\x1b\[[0-9;]*m/g, "")}`);
  if (!verbose && lines.length === 0) {
    console.log("   (nothing matched the known failure shapes — re-run with --verbose)");
  }
}

if (failed.length > 0) Deno.exit(1);
