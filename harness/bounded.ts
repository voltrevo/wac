// Running a program under a bound, and telling a bound that fired from an answer.
//
// Nine tests in this repository start a program with `timeout N` and compare what came back. All of
// them read the exit status as the program's own — and `timeout` answers **124** when it fires, which
// is a number the program never chose. So a run that did not finish was reported as a run that
// disagreed:
//
//     "seq 1 5 | head -n -0"
//       deno   "1\n2\n3\n4\n5\n" (0)
//       native "" (124)
//
// That reads as a conformance failure between two hosts. It is a loaded machine and a ten-second
// bound (issue 0128), and the difference matters because the two have opposite fixes.
//
// `harness/deadline.ts` already says the doctrine this follows: "The point is a message, not a limit
// … the job is converting *infinite* into *finite*, not policing latency." A bound that fires is
// information about the bound.
//
// **And the bounds were policing latency.** Ten seconds for a script that takes under one, on a
// five-core machine where several agents run suites at once: `/proc/loadavg` read 9.5 while this was
// being written, and the two-host tests run their halves *synchronously* inside a `--parallel` suite.
// So `DEFAULT_SECONDS` is generous on purpose. A bound exists to turn a hang into a failure somebody
// can read, and every second it spends waiting for a loaded machine costs nothing when nothing is
// hanging.

/**
 * How long a run gets before the bound is called a hang.
 *
 * One minute rather than ten seconds, for the reason in the header. Nothing here takes a minute when
 * the machine is idle; what takes a minute is a machine at three times its core count.
 */
export const DEFAULT_SECONDS = 60;

/** What a bounded run answers: the program's own result, or the fact that it never gave one. */
export type Bounded = {
  code: number;
  out: string;
  err: string;
  /** `timeout` fired: there is no answer here, and `code` is its 124 rather than the program's. */
  hung: boolean;
  /** The bound that fired, in seconds, for a message that can say how long it waited. */
  seconds: number;
};

/**
 * Run `cmd` under a bound, and say plainly whether the bound fired.
 *
 * Synchronous because every caller is: these tests compare two runs of the same script and the
 * comparison reads better in a loop than in a promise. `outputSync` is what they all used already.
 */
export function bounded(
  seconds: number,
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; stdin?: "null" | "inherit" } = {},
): Bounded {
  const r = new Deno.Command("timeout", {
    args: [String(seconds), cmd, ...args],
    cwd: opts.cwd,
    stdin: opts.stdin ?? "null",
    stdout: "piped",
    stderr: "piped",
    ...(opts.env === undefined ? {} : { env: opts.env, clearEnv: true }),
  }).outputSync();
  const d = new TextDecoder();
  return {
    code: r.code,
    out: d.decode(r.stdout),
    err: d.decode(r.stderr),
    hung: r.code === 124,
    seconds,
  };
}

/**
 * The sentence to fail with when a bounded run did not finish, or `null` when both did.
 *
 * Takes both sides because the useful thing to say is *which* of them hung — a differential where
 * one host finished and the other did not is a different report from one where neither did.
 */
export function hangReport(
  what: string,
  runs: Array<{ name: string; run: Bounded }>,
): string | null {
  const stuck = runs.filter((r) => r.run.hung);
  if (stuck.length === 0) return null;
  const names = stuck.map((r) => r.name).join(" and ");
  const seconds = stuck[0].run.seconds;
  return `${what}: ${names} did not finish in ${seconds}s — a bound fired, so there is no answer ` +
    `here to compare. See issue 0128 before treating this as a difference between the hosts.`;
}

/**
 * The same, for a program that must be *fed* — which needs a spawn rather than `outputSync`.
 *
 * Separate rather than one function with an optional input, because the sync and async shapes are
 * genuinely different calls and a caller that awaits nothing should not have to.
 */
export async function boundedInput(
  seconds: number,
  cmd: string,
  args: string[],
  stdin: string | Uint8Array,
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<Bounded> {
  const child = new Deno.Command("timeout", {
    args: [String(seconds), cmd, ...args],
    cwd: opts.cwd,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    ...(opts.env === undefined ? {} : { env: opts.env, clearEnv: true }),
  }).spawn();
  const w = child.stdin.getWriter();
  await w.write(typeof stdin === "string" ? new TextEncoder().encode(stdin) : stdin);
  await w.close();
  const r = await child.output();
  const d = new TextDecoder();
  return {
    code: r.code,
    out: d.decode(r.stdout),
    err: d.decode(r.stderr),
    hung: r.code === 124,
    seconds,
  };
}

/**
 * The load average as a phrase for a failure message, or `"load unknown"`.
 *
 * **Read through a subprocess, which looks absurd for reading a file and is the only thing that
 * works.** Deno gates `/proc` behind `--allow-all` rather than `--allow-read`, and `Deno.loadavg()`
 * behind `--allow-sys`; `tools/runTests.ts` grants neither. It does grant `--allow-run`, so `cat` it
 * is.
 *
 * Here rather than in a test because it was written twice and reached for a third time incorrectly.
 * `packages/tor`'s two live tests each carried a byte-identical copy, and
 * `packages/sh/test/stderr.test.ts` used `Deno.loadavg()` — which **threw at exactly the moment it
 * meant to explain itself**. Its 20s bound fired on a loaded machine, and the report came back as
 * `NotCapable: Requires sys access to "loadavg"`, naming neither the bound nor the load. A red gate,
 * from the line whose only job was making that gate legible.
 *
 * Never throws: a diagnostic that can fail is worse than one that says less, since it replaces the
 * failure being described with itself.
 */
export function loadNow(): string {
  try {
    const r = new Deno.Command("cat", { args: ["/proc/loadavg"], stdout: "piped", stderr: "null" })
      .outputSync();
    const text = new TextDecoder().decode(r.stdout).trim();
    return text === "" ? "load unknown" : `load ${text.split(" ").slice(0, 3).join(" ")}`;
  } catch {
    return "load unknown";
  }
}
