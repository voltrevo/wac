// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";
import { buildApp } from "../../platform/build.ts";
import { fixtures, sweep } from "../../../tools/shellFuzz.ts";
import { testBounded } from "../../../harness/deadline.ts";
import { loadNow } from "../../../harness/bounded.ts";

/**
 * Where this test had got to, for the report if it never gets any further.
 *
 * A wedge here does not fail this test — nothing bounds a `Deno.test` body, so the run continues
 * until `tools/push.sh` cuts the whole suite at 45 minutes and **nobody's push lands**, which is what
 * happened on 2026-08-11: this case and one in `sealed.test.ts` were "still running" when the gate
 * gave up, and both pass alone in well under a minute. A bound turns that into one failing test with
 * a sentence saying which seed and which script.
 */
let reached = "(nothing yet)";
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
//
// A fourth, on 2026-08-12, is the reason the generator's menu grew `( … )`, `&&`/`||` and `case`:
// the *same* fixed seeds then reached a compound that collected its output and let its errors go to
// whatever buffer the caller owned, so a subshell's line arrived after complaints that came later.
// Widening what the generator can say is how a ratchet keeps finding things rather than only
// holding what it has.
//
// **A bound that fires here is asked again before it is believed.** `shellFuzz` re-runs a script
// that hit its ten seconds at thirty, once, and only reports if it misses twice — so this member
// stops failing the gate for a machine that was busy, which it did on 2026-08-12 with a suite and a
// 1,500-script sweep sharing five cores. `issues/system/0128` is the argument.

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

testBounded({
  name: "generated scripts answer what bash answers, on the seeds that have been checked",
  ignore: !haveBash,
  onTimeout: () => console.error(`fuzz: the case did not finish (${loadNow()}). It had reached ${reached}`),
}, async () => {
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
      const hung: string[] = [];
      // Thirty scripts a seed, four seeds: enough to cover the shapes and quick enough to sit in the
      // gate. The tool is where a thousand belong.
      for (const seed of [1, 3, 11, 47]) {
        reached = `seed ${seed}`;
        for (const d of await sweep(shell, seed, 30, dir)) {
          // **A bound that fired is not a difference**, and saying so is the whole of this branch.
          // It read as one on 2026-08-10: `seed 3: v=set; until [ -f nosuchfile ]; do :; break; done`
          // came back `bash "" (0) / ours "" (124)` in a gate on a busy machine, and the same script
          // finishes instantly on an idle one. Somebody — me — then went looking for a regression in
          // `break`, because the report said the shells disagreed about an exit status.
          if (d.hung !== undefined) {
            hung.push(`seed ${seed}: ${d.script}\n    ${d.hung}`);
            continue;
          }
          differed.push(`seed ${seed}: ${d.script}\n    bash ${JSON.stringify(d.bash)} (${d.codes[0]})` +
            `\n    ours ${JSON.stringify(d.ours)} (${d.codes[1]})`);
        }
      }
      // Reported separately and *not* as a failure: on a machine this loaded a ten-second bound says
      // more about the machine than about the shell. A script that hangs on an idle one shows up as a
      // difference the moment the bound stops being the reason.
      if (hung.length > 0) {
        console.log(`  ${hung.length} script(s) hit the bound rather than answering:\n  ${hung.join("\n  ")}`);
      }
      assertEquals(differed.length, 0, `${differed.length} generated script(s) differ:\n  ${differed.join("\n  ")}`);
    } finally {
      await Deno.remove(shell).catch(() => {});
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
});
