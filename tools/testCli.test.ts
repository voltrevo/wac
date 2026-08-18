// `wac test`'s argument handling: **a flag after the path is a flag.**
//
// It was a *target*. Flags were read only up to the first argument that is not one, so
// `wac test packages/fs/ --allow-write` counted `--allow-write` as a file — one that does not exist, so
// one that "did not run" — and printed
//
//     2 files: 1 ok, 1 that did not run
//        --allow-write   did not run
//
// Two things wrong with that and neither says "you put the flag in the wrong place": the summary has a
// phantom entry that reads as a failing test, and the grant is silently absent from the run that did
// happen. Every other tool here takes flags in any position, so the order was not a rule anyone was
// keeping on purpose.
//
// Driven through the built binary because that is where the parsing lives — `native/v8/src/main.rs`,
// `test_command` — and a unit test of a Rust function is not something this repo's suite can run.

const WAC = "native/v8/target/release/wac";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

/** One passing test file, and nothing else — so the summary is about the arguments. */
async function oneTestDir(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "wac-testcli-" });
  await Deno.writeTextFile(
    `${dir}/x_test.wac`,
    "export string test_passes() { return \"\"; }\n",
  );
  return dir;
}

function run(args: string[]): { out: string; code: number } {
  const r = new Deno.Command(WAC, { args, stdout: "piped", stderr: "piped" }).outputSync();
  const dec = new TextDecoder();
  return { out: dec.decode(r.stdout) + dec.decode(r.stderr), code: r.code };
}

Deno.test("[§wac-cli-grants-3qm7wv2] wac test: a grant after the path is a flag, not a phantom test file", async () => {
  const dir = await oneTestDir();
  try {
    const before = run(["test", "--allow-read", dir]);
    assertEquals(before.code, 0, before.out);

    // The same run with the flag moved. It has to agree with the line above, exit status included.
    const after = run(["test", dir, "--allow-read"]);
    assertEquals(after.code, 0, after.out);
    assertEquals(after.out.includes("did not run"), false, after.out);
    assertEquals(after.out.includes("--allow-read"), false, after.out);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("wac test: --filter after the path keeps its value", async () => {
  const dir = await oneTestDir();
  try {
    // `--filter` carries a value, so a naive fix moves the flag and leaves `passes` looking like a
    // second directory — which discovery then reports as a file that did not run.
    const r = run(["test", dir, "--filter", "passes"]);
    assertEquals(r.code, 0, r.out);
    assertEquals(r.out.includes("did not run"), false, r.out);

    // ...and a filter matching nothing still fails, which is the whole point of that rule: a typo in a
    // filter must not be a green run over no tests.
    const none = run(["test", dir, "--filter", "nosuchtest"]);
    assertEquals(none.code === 0, false, none.out);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// **A test skipped for want of a grant is invisible in the summary**, which is the line anybody reads.
//
// `wac test packages/gzip/test/wac/` with no grants prints `15 files: 13 ok, 2 needing a host oracle` and
// exits 0 — while seventeen tests across three files were skipped by name, each said once in a per-file
// line that scrolls past. Two of us then measured that directory hours apart, one with grants and one
// without, and disagreed by 15× on a single file: the counts differed by three tests and neither of us
// read that as the answer (`issues/system/0183`).
//
// The per-file notice is right and stays. What is added is the *aggregate*, in the summary, next to the
// count of files needing an oracle — because "13 ok" over a run that skipped seventeen tests is the same
// green tick a differential comparing nothing wears.

Deno.test("wac test: the summary says how many tests were skipped for a grant", async () => {
  // **Inside the repository but under `.cache`**, and the second half of that is not cosmetic. The
  // entry imports `packages/platform` by a relative path, so the directory has to be in the tree —
  // but at the *root* it is walked by everything that reads this repository's own files, and it
  // disappears again a few milliseconds later. `tools/wacProbesReached.test.ts` died exactly there:
  // `NotFound: readdir 'wac-grantskip-8ba5ba4dcfa726e'`, a test failing on a directory belonging to a
  // test in another file. `.cache` is skipped by those walkers and swept by `issues/system/0136`.
  await Deno.mkdir(".cache", { recursive: true });
  const dir = await Deno.makeTempDir({ dir: ".cache", prefix: "wac-grantskip-" });
  try {
    await Deno.writeTextFile(
      `${dir}/y_test.wac`,
      'import { Cli, Core } from "../../packages/platform/src/platform.wac";\n' +
        'export string test_needs_nothing() { return ""; }\n' +
        'export string test_wants_a_capability(Core core, Cli cli) { return ""; }\n',
    );
    // **Two files**, because one takes the single-file shortcut: `wac test` prints no summary for it,
    // and the per-file notice is then adjacent to the result rather than lost above it. The summary is
    // the line this is about.
    await Deno.writeTextFile(`${dir}/z_test.wac`, 'export string test_also_passes() { return ""; }\n');
    const r = run(["test", dir]);
    // Not a failure: granting nothing is the default and skipping is the honest answer.
    assertEquals(r.code, 0, r.out);
    const summary = r.out.split("\n").find((l) => /^\d+ files?:/.test(l)) ?? "";
    if (!/grant/.test(summary)) {
      throw new Error(`the summary does not mention the skipped test: ${JSON.stringify(summary)}\n${r.out}`);
    }
    // And it says how many, since one skipped test and seventeen are different situations.
    if (!/\b1\b/.test(summary)) {
      throw new Error(`the summary does not count them: ${JSON.stringify(summary)}`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});



// ── `wac validate` ────────────────────────────────────────────────────────────────────────────────
//
// **A good module after a bad one is the case this exists for.** A rejected module leaves an
// exception on the isolate, and the next `WasmModuleObject::compile` walks into V8's own check that
// a null result and a pending exception agree — `Check failed: maybe_compiled.is_null() ==
// i_isolate->has_exception()` — which aborts the process with SIGABRT rather than returning. The
// first version of the command had no `TryCatch` and died exactly there, on the second module.
//
// It is a list rather than one path because the whole point is one isolate for many modules:
// `packages/wacc/test/wac/corpusemit_test.wac` asks about 543 of them.

/** A module the engine accepts, and a copy with its header broken. */
async function twoModules(): Promise<{ good: string; bad: string }> {
  const dir = await Deno.makeTempDir({ prefix: "wac-validate-" });
  const src = `${dir}/m.wac`;
  await Deno.writeTextFile(src, "export i32 main() { return 0; }\n");
  const built = await new Deno.Command(WAC, {
    args: ["build", src, "-o", `${dir}/m`],
    stdout: "null",
    stderr: "null",
  }).output();
  if (!built.success) throw new Error("could not build the module to validate");
  const good = `${dir}/m.wasm`;
  const bytes = await Deno.readFile(good);
  bytes[4] ^= 0xFF;
  const bad = `${dir}/bad.wasm`;
  await Deno.writeFile(bad, bytes);
  return { good, bad };
}

async function validate(paths: string[]): Promise<{ code: number; out: string }> {
  const r = await new Deno.Command(WAC, { args: ["validate", ...paths], stdout: "piped", stderr: "piped" })
    .output();
  return { code: r.code, out: new TextDecoder().decode(r.stdout).trim() };
}

Deno.test("[§wac-cli-validate-2hq7nx4] wac validate: a good module after a bad one still validates", async () => {
  const { good, bad } = await twoModules();
  const r = await validate([good, bad, good]);
  assertEquals(r.code, 1, "a rejected module fails the batch");
  assertEquals(r.out.split("\n").filter((l) => l.startsWith("rejected")).length, 1,
    `exactly the bad one is named — got:\n${r.out}`);
  assertEquals(r.out.split("\n").at(-1), "3 module(s): 1 rejected",
    "and the count is what it was asked for");
});

Deno.test("wac validate: names nothing when every module is accepted", async () => {
  const { good } = await twoModules();
  const r = await validate([good, good]);
  assertEquals(r.code, 0, "all accepted");
  assertEquals(r.out, "2 module(s): 0 rejected", "only the count");
});

Deno.test("[§wac-cli-validate-2hq7nx4] wac validate: a file it cannot read is a rejection, not a crash", async () => {
  const r = await validate(["/nope/does-not-exist.wasm"]);
  assertEquals(r.code, 1, "unreadable counts against it");
  assertEquals(r.out.split("\n").at(-1), "1 module(s): 1 rejected", "and is counted");
});

Deno.test("wac validate: no arguments is a usage error", async () => {
  const r = await validate([]);
  assertEquals(r.code, 2, "usage, not failure");
});


// ── `wac covdump` ─────────────────────────────────────────────────────────────────────────────────
//
// The counters themselves, which `--coverage` cannot give: it prints how many points were *reached*
// and this prints how many times each one ran. `packages/wacc/test/wac/coverage_test.wac` is what
// needs it — nothing in wac can call `__cov_get`, since the instrumentation injects it.

Deno.test("[§wac-cli-covdump-9pf3wq2] wac covdump: a module without counters is an error, not an empty report", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-covdump-" });
  const src = `${dir}/m.wac`;
  await Deno.writeTextFile(src, "export i32 main() { return 0; }\n");
  const built = await new Deno.Command(WAC, { args: ["build", src, "-o", `${dir}/m`], stdout: "null", stderr: "null" }).output();
  if (!built.success) throw new Error("could not build the module");
  const r = await new Deno.Command(WAC, { args: ["covdump", `${dir}/m.wasm`], stdout: "piped", stderr: "piped" }).output();
  assertEquals(r.code, 1, "a module built without coverage is an error");
  assertEquals(
    new TextDecoder().decode(r.stderr).includes("carries no counters"),
    true,
    `and says so — got: ${new TextDecoder().decode(r.stderr)}`,
  );
});

Deno.test("[§wac-cli-covdump-9pf3wq2] wac covdump: no arguments is a usage error", async () => {
  const r = await new Deno.Command(WAC, { args: ["covdump"], stdout: "null", stderr: "null" }).output();
  assertEquals(r.code, 2, "usage, not failure");
});
