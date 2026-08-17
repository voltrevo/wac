// Run every package's own test suite against modules `wacc` compiled, and tally what passes.
//
//     deno run -A packages/wacc/tools/runOnWacc.ts [package …]
//
// This is the half of rung 4 that `test/wac/corpusemit_test.wac` names and does not do. That test compiles the
// repository and checks the modules are well-formed; a well-formed module can still compute the wrong
// answer, and nothing here had ever *run* code `wacc` produced except its own bootstrap.
//
// `harness/wacBind.ts` does the swap when `WAC_WASM_FROM=wacc` is set: the interface metadata stays
// the reference's — `wacc` has no bindgen — and only the wasm bytes change. So a green package says
// wacc's **emitter** is right for that package, not that wacc could have produced its bindings.
//
// Not part of the suite. It compiles every entry with a second compiler and runs everything twice
// over, which is minutes rather than seconds, and it is a measurement to take deliberately rather
// than a gate to keep green.

const only = new Set(Deno.args);

const packages: string[] = [];
for await (const e of Deno.readDir("packages")) {
  if (!e.isDirectory || e.name === "wacc") continue;
  try {
    const st = await Deno.stat(`packages/${e.name}/test`);
    if (st.isDirectory) packages.push(e.name);
  } catch { /* no test directory */ }
}
packages.sort();

type Row = { pkg: string; passed: number; failed: number; cause: string };
const rows: Row[] = [];

for (const pkg of packages) {
  if (only.size > 0 && !only.has(pkg)) continue;
  const run = await new Deno.Command(Deno.execPath(), {
    args: ["test", "-A", "--no-check", `packages/${pkg}/test`],
    // **Extending the environment, not replacing it.** `Deno.Command`'s `env` is the whole
    // environment, so passing one variable ran every package with nothing else set — and tests that
    // gate on an environment variable then chose differently. `http` reported 29 passing here and
    // 24 passing with one failure when run by hand, which is the tally disagreeing with itself
    // rather than either answer being wrong about wacc.
    // `WAC_BIND_FROM=wacc` is passed straight through when the caller sets it, which swaps the
    // *whole* binding — wacc's metadata and wacc's generator as well as its bytes. Without it this
    // measures the emitter alone, which is what it has always measured.
    env: { ...Deno.env.toObject(), WAC_WASM_FROM: "wacc" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const out = new TextDecoder().decode(run.stdout) + new TextDecoder().decode(run.stderr);
  const tally = out.match(/(\d+) passed(?: \| (\d+) failed)?/);
  const passed = tally ? Number(tally[1]) : 0;
  const failed = tally && tally[2] ? Number(tally[2]) : (run.success ? 0 : -1);

  // The first *message* that says why, not the first line mentioning it: Deno echoes the throwing
  // source line into the stack trace, and a pattern loose enough to match that reports the template
  // literal `${entry}` rather than the file it names.
  // **A missing export is not a wrong answer.** The first version of this had no case for it, so an
  // export the module simply does not have fell into the `failed > 0` bucket and was reported as
  // *wrong answer* — a stronger claim than the evidence, and the wrong one to act on. `json` and
  // `http` were both this: the module bound, and three of `json`'s four exported functions were not
  // in it. See `issues/lang/0090`.
  // `\w` stops at a `$`, and a monomorphisation's bind name is full of them —
  // `$bind$sm_Vec__packages_std_src_vec$string_create` did not match, so a missing helper was
  // reported as *a wrong answer or a trap*: the stronger claim again, and the wrong one to act on.
  const helper = out.match(/\$exports\.(\$bind\$[\w$]+) is not a function/)?.[1];
  const absent = out.match(/\$exports\.([\w$]+) is not a function/)?.[1];
  const cause = helper ??
    (absent ? `missing export: ${absent}` : undefined) ??
    out.match(/Error: wacc cannot compile \S+ yet — (.+)/)?.[1] ??
    (failed > 0 ? "a wrong answer or a trap" : "");

  rows.push({ pkg, passed, failed, cause });
  const mark = failed === 0 ? "ok  " : "FAIL";
  console.log(`${mark} ${pkg.padEnd(14)} ${String(passed).padStart(4)} passed  ${cause}`);
}

const green = rows.filter(r => r.failed === 0);
const tests = green.reduce((n, r) => n + r.passed, 0);
console.log(
  `\n${green.length} of ${rows.length} packages pass their own suite on wacc-emitted code ` +
    `(${tests} tests)`,
);

const causes = new Map<string, number>();
for (const r of rows) {
  if (r.failed === 0 || r.cause === "") continue;
  causes.set(r.cause, (causes.get(r.cause) ?? 0) + 1);
}
if (causes.size > 0) {
  console.log("\nwhy the rest do not:");
  for (const [cause, n] of [...causes].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${cause}`);
  }
}
