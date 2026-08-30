// Our standard error against bash's, for the whole shell corpus.
//
//   wac task corpus:stderr [--from N] [--count N]
//
// **Nothing compared standard error until this existed.** `packages/sh/test/differential.test.ts`
// runs every corpus script through bash and through this shell and asserts stdout and the exit
// status — with `stderr: "null"`, so the messages were never even captured. `packages/box`'s half
// captures them and uses them only to decorate a failure. So a repository that measures GNU's exact
// wording tool by tool (`cannotOpen` has five sentences, each read off the tool it belongs to) had no
// differential over the thing those sentences are.
//
// Measured, the first time it ran: 735 of 821 scripts print nothing on either side, 28 matched, and
// **58 differed**. After the shell learned to name itself and its arithmetic learned to name the token
// it stopped at, 67 match and 19 differ. Forty of those were one fact — a builtin's diagnostic did not name the shell, so
// this said `[: too many arguments` where bash says `bash: line 1: [: too many arguments`. That is
// fixed (`prefixed` in `packages/sh/src/exec.wac`), and what is left is below.
//
// ## The one thing normalised, and why only that
//
// bash names itself and the line: `bash: line 1: `, `bash: -c: line 1: `, and `environment: line 1: `
// inside a function it was given on the command line. We are not bash and our name is `sh`, so that
// prefix is mapped to `sh: ` rather than stripped — mapped, because stripping would hide a diagnostic
// where *we* forgot to name ourselves, which is exactly the bug this found.
//
// Nothing else is normalised. Every remaining difference is a real one and is pinned below with the
// reason, so a *new* divergence fails and a *fixed* one fails too — a pin that has gone stale is a
// thing somebody should delete, not a thing to leave passing.

import { CORPUS } from "../packages/sh/test/corpus.ts";
import { announceHeavy } from "./suiteGate.ts";
import { KNOWN, sameName } from "../packages/sh/test/shname.ts";

// Announced so `tools/suiteGate.ts` can see this from another agent's suite: this builds
// programs and runs them, and nothing else made it visible. issues/system 0142.
const doneHeavy = announceHeavy("corpus:stderr");
globalThis.addEventListener("unload", () => doneHeavy());
import { buildApp } from "../harness/buildApp.ts";
import "../harness/spawnRetry.ts";




const args = Deno.args;
const flag = (name: string, fallback: number): number => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? Number(args[at + 1]) : fallback;
};

if (import.meta.main) {
  const dir = await Deno.makeTempDir({ prefix: "corpus-stderr-" });
  const shell = `${dir}/wacsh`;
  await buildApp("packages/box/src/bin/sh.wac", shell, { read: true, write: true, env: true });

  const run = (cmd: string, script: string, cwd: string) => {
    const r = new Deno.Command("timeout", {
      args: ["10", cmd, "-c", script],
      cwd,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      // **`C.UTF-8`, not `C`** — the locale this machine actually has, and the one every
      // applet is measured against. `box`'s `wc -w` counts by code point since issues/system 0143,
      // so pinned to `C` the real `wc` answers 1 where ours answers 2 for `a\xc2\xa0b`, and a corpus
      // script feeding non-ASCII to it would fail on the locale rather than on the shell. Measured
      // before moving: `tr`, `cut`, `fold`, `grep`, `head`, `sort` and `uniq` produce identical bytes
      // under both, bash's own `[[ =~ ]]`, `case` ranges and collation are identical too because
      // glibc's `C.UTF-8` orders by code point, and `box` has no `sed` — which is the one tool that
      // does differ. issues/system 0145.
      env: { LC_ALL: "C.UTF-8", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: cwd },
      clearEnv: true,
    }).outputSync();
    const d = new TextDecoder();
    // 124 is `timeout`'s, not a shell's — see `tools/wac/corpusthrough.wac`, which has kept them apart since it
    // was written. A bound that fired has no stderr to compare, so it is skipped rather than counted
    // as a difference in wording.
    return { err: d.decode(r.stderr), code: r.code, hung: r.code === 124 };
  };

  const from = flag("from", 0);
  const cases = CORPUS.slice(from, from + flag("count", CORPUS.length));
  const pinned = new Map(KNOWN.map((k) => [k.script, k]));
  let agree = 0;
  const hung: string[] = [];
  const fresh: string[] = [];
  const stale: string[] = [];

  for (let i = 0; i < cases.length; i++) {
    const script = cases[i];
    const a = `${dir}/a${i}`, b = `${dir}/b${i}`;
    Deno.mkdirSync(a, { recursive: true });
    Deno.mkdirSync(b, { recursive: true });
    const bashRan = run("bash", script, a);
    const oursRan = run(shell, script, b);
    const theirs = sameName(bashRan.err).trimEnd();
    const ours = oursRan.err.trimEnd();
    Deno.removeSync(a, { recursive: true });
    Deno.removeSync(b, { recursive: true });

    // A bound that fired has no sentence to compare — see `run`. Counted on its own so a loaded
    // machine reads as a loaded machine rather than as forty new wording differences.
    if (bashRan.hung || oursRan.hung) {
      hung.push(script);
      continue;
    }

    const known = pinned.get(script);
    if (theirs === ours) {
      agree++;
      if (known !== undefined) {
        stale.push(`${JSON.stringify(script)}\n  pinned as different; it now agrees — delete the row`);
      }
      continue;
    }
    if (known === undefined) {
      fresh.push(`${JSON.stringify(script)}\n  bash: ${JSON.stringify(theirs)}\n  ours: ${JSON.stringify(ours)}`);
      continue;
    }
    if (known.bash.trimEnd() !== theirs || known.ours.trimEnd() !== ours) {
      stale.push(
        `${JSON.stringify(script)}\n  pinned bash: ${JSON.stringify(known.bash)}\n  actual bash: ${JSON.stringify(theirs)}` +
          `\n  pinned ours: ${JSON.stringify(known.ours)}\n  actual ours: ${JSON.stringify(ours)}`,
      );
    }
  }

  await Deno.remove(dir, { recursive: true }).catch(() => {});
  console.log(`${agree} of ${cases.length - hung.length} scripts print the same on standard error as bash`);
  if (hung.length > 0) {
    console.log(`  ${hung.length} did not finish inside the bound and were not compared:`);
    for (const h of hung) console.log(`      ${JSON.stringify(h)}`);
  }
  for (const f of fresh) console.log(`new difference:\n${f}`);
  for (const s of stale) console.log(`stale pin:\n${s}`);
  if (fresh.length > 0 || stale.length > 0) Deno.exit(1);
}
