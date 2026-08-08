// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";
import { buildApp } from "../../platform/build.ts";
import { fixtures, sweep } from "../../../tools/shellFuzz.ts";
// The generator, on fixed seeds, as an ordinary test.
//
// `tools/shellFuzz.ts` is the exploring tool — any seed, any count. This is the ratchet: a handful of
// seeds that produced agreement when they were added, so a change that breaks one of those scripts
// fails here rather than waiting for somebody to think of running the tool.
//
// **Fixed seeds rather than a random draw**, deliberately. A suite that generates fresh scripts every
// run is a suite that fails for a different reason each time, and the first person to see it flake
// deletes it. What the tool is for is finding *new* differences; what this is for is keeping the ones
// already found from coming back.
//
// It has found three things worth this file existing: wac-mono 0113 (a pipeline whose first stage
// produces nothing hung), `test`'s diagnostics naming `test` when reached through `[`, and `$?` on a
// `for` body's first line being 0 rather than what the previous command answered.

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const haveBash = await (async () => {
  try {
    const r = await new Deno.Command("bash", { args: ["-c", "echo x"], stdout: "null", stderr: "null" })
      .output();
    return r.success;
  } catch {
    return false;
  }
})();

Deno.test({
  name: "generated scripts answer what bash answers, on the seeds that have been checked",
  ignore: !haveBash,
  fn: async () => {
    const shell = await Deno.makeTempFile({ prefix: "sh-fuzz-" });
    const dir = await Deno.makeTempDir({ prefix: "sh-fuzz-" });
    try {
      // **`packages/box`'s shell, because bash has a `cat`.** The first version of this built
      // `packages/sh/src/sh.wac`, whose "command not found" is a perfectly good answer and not bash's —
      // 35 of 120 scripts differed for that reason alone. A generator that names commands has to run
      // against a shell that has them, which is this package's, and is why this file lives here rather
      // than beside the corpus it shares a purpose with.
      await buildApp("packages/box/src/bin/sh.wac", shell, { read: true, write: true, env: true });
      await fixtures(dir);

      const differed: string[] = [];
      // Thirty scripts a seed, four seeds: enough to cover the shapes and quick enough to sit in the
      // gate. The tool is where a thousand belong.
      for (const seed of [1, 3, 11, 47]) {
        for (const d of await sweep(shell, seed, 30, dir)) {
          differed.push(`seed ${seed}: ${d.script}\n    bash ${JSON.stringify(d.bash)} (${d.codes[0]})` +
            `\n    ours ${JSON.stringify(d.ours)} (${d.codes[1]})`);
        }
      }
      assertEquals(differed.length, 0, `${differed.length} generated script(s) differ:\n  ${differed.join("\n  ")}`);
    } finally {
      await Deno.remove(shell).catch(() => {});
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  },
});
