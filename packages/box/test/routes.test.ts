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

type Run = { code: number; out: string; err: string };

function run(cmd: string, script: string, cwd: string): Run {
  const r = new Deno.Command("timeout", {
    args: ["20", cmd, "-c", script],
    cwd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: cwd },
    clearEnv: true,
  }).outputSync();
  const d = new TextDecoder();
  return { code: r.code, out: d.decode(r.stdout), err: d.decode(r.stderr) };
}

/** One script's two answers, each in a directory of its own so neither sees the other's files. */
function both(script: string, n: number): { called: Run; spawned: Run } {
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
  // **The one case they are known to answer differently.** A called applet's output is captured in
  // memory and capped at 8 MiB, so `seq 1 1500000 | wc -c` is short; a spawned one's queue drains as
  // the next stage reads it, and matches bash.
  //
  // Asserted rather than avoided, because the way the test above goes vacuous is `boxsh` quietly
  // starting to spawn — at which point the two binaries are the same program and agreeing on
  // everything proves nothing. This is the line that would fail.
  const { called: a, spawned: b } = both("seq 1 1500000 | wc -c", -1);
  const theirs = new Deno.Command("bash", {
    args: ["-c", "seq 1 1500000 | wc -c"],
    stdout: "piped",
  }).outputSync();
  const gnu = new TextDecoder().decode(theirs.stdout);

  assertEquals(b.out, gnu, "the spawned route should match bash");
  assertEquals(
    a.out !== b.out,
    true,
    `the called route no longer caps, so this comparison is measuring one program twice: ${a.out}`,
  );
  // And it is *short* rather than merely different, which is the shape of the cap.
  assertEquals(
    Number(a.out.trim()) < Number(b.out.trim()),
    true,
    `called ${a.out.trim()} is not shorter than spawned ${b.out.trim()}`,
  );
});
