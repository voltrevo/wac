// The one `/bin` claim that needs a real process: the **spawned** route.
//
// Everything else about `/bin` — that it lists exactly this build's programs, that a program in it is a
// file with a mode and a size, that a path into it runs the program however it is spelled, that a build
// with no programs has no `/bin` at all, that it is read-only — is `test/wac/bin_test.wac`, in process
// and without building anything.
//
// This is what cannot go there. `cmd &`, a streaming pipeline and a `/bin` path all take the spawned
// stage, which `bin/sealedsh.wac` turns on and which works by re-entering the program's own `main` with
// the applet's name first. Give a *test file* such a `main` and `yes | /bin/head -2` never returns: the
// stage spawns the test binary, which is not a shell that will stop. `issues/system/0193` lists this
// among the things that stay out of pure wac, under "one build-and-spawn smoke test per area".
//
// **Three routes reach a program and only one of them consulted `/bin`.** `dispatched` rewrote the path
// before looking at any bytes; the streaming pipeline and `&` both went to `spawnStage`, which read the
// file — and what is in `/bin` is a *sentence* about the program, so the same command answered "not a wac
// worker bundle" behind an `&` and worked without one. Now one function decides what a path into `/bin`
// means and every route asks it.
// test-lane: heavy — 1s: builds a sealed shell and spawns eight sessions

import { buildApp } from "../../platform/build.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const built = await Deno.makeTempFile({ prefix: "wac-bin-" });
await buildApp("packages/box/src/bin/sealedsh.wac", built, {});
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(built);
  } catch {
    // Already gone.
  }
});

type Run = { code: number; out: string; err: string };

async function sh(script: string): Promise<Run> {
  const r = await new Deno.Command(built, {
    args: ["-c", script],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return { code: r.code, out: d.decode(r.stdout), err: d.decode(r.stderr) };
}

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

Deno.test("a program in /bin is the same program down every route a command can take", async () => {
  const bg = await sh("echo a b c > w; /bin/wc -w w & wait");
  assertEquals(bg.out, "3 w\n", `background: ${bg.err}`);
  const piped = await sh("seq 1 5 | /bin/wc -l | /bin/cat");
  assertEquals(piped.out, "5\n", `pipeline: ${piped.err}`);

  // The two path failures in a pipeline, because they were the other half of the same bug: a stage that
  // is a directory was spawned as this bundle with its own path for an argv[0] and came back as a name
  // nothing knows. Both answers are bash's, checked against it: the *last* stage decides the status, so a
  // failing stage in front of a working one leaves the pipeline at 0 while still complaining — which is
  // why the first of these asserts a zero it would be easy to call a bug.
  const first = await sh("/bin | cat; echo status=$?");
  assertEquals(first.err.includes("Is a directory"), true, first.err);
  assertEquals(first.out, "status=0\n", first.out);
  const last = await sh("cat /proc/self/comm | /bin; echo status=$?");
  assertEquals(last.err.includes("Is a directory"), true, last.err);
  assertEquals(last.out, "status=126\n", last.out);
  const gone = await sh("cat /proc/self/comm | /bin/nosuch; echo status=$?");
  assertEquals(gone.err.includes("No such file or directory"), true, gone.err);
  assertEquals(gone.out, "status=127\n", gone.out);

  // **And a `/bin` path streams**, which is the same statement about a fourth route: `canStream` refused
  // every word with a slash in it, so this stage's pipeline ran sequentially and buffered `yes` until the
  // array grew past what wasm will allocate — about eleven seconds, then the shell died. Issue 0127 is
  // the general case; this is the spelling that had no reason to be in it.
  const streamed = await sh("yes | /bin/head -2");
  assertEquals(streamed.out, "y\ny\n", `${streamed.out} / ${streamed.err}`);
});
