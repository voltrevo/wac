// `ps`, and design/0001 step 3's own criterion.
//
// The criterion is "`ps` in the ssh demo shows the pipeline you are running and `kill` ends one". This
// covers the first half through a sealed session, which is the harder version of it: nothing here can
// spawn, so every row `ps` prints describes a *function call* inside one program, and the host has no
// idea any of it happened. If the table were the host's this file could not pass at all.
//
// `kill` is a shell builtin now and is compared against bash in `packages/sh/test/differential.test.ts`
// — messages, statuses and all. What is tested *here* is the part that only a sealed session can show:
// that the shell is in its own table, so `kill $$` has something to name and `ps` lists the process
// running the commands rather than only the commands. It was not: `mountSystem` enters the *program*,
// and a shell that no program had entered — `wacsh` — had pid 0 and `$$` answered nothing.
//
// There is no differential against the host's `ps`: the processes are not the host's, so it has no
// opinion to disagree with. The oracle for the *format* underneath is in `packages/fs/test/proc.test.ts`,
// which reads this machine's own `/proc`.

import { buildApp } from "../../platform/build.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const built = await Deno.makeTempFile({ prefix: "wac-box-ps-" });
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

/** Local, because this repo has no third-party dependencies. Structural, because rows are arrays. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

Deno.test("ps shows the session and the command doing the looking", async () => {
  const r = await sh("ps");
  assertEquals(r.code, 0, r.err);
  assertEquals(r.out, [
    "  PID  PPID S CMD",
    "    1     0 R sealedsh -c ps",
    "    2     1 R ps",
    "",
  ].join("\n"));
});

Deno.test("a shell function is a parent, so the rows are a tree rather than a list", async () => {
  // The nesting is what says the parents are real: `g` calls `f` calls `ps`, and each row's PPid is the
  // pid above it. A table that recorded the session as everything's parent would print the same three
  // rows with the same pids and be wrong in the one column that matters.
  const r = await sh("f() { ps; }; g() { f; }; g");
  const rows = r.out.split("\n").slice(1).filter((l) => l.length > 0);
  assertEquals(rows.map((l) => l.slice(0, 12)), [
    "    1     0 ",
    "    2     1 ",
    "    3     2 ",
    "    4     3 ",
  ]);
  assertEquals(rows[3].slice(12), "R ps");
});

Deno.test("a finished command is not in the table", async () => {
  // Sequential stages, so by the time `ps` runs the `echo` before it has exited and been reaped. bash
  // would show both — its stages are concurrent — and the difference is real rather than a rendering
  // choice: nothing here runs two commands at once, and a row for the `echo` would be a lie about that.
  const r = await sh("echo hi | ps");
  // Rows after the session's own, which quotes the whole script and so contains the word `echo`. That
  // first version of this filter matched it and would have passed with `echo` still in the table.
  const rows = r.out.split("\n").slice(2).filter((l) => l.length > 0);
  assertEquals(rows.filter((l) => l.includes("echo")).length, 0, r.out);
  assertEquals(r.out.includes("R ps"), true, r.out);
  // The pids still count it: `echo` was 2, so `ps` is 3. That is the evidence it ran and left.
  assertEquals(r.out.includes("    3     1 R ps"), true, r.out);
});

Deno.test("ps refuses what it has not got rather than ignoring it", async () => {
  const selecting = await sh("ps 1");
  assertEquals(selecting.code, 1);
  assertEquals(selecting.err.includes("not implemented"), true, selecting.err);
  // A short flag goes through `refuseFlags`, whose wording is GNU's rather than ours on purpose — this
  // asserts the repo's own refusal rather than a second spelling of it.
  const flag = await sh("ps -e");
  assertEquals(flag.code, 1);
  assertEquals(flag.err.includes("invalid option -- 'e'"), true, flag.err);
  const long = await sh("ps --help");
  assertEquals(long.err.includes("long options are not implemented"), true, long.err);
});

Deno.test("the shell is in its own table, so `$$` names something `ps` shows", async () => {
  // design/0001 step 3, the half that makes `kill` mean anything: a shell is a process. Before this,
  // every row `ps` printed was a command and the thing running them was not there — which reads as a
  // system where commands appear from nowhere, and left `$$` with no number to answer with.
  const listed = await sh("ps");
  const rows = listed.out.trim().split("\n");
  assertEquals(rows.length >= 2, true, `ps showed no shell: ${listed.out}`);
  // Row 1 is the shell: pid 1, no parent, and its own argv rather than the command it is running.
  const shell = rows[1].trim().split(/\s+/);
  assertEquals(shell[0], "1", `the shell is not pid 1: ${listed.out}`);
  assertEquals(shell[1], "0", `the shell has a parent: ${listed.out}`);

  // And `$$` is that pid — asked through `ps` rather than compared with a constant, so a change to
  // where the shell lands in the table fails here rather than quietly making the two disagree.
  const pid = (await sh("echo $$")).out.trim();
  assertEquals(pid, shell[0], `\`$$\` and ps disagree: ${pid} against ${listed.out}`);

  // The whole point of the number: it can be signalled, and the shell notices.
  const killed = await sh("kill $$; echo not-reached");
  assertEquals(killed.out, "", `something ran after \`kill $$\`: ${killed.out}`);
  assertEquals(killed.code, 143, "a shell ended by SIGTERM should exit 143");

  // A signal to a pid the table does not have is refused rather than silently accepted, which is what
  // stops `kill` reporting success for a process that is not there.
  const nosuch = await sh("kill 4242; echo st=$?");
  assertEquals(nosuch.out.trim(), "st=1", nosuch.out);
  assertEquals(nosuch.err.includes("No such process"), true, nosuch.err);
});
