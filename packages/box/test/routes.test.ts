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
// turned off, `site/tools/site.test.ts` runs the front page's commands through it, and it is the fallback
// for any world that cannot spawn.
//
// **A bounded slice, and the bound is stated.** Each case costs two subprocesses; `deno task
// corpus:routes` is the whole 821 and takes minutes.

import { type AppRunner, appRunner, runBounded } from "../../../harness/appRun.ts";
import { type Bounded, boundedAgainAsync, DEFAULT_SECONDS, hangReport } from "../../../harness/bounded.ts";
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

/**
 * **Both routes in workers, not processes.** `appRunner` is the launcher half of the same built
 * program — same capability implementations, same grants — and the process boundary is not what this
 * file is about: the subject is which route the shell takes *inside* itself, `pushChild`/`popChild`
 * against `spawn`, and both of those happen within one instance either way. Eighty process starts at
 * about 110ms each was most of the seven seconds this test cost; a worker run is about a
 * millisecond. `packages/box/test/box.test.ts` made the same move for the same reason.
 *
 * The bound comes with it, through `runBounded`: a worker run has no timeout of its own, and a bound
 * that fired is a report rather than an answer (issue 0128). It does not retry where
 * `boundedAgainAsync` did — a retry existed because forty scripts' worth of subprocesses starved each
 * other, which is the load this removes.
 */
const calledRun = await appRunner("packages/box/example/boxsh.wac", { read: true, write: true, env: true });
const spawnedRun = await appRunner("packages/box/src/bin/sh.wac", { read: true, write: true, env: true });

async function run(which: AppRunner, script: string, cwd: string): Promise<Bounded> {
  const r = await runBounded(which, ["-c", script], {
    cwd,
    env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: cwd },
  }, DEFAULT_SECONDS, JSON.stringify(script));
  return { code: r.code, out: r.out, err: r.err, hung: false, seconds: DEFAULT_SECONDS };
}

/** One script's two answers, each in a directory of its own so neither sees the other's files. */
async function both(script: string, n: number): Promise<{ called: Bounded; spawned: Bounded }> {
  const a = `${tmp}/a${n}`, b = `${tmp}/b${n}`;
  await Deno.mkdir(a, { recursive: true });
  await Deno.mkdir(b, { recursive: true });
  // The two routes at once: separate directories, separate processes, and the whole claim of this file
  // is that neither can tell. A script that could tell would be a finding rather than a flake.
  const [answerCalled, answerSpawned] = await Promise.all([
    run(calledRun, script, a),
    run(spawnedRun, script, b),
  ]);
  await Deno.remove(a, { recursive: true });
  await Deno.remove(b, { recursive: true });
  return { called: answerCalled, spawned: answerSpawned };
}

/**
 * How many scripts are in flight, each of which is two **worker runs**.
 *
 * It said "two processes" until 2026-08-19, and that was the whole cost: forty scripts serially at two
 * spawns each was ten seconds, and running two at a time — four subprocesses, the share of a five-core
 * box this file could take beside three other Deno workers — brought it to about three. Both routes are
 * `appRunner` now, so a run is about a millisecond and this number no longer decides anything: two is
 * kept because there is no reason to change it, not because four subprocesses is the limit.
 *
 * The retry went with the processes. `boundedAgainAsync` asked again because forty scripts' worth of
 * subprocesses starved each other, and a starved run reads as a hang (issue 0128) — there is no such
 * load now, and `runBounded` reports a bound that fires rather than retrying it.
 */
const AT_ONCE = 2;

Deno.test("the two routes are one program: the same applets answer the same either way", async () => {
  const differ: string[] = [];
  const queue = CORPUS.slice(0, SAMPLE).map((script, i) => ({ script, i }));
  await Promise.all(Array.from({ length: AT_ONCE }, async () => {
    for (;;) {
      const next = queue.shift();
      if (next === undefined) return;
      const { script, i } = next;
      const { called: a, spawned: b } = await both(script, i);
      const stuck = hangReport(script, [{ name: "called", run: a }, { name: "spawned", run: b }]);
      if (stuck !== null) { differ.push(stuck); continue; }
      if (a.out !== b.out || a.err !== b.err || a.code !== b.code) {
        differ.push(
          `${JSON.stringify(script)}\n  called  ${JSON.stringify(a.out + a.err)} (${a.code})` +
            `\n  spawned ${JSON.stringify(b.out + b.err)} (${b.code})`,
        );
      }
    }
  }));
  assertEquals(differ.length, 0, `\n${differ.slice(0, 5).join("\n")}`);
});

Deno.test("...and they are genuinely two routes, which is what makes the agreement mean anything", async () => {
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
  const { called: a, spawned: b } = await both("seq 1 1500000", -1);
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
