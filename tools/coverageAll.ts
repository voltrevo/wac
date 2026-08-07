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
// This is deliberately **not** wired into `tools/push.sh`. `crypto` is still red — 68 uncovered branch
// points that are neither covered nor recorded as unreachable — and putting a red check in the gate makes
// every other agent's push fail for something they did not do. wac-mono 0098 has the list. When that goes
// green, this belongs in the gate, because a check nobody runs rots back into the state above.

const verbose = Deno.args.includes("--verbose");

const PACKAGES = [
  "bignum", "bytes", "codec", "crypto", "datetime", "fmt", "gzip", "http", "json",
  "regex", "server", "sh", "ssh", "std", "stream", "unicode", "url", "zstd",
];

type Result = { pkg: string; code: number; ms: number; output: string };

const results: Result[] = [];
for (const pkg of PACKAGES) {
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

const failed = results.filter((r) => r.code !== 0);
const total = results.reduce((n, r) => n + r.ms, 0) / 1000;
console.log(`\n${results.length - failed.length}/${results.length} passed in ${total.toFixed(0)}s`);

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
