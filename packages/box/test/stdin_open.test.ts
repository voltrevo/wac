// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";
import { buildApp } from "../../platform/build.ts";
// A shell whose standard input is **still open** — the shape a terminal has, and the one no other
// harness in this repo gives a shell.
//
// wac-mono 0110, and it lived in `packages/sh/test/spawn.test.ts` until that package's own programs were
// deleted (0103). The cases need a first stage that *ignores its input* and a later stage that stops
// early, and `seq`, `cat` and `head` are the shortest way to write both — they are applets now, so this
// is where the test can run. The bug it guards is in `packages/sh`'s `exec.wac` either way: this shell
// is that shell with commands wired in.

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const shell = await Deno.makeTempFile({ prefix: "box-stdin-open-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(shell);
  } catch {
    // Already gone, or never built.
  }
});
await buildApp("packages/box/src/bin/sh.wac", shell, { read: true, write: true, env: true });

/**
 * A pipeline whose first stage is spawned, with the shell's own standard input **still open**.
 *
 * wac-mono 0110. `wacsh -c 'seq 1 3 | cat'` typed at a terminal never returned: a pipeline of two or
 * more stages had the shell forward its own input to the first stage, and forwarding means *reading to
 * the end* — which at a terminal never comes. `seq` does not read standard input at all, so nothing was
 * waiting for the shell's bytes; the shell was waiting for a person to stop typing.
 *
 * **Nothing caught it because every test in this repo runs a shell with `stdin: "null"`**, and an input
 * that is already at end of file makes the read return at once. So the harness here is the whole point:
 * `stdin: "piped"`, and never written to, is a standard input that stays open — the shape a terminal
 * has and no other test in this repo has ever given a shell.
 *
 * The bound is `timeout(1)` rather than a `setTimeout` and a kill: a hang here must fail the test rather
 * than wedge the suite, and the system's own bound closes the pipes as well as stopping the process.
 */
Deno.test("a pipeline runs when the shell's own standard input is still open", async () => {
  const open = async (script: string) => {
    const child = new Deno.Command("timeout", {
      args: ["10", shell, "-c", script],
      stdin: "piped",       // …and never written to, and never closed: this is a terminal's shape
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const r = await child.output();
    // 124 is `timeout` killing it, which is what the bug looked like.
    return { out: new TextDecoder().decode(r.stdout), code: r.code };
  };

  const piped = await open("seq 1 3 | cat");
  assertEquals(piped.code, 0, "a two-stage pipeline finished");
  assertEquals(piped.out, "1\n2\n3\n");

  // Three stages, and one that stops early: `head` ending `seq` is the case that makes the shell tear
  // the pipeline down rather than wait for it.
  const three = await open("seq 1 100 | cat | head -2");
  assertEquals(three.code, 0, "a three-stage pipeline finished");
  assertEquals(three.out, "1\n2\n");

  // A single stage still inherits the descriptor, which is what makes `cat` at a prompt work at all —
  // and with nothing written and no end, it has to be the *shell* that ends rather than the read.
  const lone = await open("echo hi");
  assertEquals(lone.code, 0);
  assertEquals(lone.out, "hi\n");
});
