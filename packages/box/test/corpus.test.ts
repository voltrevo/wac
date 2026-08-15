// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
// test-lane: heavy — 1182 MB and 32s — the highest peak in packages/box, one process per applet case
import "../../../harness/spawnRetry.ts";
import { pool } from "../../../harness/inFlight.ts";
import { loadNow } from "../../../harness/bounded.ts";
import { CORPUS, needsProgram } from "../../sh/test/corpus.ts";
// The shell corpus, through a shell built with **these** applets.
//
// `packages/sh` carries its own `cat`, `wc`, `head`, `tail`, `sort`, `uniq`, `nl`, `rev`, `grep`, `tr`
// and `seq`, and this package has all eleven as applets. Two implementations of the same tool in one
// repo is the arrangement that let `grep '^h'` answer "nothing matched" in one shell and the right
// lines in the other for months: both suites passed, because each was testing its own half
// (wac-mono 0103).
//
// So this file takes the half that is about the programs. Every script in `packages/sh`'s corpus that
// names one of the eleven runs through `src/bin/sh.wac` — the shell with every applet wired in — and
// must agree with bash on standard output *and* exit status. `packages/sh`'s own differential keeps the
// scripts that are about the shell language, which is the split wac-mono 0103 needs before its copies
// can be deleted.
//
// The corpus is one list, imported from where it lives rather than copied. A second copy would drift
// exactly the way the programs did.

const enc = new TextEncoder();

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
    const r = await new Deno.Command("bash", { args: ["-c", "echo x"], stdout: "piped", stderr: "null" })
      .output();
    return r.success;
  } catch {
    return false;
  }
})();

Deno.test({
  name: "every corpus script that names a program agrees with bash through box's applets",
  ignore: !haveBash,
  fn: async () => {
    const { buildApp } = await import("../../platform/build.ts");
    const built = await Deno.makeTempFile({ prefix: "box-corpus-sh-" });
    const home = await Deno.makeTempDir({ prefix: "box-corpus-" });
    try {
      await buildApp("packages/box/src/bin/sh.wac", built, { read: true, write: true, net: true, env: true });

      const cases = CORPUS.filter(needsProgram);
      // Said rather than assumed. A classifier that matched nothing would leave this test green and the
      // programs unmeasured, which is the failure this whole split exists to prevent.
      assertEquals(cases.length > 200, true, `only ${cases.length} scripts name a program — has the corpus moved?`);

      /**
       * One script, under a bound.
       *
       * `timeout(1)` rather than a `setTimeout` and `child.kill`: killing the child leaves `output()`
       * accumulating what was already down a pipe nobody drains, and the run reports nothing. The
       * corpus contains `seq 1 100000 | grep -q 5`, which finishes only because `-q` stops at the first
       * match — a shell whose `-q` reads everything hangs here rather than failing, and the bound is
       * what turns that into a result.
       */
      const run = async (cmd: string, script: string, dir: string, seconds = 20) => {
        const started = performance.now();
        const r = await new Deno.Command("timeout", {
          args: [String(seconds), cmd, "-c", script],
          cwd: dir,
          stdin: "null",
          stdout: "piped",
          stderr: "piped",
          // **A locale on both sides, and it is `C.UTF-8`.** The pin came from `packages/sh`'s
          // differential, which no longer runs a single script naming an external program — every one
          // of them is here instead. Its purpose is that a run does not depend on whoever's `LANG`
          // started it, and `C.UTF-8` is as fixed as `C` while also being what this machine has.
          //
          // It was `C`, and that had started to matter. Since 0143 `wc -w` splits and counts
          // printables by **code point**, matching `wc(1)` under the ambient locale; pinned to `C` the
          // real one answered differently — `printf 'a\xc2\xa0b' | wc -w` is 1 there and 2 here — so a
          // corpus script feeding non-ASCII to `wc` would have failed on the locale rather than on the
          // shell. Nothing did: one of the 842 entries has a byte over 0x7F and it does not run `wc`.
          //
          // Measured before moving, because the oracle here is bash and not only the tools it calls:
          // `tr`, `cut`, `fold`, `grep`, `head`, `sort` and `uniq` produce identical bytes under both,
          // and so do bash's own `[[ =~ ]]`, `case` ranges and collation, glibc's `C.UTF-8` ordering
          // by code point. `sed` is the one tool that differs — its `.` is a byte in `C` and a
          // character in `C.UTF-8` — and `box` has no `sed`. issues/system 0145.
          env: { LC_ALL: "C.UTF-8", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: home },
          clearEnv: true,
        }).output();
        const d = new TextDecoder();
        return {
          out: d.decode(r.stdout), err: d.decode(r.stderr), code: r.code, hung: r.code === 124,
          ms: Math.round(performance.now() - started),
        };
      };

      const differences: string[] = [];
      await pool(cases, 4, async (script, _i, note) => {
        // One directory per case: several scripts write `f`, `d` and `out`, and a case that found the
        // previous one's file would pass or fail on whichever order the pool happened to use.
        const dir = await Deno.makeTempDir({ prefix: "box-corpus-case-" });
        try {
          note("bash+boxsh");
          const [want, got] = await Promise.all([run("bash", script, dir), run(built, script, dir)]);
          let ours = got;
          if (ours.hung && !want.hung) {
            // **A bound is not a verdict on a machine three agents share.** Twenty seconds is there so
            // one genuine hang cannot wedge the suite — `seq 1 100000 | grep -q 5` finishes only
            // because `-q` stops at the first match, and a shell whose `-q` reads everything would sit
            // here for ever. But at load 15 with four cases in flight inside a suite that is itself
            // parallel, `grep -c 'a\+'` over five lines reached it too, and the gate reported "ours
            // did not finish" about a script that takes 40ms alone. That is starvation wearing a
            // defect's clothes, and it cost a push.
            //
            // So a case that hits the bound is re-run **alone, with three times the bound**, in a
            // fresh directory, before anything is claimed. Once, not until green: if it hangs again
            // the report says both attempts, and if it finishes its answer is compared like any
            // other — a slow case still has to agree with bash.
            const retryDir = await Deno.makeTempDir({ prefix: "box-corpus-retry-" });
            try {
              note("retry alone");
              const again = await run(built, script, retryDir, 60);
              if (again.hung) {
                differences.push(
                  `script: ${JSON.stringify(script)}\n` +
                  `  bash finished in ${want.ms}ms; ours did not, in 20s and not in 60s alone either` +
                  ` (${loadNow()})`,
                );
                return;
              }
              console.error(
                `corpus: ${JSON.stringify(script)} hit the 20s bound and finished in ${again.ms}ms ` +
                `alone — ${loadNow()}, so this is the machine rather than the shell`,
              );
              ours = again;
            } finally {
              await Deno.remove(retryDir, { recursive: true }).catch(() => {});
            }
          }
          const got2 = ours;
          if (want.out !== got2.out || want.code !== got2.code) {
            differences.push(
              `script: ${JSON.stringify(script)}\n` +
              `  bash: ${JSON.stringify(want.out)} exit ${want.code}\n` +
              `  ours: ${JSON.stringify(got2.out)} exit ${got2.code}` +
              (got2.err.trim() === "" ? "" : `\n  stderr: ${got2.err.trim().split("\n")[0]}`),
            );
          }
        } finally {
          await Deno.remove(dir, { recursive: true }).catch(() => {});
        }
      }, {
        what: "script",
        label: (script) => (script.length > 110 ? `${script.slice(0, 110)}…` : script),
      });

      if (differences.length > 0) {
        throw new Error(
          `${differences.length} of ${cases.length} scripts differ from bash:\n\n${differences.join("\n\n")}`,
        );
      }
    } finally {
      await Deno.remove(built).catch(() => {});
      await Deno.remove(home, { recursive: true }).catch(() => {});
    }
  },
});
