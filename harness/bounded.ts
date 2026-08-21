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
import { ATTEMPTS, ranBusy, WAIT_MS } from "./etxtbsy.ts";

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
  /** This run is a second attempt: the first hit a shorter bound and was asked again. */
  retried?: boolean;
  /**
   * The target could not be executed because something held it open for writing — ETXTBSY.
   *
   * A separate fact from every other field, for the reason `hung` is: there is no answer here. The
   * program did not print nothing, it never ran, and a caller comparing `out` against an expectation
   * is comparing against a condition rather than a result.
   */
  busy?: boolean;
};

/**
 * Run `cmd` under a bound, and say plainly whether the bound fired.
 *
 * Synchronous for the callers that compare in a loop: these tests hold two runs of one script against
 * each other, and that reads better in a loop than in a promise. `outputSync` is what they all used
 * already.
 *
 * **`boundedAsync` below is the same call for a caller with many to get through**, which the sentence
 * here used to rule out by saying every caller was synchronous.
 */
export function bounded(
  seconds: number,
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; stdin?: "null" | "inherit" } = {},
): Bounded {
  const d = new TextDecoder();
  // **Retried on ETXTBSY, which `harness/spawnRetry.ts` cannot see from here.** That wrapper catches a
  // *thrown* "Text file busy" from Deno's own spawn; this does not spawn the target, it spawns
  // `timeout` and hands the target over as an argument. So Deno's spawn succeeds and it is `timeout`
  // whose `execve` fails, on stderr, with a status nobody chose. Nothing throws and the retry never
  // turns over — which turned a gate red in `packages/box/test/sealing.test.ts` reading as a program
  // that printed nothing. `harness/boundedBusy.test.ts` holds the binary open on purpose so both
  // halves of this are checked rather than waited for.
  for (let attempt = 1;; attempt++) {
    const r = new Deno.Command("timeout", {
      args: [String(seconds), cmd, ...args],
      cwd: opts.cwd,
      stdin: opts.stdin ?? "null",
      stdout: "piped",
      stderr: "piped",
      ...(opts.env === undefined ? {} : { env: opts.env, clearEnv: true }),
    }).outputSync();
    const err = d.decode(r.stderr);
    const busy = ranBusy(r.code, err);
    if (busy && attempt < ATTEMPTS) {
      pauseSync(WAIT_MS);
      continue;
    }
    return {
      code: r.code,
      out: d.decode(r.stdout),
      err,
      hung: r.code === 124,
      seconds,
      ...(busy ? { busy: true } : {}),
    };
  }
}

/** Sleep without awaiting, because the synchronous callers cannot. Same device as `spawnRetry`. */
function pauseSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run under a bound, and if the bound fires **ask again with three times as long** — once.
 *
 * A fixed wall-clock bound cannot tell a hang from starvation. `packages/box/test/wac/corpus_test.wac`
 * met that and its comment is the argument: at load 15, inside a suite that is itself parallel,
 * `grep -c` over five lines hit a twenty-second bound, and the gate reported "ours did not finish"
 * about a script that takes 40ms alone. That is starvation wearing a defect's clothes, and it cost
 * a push.
 *
 * A second attempt separates them, because starvation is a property of the moment and a hang is
 * not. **Once, not until green**: if it hangs again the report carries both attempts, and if it
 * finishes its answer is compared like any other — a slow run still has to agree.
 *
 * Not folded into `bounded` itself. Two of its callers — `stdin_open` and `sealed` — are tests
 * whose *subject* is a hang, and for them a second attempt is not a better measurement, it is the
 * same measurement twice at three times the cost.
 *
 * The retry is not "alone" in the sense `corpus.test.ts` means: this runs inside the same parallel
 * suite and the same directory. What it has is a longer bound and a later moment, which is what a
 * load spike needs.
 */
export function boundedAgain(
  seconds: number,
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; stdin?: "null" | "inherit" } = {},
): Bounded {
  const first = bounded(seconds, cmd, args, opts);
  if (!first.hung) return first;
  const longer = seconds * 3;
  console.error(
    `bounded: ${cmd} did not finish in ${seconds}s — asking again at ${longer}s (${loadNow()})`,
  );
  return { ...bounded(longer, cmd, args, opts), retried: true };
}

/** The same, for a program that must be fed. */
export async function boundedInputAgain(
  seconds: number,
  cmd: string,
  args: string[],
  stdin: string | Uint8Array,
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<Bounded> {
  const first = await boundedInput(seconds, cmd, args, stdin, opts);
  if (!first.hung) return first;
  const longer = seconds * 3;
  console.error(
    `bounded: ${cmd} did not finish in ${seconds}s — asking again at ${longer}s (${loadNow()})`,
  );
  return { ...await boundedInput(longer, cmd, args, stdin, opts), retried: true };
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
  // Whether it was asked twice belongs in the sentence: "did not finish in 60s" and "did not
  // finish in 60s and did not finish in 180s when asked again" are different claims, and only the
  // second one is evidence about the program rather than about the machine.
  const asked = stuck.some((r) => r.run.retried)
    ? " It was asked again after a shorter bound fired, so this is a second failure to "
      + "finish, not a first."
    : "";
  return `${what}: ${names} did not finish in ${seconds}s — a bound fired, so there is no answer ` +
    `here to compare.${asked} See issue 0128 before treating this as a difference between the ` +
    `hosts. ${loadNow()}`;
}

/**
 * `bounded`, without holding the thread — for a caller running several at once.
 *
 * `outputSync` is the right shape for one comparison and the wrong one for forty: forty scripts down
 * two routes each, one spawn at a time, was ten seconds of `packages/box/test/routes.test.ts` on an
 * otherwise idle machine. Nothing about the comparison needed to be serial — each script gets a
 * directory of its own by construction.
 *
 * Not `bounded` with a flag. A caller that awaits nothing should not have to, which is the argument
 * `boundedInput` already records for the same split.
 */
export async function boundedAsync(
  seconds: number,
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; stdin?: "null" | "inherit" } = {},
): Promise<Bounded> {
  const d = new TextDecoder();
  // The same ETXTBSY retry as the synchronous twin, and awaiting rather than blocking — see there for
  // why the wrapper in `spawnRetry.ts` cannot reach this.
  for (let attempt = 1;; attempt++) {
    const r = await new Deno.Command("timeout", {
      args: [String(seconds), cmd, ...args],
      cwd: opts.cwd,
      stdin: opts.stdin ?? "null",
      stdout: "piped",
      stderr: "piped",
      ...(opts.env === undefined ? {} : { env: opts.env, clearEnv: true }),
    }).output();
    const err = d.decode(r.stderr);
    const busy = ranBusy(r.code, err);
    if (busy && attempt < ATTEMPTS) {
      await new Promise((res) => setTimeout(res, WAIT_MS));
      continue;
    }
    return {
      code: r.code,
      out: d.decode(r.stdout),
      err,
      hung: r.code === 124,
      seconds,
      ...(busy ? { busy: true } : {}),
    };
  }
}

/**
 * `boundedAgain`, without holding the thread.
 *
 * **The retry matters more here than in the sync twin**, not less: a caller reaches for this because
 * it is running several at once, which is the load a fixed bound cannot tell from a hang. Whoever
 * makes a file concurrent should take the second attempt with it.
 */
export async function boundedAgainAsync(
  seconds: number,
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; stdin?: "null" | "inherit" } = {},
): Promise<Bounded> {
  const first = await boundedAsync(seconds, cmd, args, opts);
  if (!first.hung) return first;
  const longer = seconds * 3;
  console.error(
    `bounded: ${cmd} did not finish in ${seconds}s — asking again at ${longer}s (${loadNow()})`,
  );
  return { ...await boundedAsync(longer, cmd, args, opts), retried: true };
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
 * behind `--allow-sys`; `tools/runTests.wac` grants neither. It does grant `--allow-run`, so `cat` it
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
