// The whole shell corpus, through **both ways a shell can run an applet**.
//
//   deno task corpus:routes [--from N] [--count N]
//
// `packages/sh`'s shell runs an external program one of two ways: **called** in process through
// `sh.external` — `boxRun`, which pushes a frame with `pushChild` and takes the output back with
// `popChild` — or **spawned** as a real child of its own instance. Both are live code and they are
// supposed to be indistinguishable.
//
// ## Why this exists now
//
// It did not need to until 2026-08-09, because the called route was what nearly everything did. Then
// wac-mono 0116 made a spawned stage able to see its parent's filesystem, and `sealedsh`, `imaged`,
// `sshd -i` and the browser terminal all turned spawning on. Every session binary now spawns, so the
// three differentials that existed — `corpus:backings`, `corpus:hosts` and `native_shell` — stopped
// covering the called route entirely.
//
// It is still reachable and still shipped: `packages/box/example/boxsh.wac` is exactly `wacsh` with
// the spawn turned off, `site/tools/site.test.ts` runs the front page's commands through it, and it is what
// any world that *cannot* spawn falls back to. A route with no coverage and no way to notice is the
// thing this repository keeps finding in other people's code.
//
// ## The two programs, and why they are comparable
//
// `boxsh` and `wacsh` are the same wiring over the same host filesystem, differing in one line:
// `sh.externalSpawnable`. So a difference between them is a difference between the routes and nothing
// else — not a filesystem, not a set of applets, not a shell.
//
// ## What is *expected* to differ, and is therefore not in the corpus
//
// One thing: a called applet's output is **captured in memory and capped at 8 MiB**, so past the cap
// there is nothing it can do, while a spawned one's queue drains as the next stage reads it. It used
// to answer 8323568 where bash answers 10888896 — a wrong number, silently — because `write`
// returning false at the cap is indistinguishable, from inside the applet, from the reader going
// away, which is what `box yes` is written to stop on. `Captured.truncated` carries the difference
// now and the called route refuses with a sentence instead.
//
// The canary below asserts that divergence rather than hiding it, because a run where the two routes
// agreed on *everything* would most likely mean `boxsh` had quietly started spawning too, and this
// whole comparison would be measuring nothing.

import { buildApp } from "../packages/platform/build.ts";
import { announceHeavy } from "./suiteGate.ts";

// Announced so `tools/suiteGate.ts` can see this from another agent's suite: this builds
// programs and runs them, and nothing else made it visible. issues/system 0142.
const doneHeavy = announceHeavy("corpus:routes");
globalThis.addEventListener("unload", () => doneHeavy());
import { CORPUS } from "../packages/sh/test/corpus.ts";
import "../harness/spawnRetry.ts";

const args = Deno.args;
const flag = (name: string, fallback: number): number => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? Number(args[at + 1]) : fallback;
};
const from = flag("from", 0);
const count = flag("count", CORPUS.length);

const dir = await Deno.makeTempDir({ prefix: "corpus-routes-" });
const called = `${dir}/boxsh`;
const spawned = `${dir}/wacsh`;
await buildApp("packages/box/example/boxsh.wac", called, { read: true, write: true, env: true });
await buildApp("packages/box/src/bin/sh.wac", spawned, { read: true, write: true, env: true });

type Run = { code: number; out: string; err: string; hung: boolean };

function run(cmd: string, script: string, cwd: string): Run {
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
  return {
    code: r.code,
    out: d.decode(r.stdout),
    err: d.decode(r.stderr),
    hung: r.code === 124,
  };
}

/** One script's two answers, each in a directory of its own so neither sees the other's files. */
function both(script: string, n: number): { called: Run; spawned: Run } {
  const a = `${dir}/a${n}`, b = `${dir}/b${n}`;
  Deno.mkdirSync(a, { recursive: true });
  Deno.mkdirSync(b, { recursive: true });
  const answers = { called: run(called, script, a), spawned: run(spawned, script, b) };
  Deno.removeSync(a, { recursive: true });
  Deno.removeSync(b, { recursive: true });
  return answers;
}

const same = (a: Run, b: Run) => a.out === b.out && a.err === b.err && a.code === b.code;
const show = (r: Run) => `${JSON.stringify(r.out + r.err)} (${r.code})`;

// **The canary, first.** Everything below is "these agree", which two shells that both did nothing
// would also report — and the specific way this comparison could become vacuous is `boxsh` starting
// to spawn, at which point the two are the same program. So: the one case the routes are *known* to
// answer differently, asserted to differ.
{
  const capped = both("seq 1 1500000", -1);
  if (!capped.called.err.includes("output exceeded") || capped.called.code === 0) {
    console.error(
      "the called route did not refuse output past its cap, so this comparison is measuring one\n" +
        `program twice: called ${show(capped.called)}`,
    );
    Deno.exit(2);
  }
  if (same(capped.called, capped.spawned)) {
    console.error(
      `the two routes agree past the cap, which they cannot. spawned ${show(capped.spawned)}`,
    );
    Deno.exit(2);
  }
}

const cases = CORPUS.slice(from, from + count);
let agree = 0;
const hung: string[] = [];
const differ: string[] = [];

for (let i = 0; i < cases.length; i++) {
  const script = cases[i];
  const answers = both(script, from + i);
  if (answers.called.hung || answers.spawned.hung) {
    hung.push(script);
    continue;
  }
  if (same(answers.called, answers.spawned)) {
    agree++;
    continue;
  }
  differ.push(
    `${JSON.stringify(script)}\n  called  ${show(answers.called)}\n  spawned ${show(answers.spawned)}`,
  );
}

await Deno.remove(dir, { recursive: true }).catch(() => {});

console.log(`${agree} of ${cases.length} scripts agree between the called and spawned applet routes`);
for (const script of hung) console.log(`  timed out: ${JSON.stringify(script)}`);
for (const d of differ) console.log(d);
if (differ.length > 0 || hung.length > 0) Deno.exit(1);
