// The two ways a shell can run an applet, held to each other — **called** and **spawned**.
//
// `sh.external` runs an applet in this instance, through `pushChild`/`popChild`; `externalSpawnable`
// runs it as a real child. Both are live and they are supposed to be indistinguishable.
//
// ## Why this file exists
//
// Until 2026-08-09 nearly everything took the *called* route, so every differential in the repository
// covered it by accident. Then wac-mono 0116 gave a spawned stage its parent's filesystem and
// `sealedsh`, `imaged`, `sshd -i` and the browser terminal all turned spawning on — which left the
// called route with no coverage at all, in the same commit that made it the road less travelled.
//
// It is still shipped and still reachable: `packages/box/example/boxsh.wac` is `wacsh` with the spawn
// turned off, `tools/site.test.ts` runs the front page's commands through it, and it is the fallback
// for any world that cannot spawn.
//
// **A bounded slice, and the bound is stated.** Each case costs two subprocesses; `deno task
// corpus:routes` is the whole 821 and takes minutes.

import { buildApp } from "../../platform/build.ts";
import { type Bounded, bounded, DEFAULT_SECONDS, hangReport } from "../../../harness/bounded.ts";
import { CORPUS } from "../../sh/test/corpus.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

/** How many corpus scripts the gate runs. The rest is `deno task corpus:routes`. */
const SAMPLE = 40;

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const tmp = await Deno.makeTempDir({ prefix: "wac-routes-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tmp, { recursive: true });
  } catch {
    // Already gone.
  }
});

const called = `${tmp}/boxsh`;
const spawned = `${tmp}/wacsh`;
await buildApp("packages/box/example/boxsh.wac", called, { read: true, write: true, env: true });
await buildApp("packages/box/src/bin/sh.wac", spawned, { read: true, write: true, env: true });

function run(cmd: string, script: string, cwd: string): Bounded {
  return bounded(DEFAULT_SECONDS, cmd, ["-c", script], {
    cwd,
    env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: cwd },
  });
}

/** One script's two answers, each in a directory of its own so neither sees the other's files. */
function both(script: string, n: number): { called: Bounded; spawned: Bounded } {
  const a = `${tmp}/a${n}`, b = `${tmp}/b${n}`;
  Deno.mkdirSync(a, { recursive: true });
  Deno.mkdirSync(b, { recursive: true });
  const answers = { called: run(called, script, a), spawned: run(spawned, script, b) };
  Deno.removeSync(a, { recursive: true });
  Deno.removeSync(b, { recursive: true });
  return answers;
}

Deno.test("the two routes are one program: the same applets answer the same either way", () => {
  const differ: string[] = [];
  for (let i = 0; i < SAMPLE && i < CORPUS.length; i++) {
    const script = CORPUS[i];
    const { called: a, spawned: b } = both(script, i);
    const stuck = hangReport(script, [{ name: "called", run: a }, { name: "spawned", run: b }]);
    if (stuck !== null) { differ.push(stuck); continue; }
    if (a.out !== b.out || a.err !== b.err || a.code !== b.code) {
      differ.push(
        `${JSON.stringify(script)}\n  called  ${JSON.stringify(a.out + a.err)} (${a.code})` +
          `\n  spawned ${JSON.stringify(b.out + b.err)} (${b.code})`,
      );
    }
  }
  assertEquals(differ.length, 0, `\n${differ.slice(0, 5).join("\n")}`);
});

Deno.test("...and they are genuinely two routes, which is what makes the agreement mean anything", () => {
  // **The one case they are known to answer differently**, and the shape of the difference is the
  // point. A called applet's output is captured in this program's memory and capped, so past the cap
  // there is nothing it can do; a spawned one's queue drains as the next stage reads it.
  //
  // What changed is *how* the called route says so. It used to answer 8323568 where bash answers
  // 10888896 — a wrong number, silently, from a command that reported success — because `write`
  // answering false at the cap is indistinguishable, from inside the applet, from the reader going
  // away. `Captured.truncated` carries the difference now and `boxRun` refuses with a sentence.
  //
  // Asserted rather than avoided, because the way the test above goes vacuous is `boxsh` quietly
  // starting to spawn, at which point the two binaries are the same program.
  const { called: a, spawned: b } = both("seq 1 1500000", -1);
  const theirs = new Deno.Command("bash", { args: ["-c", "seq 1 1500000"], stdout: "piped" })
    .outputSync();
  const gnu = new TextDecoder().decode(theirs.stdout);

  assertEquals(b.out.length, gnu.length, "the spawned route should match bash byte for byte");
  assertEquals(
    a.err.includes("output exceeded"),
    true,
    `the called route did not say it could not hold the output: ${JSON.stringify(a.err.slice(0, 200))}`,
  );
  assertEquals(a.code !== 0, true, "a refusal that reports success is the thing this replaced");
  // **And nothing on standard output**, which is the whole of the fix: a short answer that looks
  // complete is worse than no answer at all.
  assertEquals(a.out, "", `the called route still produced output it could not vouch for: ${a.out.length}`);
});
