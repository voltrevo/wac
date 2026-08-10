// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";
import { boundedInput, DEFAULT_SECONDS } from "../../../harness/bounded.ts";
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
 * Run a script with standard input **open and never written to**, which is what a terminal is.
 *
 * `timeout` rather than a `setTimeout` and a kill: a hang here must fail the test rather than wedge the
 * suite, and the system's own bound closes the pipes as well as stopping the process. 124 is `timeout`
 * killing it, which is what every bug this file guards looks like.
 */
const open = async (script: string) => {
  // **This test's subject is the hang**, so `hung` is the answer it wants rather than an accident of
  // the exit status — see `harness/bounded.ts`. The bound is generous for the reason given there: it
  // exists to turn an infinite wait into a readable failure, not to time the machine.
  const r = await boundedInput(DEFAULT_SECONDS, shell, ["-c", script], "");
  return { out: r.out, code: r.code, hung: r.hung };
};

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

/**
 * A pipeline whose first stage produces **nothing**, with standard input still open. wac-mono 0113.
 *
 * `: | cat` never returned, and neither did `true | cat`, `: | wc -c`, or
 * `echo a | while read l; do echo [$l]; done`. `echo x | cat` was fine, which is why nothing saw it:
 * every case anyone had written has a first stage that produces bytes.
 *
 * The cause was one condition in `Shell.ensureStdin`. "The buffer is spent" and "the shell was never
 * given an input" look identical to `stdinPos >= stdinBytes.len()` — it is true of an *empty* held
 * input — so a command handed nothing by a pipe went and read the real standard input. The flag that
 * says "these bytes are the shell's and they are all there is" already existed; that line decided
 * without asking it.
 *
 * `cat < /dev/null` is here too, and it is the case that found the cause: no pipeline in sight and it
 * hung the same way, which is what said the fault was in the *input* rather than in the plumbing
 * between stages.
 */
Deno.test("a stage after one that produced nothing does not go looking for a terminal", async () => {
  const cases: [string, string][] = [
    [": | cat", ""],
    ["true | cat", ""],
    ["false | cat", ""],
    [": | wc -c", "0\n"],
    ["g() { :; }; g | cat", ""],
    [": | cat | cat", ""],
    ["echo a | while read l; do echo [$l]; done", "[a]\n"],
    [": | while read l; do echo no; done; echo end", "end\n"],
    ["printf '' | wc -c", "0\n"],
    ["echo hi | head -0 | wc -c", "0\n"],
    ["cat </dev/null; echo done", "done\n"],
    ["read x </dev/null; echo [$x]", "[]\n"],
    // …and the ones that always worked, so a fix that broke them would say so here.
    ["echo x | cat", "x\n"],
    ["seq 1 3 | cat", "1\n2\n3\n"],
    ["{ echo a; } | cat", "a\n"],
  ];
  for (const [script, want] of cases) {
    const got = await open(script);
    assertEquals(got.code, 0, `${script} did not finish: ${JSON.stringify(got.out)}`);
    assertEquals(got.out, want, script);
  }
});
