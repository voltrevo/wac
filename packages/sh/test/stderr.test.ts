// What this shell says on standard error, against what bash says.
//
// **Nothing compared it until 2026-08-09.** `differential.test.ts` runs every corpus script through
// both shells and asserts stdout and the exit status, with `stderr: "null"` — so the messages were
// never captured. `packages/box`'s half captures them and uses them only to decorate a failure. A
// repository that measures GNU's wording tool by tool (`cannotOpen` carries five sentences, each read
// off the tool it belongs to) had no differential over the thing those sentences are.
//
// The first sweep found 58 of 821 differing, and **forty were one fact**: a builtin's diagnostic did
// not name the shell. `sh: ` on a builtin's errors — and not on its `usage:` lines, which is bash's
// own distinction — closed those.
//
// ## What this file is, and what the task is
//
// `deno task corpus:stderr` is the whole 821 and takes minutes; it fails on a difference that is not
// pinned *and* on a pin that has gone stale. This is the fast half: the 27 that still differ, checked
// to still differ **in the recorded way**.
//
// Both directions matter. A new divergence in one of these is a regression. A pin that starts
// agreeing is somebody's fix, and the row has to go — a table of expected failures that quietly
// accumulates correct entries is the shape that stops anyone reading it.

import { KNOWN, sameName } from "../../../tools/corpusStderr.ts";
import { buildApp } from "../../platform/build.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const tmp = await Deno.makeTempDir({ prefix: "wac-stderr-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tmp, { recursive: true });
  } catch {
    // Already gone.
  }
});

const shell = `${tmp}/wacsh`;
await buildApp("packages/box/src/bin/sh.wac", shell, { read: true, write: true, env: true });

/**
 * What `cmd -c script` says on standard error, or a failure if the bound fired.
 *
 * **A fired bound is not an empty message**, and this returned one for both. `timeout` answers 124
 * when it had to kill, and a killed shell has written nothing — so a gate on a loaded machine
 * reported `got: "" want: "sh: [: b: binary operator expected"`, which reads as a diagnostic this
 * shell has stopped printing rather than as a shell that never got to print it. Every other place in
 * this repository that bounds a subprocess this way carries `hung: r.code === 124`; this was the one
 * that did not, and it cost a red gate to notice.
 *
 * Twenty seconds is not a deadline, it is a bound on wedging: `harness/bounded.ts` makes the same
 * argument at greater length, and the load average goes in the message because it is the difference
 * between "this machine was busy" and "this program hangs".
 */
/** The bound, in seconds, named once so the message below cannot state a different one. */
const BOUND_S = "20";

function stderrOf(cmd: string, script: string, cwd: string): string {
  const r = new Deno.Command("timeout", {
    args: [BOUND_S, cmd, "-c", script],
    cwd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: cwd },
    clearEnv: true,
  }).outputSync();
  if (r.code === 124) {
    const load = Deno.loadavg().map((n) => n.toFixed(2)).join(" ");
    throw new Error(
      `${cmd} -c ${JSON.stringify(script)} was killed by its ${BOUND_S}s bound rather than answering ` +
        `(load ${load}). That is a hang or a machine under load, and either way it is not the empty ` +
        `diagnostic this used to report it as.`,
    );
  }
  return new TextDecoder().decode(r.stderr).trimEnd();
}

Deno.test("the differences from bash's diagnostics are the ones written down", () => {
  // A table that matched nothing would leave this green and the messages unmeasured.
  assertEquals(KNOWN.length > 10, true, `only ${KNOWN.length} rows — has the table been emptied?`);

  const wrong: string[] = [];
  for (const [i, row] of KNOWN.entries()) {
    const a = `${tmp}/a${i}`, b = `${tmp}/b${i}`;
    Deno.mkdirSync(a, { recursive: true });
    Deno.mkdirSync(b, { recursive: true });
    const theirs = sameName(stderrOf("bash", row.script, a));
    const ours = stderrOf(shell, row.script, b);
    Deno.removeSync(a, { recursive: true });
    Deno.removeSync(b, { recursive: true });

    if (theirs === ours) {
      wrong.push(
        `${JSON.stringify(row.script)}\n  pinned as different and now agrees — delete the row from ` +
          `tools/corpusStderr.ts`,
      );
      continue;
    }
    if (theirs !== row.bash.trimEnd() || ours !== row.ours.trimEnd()) {
      wrong.push(
        `${JSON.stringify(row.script)}\n  pinned bash: ${JSON.stringify(row.bash)}` +
          `\n  actual bash: ${JSON.stringify(theirs)}` +
          `\n  pinned ours: ${JSON.stringify(row.ours)}` +
          `\n  actual ours: ${JSON.stringify(ours)}`,
      );
    }
  }
  assertEquals(wrong.length, 0, `\n${wrong.slice(0, 6).join("\n")}`);
});

Deno.test("a builtin's diagnostic names the shell, and its usage line does not", () => {
  // The rule the sweep found, asked directly so that it reads as a rule rather than as forty rows.
  // Both halves measured on bash: `[ a b c ]` is prefixed, `printf` with no arguments is not.
  const dir = `${tmp}/rule`;
  Deno.mkdirSync(dir, { recursive: true });

  assertEquals(stderrOf(shell, "[ a b c ]", dir), "sh: [: b: binary operator expected");
  assertEquals(sameName(stderrOf("bash", "[ a b c ]", dir)), "sh: [: b: binary operator expected");

  const usage = stderrOf(shell, "printf", dir);
  assertEquals(usage.startsWith("printf: usage:"), true, `a usage line was prefixed: ${usage}`);
  assertEquals(
    sameName(stderrOf("bash", "printf", dir)).startsWith("printf: usage:"),
    true,
    "bash prefixes its usage line after all — the rule below it is wrong",
  );

  // And a *program*'s diagnostic is its own: the shell is not the one speaking, so it does not sign
  // it. `cat` is an applet here and coreutils' `cat` says the same thing.
  const cat = stderrOf(shell, "cat /nosuchfile", dir);
  assertEquals(cat, "cat: /nosuchfile: No such file or directory", cat);
});
