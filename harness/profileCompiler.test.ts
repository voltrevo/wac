// Profiling builds with the same compiler an ordinary bind uses.
//
// `bindFrom` defaults to `wacc`, so `wacBind` normally never asks the reference anything. Its
// profiling branch skipped `generate` entirely and called `wacCompile` — the reference — directly.
// The reference is a documented subset (`spec/README.md`, `design/lang/0003`), so a package using
// anything only wacc has could not be profiled at all: all seven of `packages/zstd`'s test files
// failed on `u32.leadingZeros`, and the package contributed **nothing** to the coverage profile that
// `tools/mutate.ts` selects tests from. `issues/system/0163`.
//
// It surfaced as one line among 380 in a 26-minute profiling pass — `using partial coverage`, where
// partial meant none — and the damage is not the missing package. It is a line those tests share
// with another package's: that line *is* in the profile, with these tests absent from its list, so
// selection narrows to a filter that excludes the tests which would have killed the mutant. A wrong
// verdict arriving as a better score.
//
// **A subprocess, because `WAC_PROFILE` is read once when `wacProfile.ts` is imported.** Setting it
// from inside a test is too late for the module that already decided it was not profiling.

import { wacCompile } from "wac/wacCompile.ts";
import { wacFiles } from "./wacFiles.ts";
import { ROOT } from "./programs.ts";

/** A subject the *reference* cannot compile, which is the whole point of it. */
const SUBJECT = "packages/zstd/src/fse.wac";

Deno.test("the reference still refuses the subject, so this test still discriminates", async () => {
  // Without this, the day the reference gains `u32.leadingZeros` the test below keeps passing and
  // stops testing anything — it would be satisfied by the bug it was written for. This says so
  // instead, and names what to do about it.
  const r = wacCompile(await wacFiles(`${ROOT}/${SUBJECT}`), `${ROOT}/${SUBJECT}`);
  if (r.ok) {
    throw new Error(
      `the reference now compiles ${SUBJECT}, so the test below no longer distinguishes the two ` +
        `compilers. Point both at another file wacc accepts and the reference does not — or, if ` +
        `there is no longer any such file, say so and delete them.`,
    );
  }
});

Deno.test("a file only wacc compiles is profiled rather than skipped", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-profcomp-" });
  const driver = `${dir}/drive.ts`;
  const out = `${dir}/profile`;
  await Deno.writeTextFile(
    driver,
    `import { wacBind } from "${new URL("./wacBind.ts", import.meta.url).href}";\n` +
      `Deno.test("subject", async () => { await wacBind("${SUBJECT}"); });\n`,
  );
  try {
    const r = await new Deno.Command(Deno.execPath(), {
      args: ["test", "--no-check", "--allow-all", "--unstable-net", "--quiet", driver],
      cwd: ROOT,
      env: { WAC_PROFILE: out },
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (r.code !== 0) {
      throw new Error(
        `binding ${SUBJECT} under WAC_PROFILE failed (exit ${r.code}):\n` +
          new TextDecoder().decode(r.stderr).slice(0, 600),
      );
    }
    // Exiting 0 is not enough: a build that silently produced no counters would also do that, and
    // that is the second half of this bug — wacc's bindgen writes the `__cov_init`/`__cov_len`/
    // `__cov_get` wrappers only when it is told the build is instrumented, so without the flag the
    // exports exist in the wasm and nothing can reach them.
    let points = 0;
    for await (const e of Deno.readDir(out)) {
      if (!e.name.endsWith(".json")) continue;
      const doc = JSON.parse(await Deno.readTextFile(`${out}/${e.name}`)) as { all?: string[] };
      points += doc.all?.length ?? 0;
    }
    if (points === 0) {
      throw new Error(
        `${SUBJECT} bound under WAC_PROFILE and wrote no coverage points. The module compiled and ` +
          `contributed nothing, which is the shape this bug had: a package invisible to selection ` +
          `while every count elsewhere stayed plausible.`,
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
