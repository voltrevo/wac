// `&`, `jobs` and `wait`, against bash — design/0001 step 3's `jobs` and `&`.
//
// **Here rather than in `packages/sh`**, and the reason is the whole point of the split: these scripts
// name `seq`, which that package gave up to `packages/box` (wac-mono 0103), so a background job there
// would spawn nothing and every comparison would pass with two empty outputs. The shell built here is
// `src/bin/sh.wac`, which has all 63 applets and can therefore actually run one.

import { buildApp } from "../../platform/build.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const wacshBinary = await Deno.makeTempFile({ prefix: "wac-jobs-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(wacshBinary);
  } catch {
    // Already gone.
  }
});
await buildApp("packages/box/src/bin/sh.wac", wacshBinary, { read: true, write: true, env: true });

/** Local, because this repo has no third-party dependencies. Structural, because outputs are arrays. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const haveBash = (() => {
  try {
    return new Deno.Command("bash", { args: ["-c", "exit 0"], stdout: "null", stderr: "null" })
      .outputSync().code === 0;
  } catch {
    return false;
  }
})();

/**
 * `&`, `jobs` and `wait`, against bash — design/0001 step 3's `jobs` and `&`.
 *
 * A background job here is a **real child**: `spawnSelf` gives it its own instance, its own grants and,
 * on the host with no JavaScript in it, its own thread. That is the only honest way to have `&` in this
 * shell — there is no in-process concurrency to fake it with, which is why it was refused outright
 * until now rather than run in the foreground and called background.
 *
 * The statuses are the part most likely to be a plausible guess and they are not guessable: bare `wait`
 * is **always 0** even when a job failed, while `wait $!` and `wait %1` answer the job's own status,
 * and both a pid that is not a child and a job number there is no job for are 127.
 *
 * **Only deterministic cases.** Two jobs writing at once interleave in an order neither shell promises,
 * so nothing here starts two and compares their output; `jobs` after a `wait` is compared because
 * bash's rule there is definite — a job is dropped once it has been accounted for.
 */
Deno.test({
  name: "`&`, `jobs` and `wait` do what bash's do",
  ignore: !haveBash,
  fn: () => {
    const cases = [
      // The output arrives, and `wait` is where it arrives.
      "seq 1 3 & wait",
      "echo hi & wait",
      // …and at the end of the script even without one, which is a deliberate difference from bash
      // stated in `runScript`: there a job keeps the terminal's descriptor after the shell exits,
      // here the shell owns its pipes, so exiting without waiting would discard the output.
      "seq 1 3 &",
      // `$!`, and the statuses.
      "false & wait $!; echo st=$?",
      "true & wait $!; echo st=$?",
      "wait; echo st=$?",
      "jobs; echo st=$?",
      // A job is forgotten once accounted for. Only the `wait` spelling is compared here: the `jobs`
      // one would have to run `jobs` while a job is in flight, and whether it still is by then is a
      // race — see the layout test below, where bash printed `Done` for the same script this file
      // measured as `Running` by hand a minute earlier.
      "seq 1 2 & wait %1; wait %1; echo st=$?",
      // Every way of naming one that is not there.
      "wait 999999; echo st=$?",
      "wait %9; echo st=$?",
      "kill %9; echo st=$?",
    ];
    for (const script of cases) {
      const run = (cmd: string) =>
        new Deno.Command(cmd, {
          args: ["-c", script],
          stdin: "null",
          stdout: "piped",
          stderr: "piped",
          env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
          clearEnv: true,
        }).outputSync();
      const dec = new TextDecoder();
      const theirs = run("bash");
      const ours = run(wacshBinary);
      const strip = (t: string) => t.replace(/^\S*bash: line \d+: /gm, "").trim();
      assertEquals(dec.decode(ours.stdout), dec.decode(theirs.stdout), `${script}: output`);
      assertEquals(strip(dec.decode(ours.stderr)), strip(dec.decode(theirs.stderr)), `${script}: stderr`);
      assertEquals(ours.code, theirs.code, `${script}: status`);
    }
  },
});

Deno.test("`jobs` prints the columns measured from bash", () => {
  // **bash cannot be the oracle here, and that is a fact about the question rather than a shortcut.**
  // `seq 1 2 & jobs` prints `[1]+  Running …` if the child is still going and `[1]   Done …` if it is
  // not — different mark, different state, and bash drops the trailing `&` for the finished form. Which
  // one you get is a race between two processes, and this file has no `sleep` applet to lose it with.
  //
  // So the layout is asserted against the string bash printed when it *was* still running, quoted
  // here: `[N]M` then two spaces, then the state in a 24-wide field, then the command and the `&` it
  // was written with. The widths are the thing worth pinning — a guess at them looks right and lines
  // up with nothing — and they came from `bash | cat -A` rather than from the manual.
  const out = new TextDecoder().decode(
    new Deno.Command(wacshBinary, {
      args: ["-c", "seq 1 2 & jobs"],
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
      clearEnv: true,
    }).outputSync().stdout,
  );
  const listed = out.split("\n").filter((l) => l.startsWith("["));
  assertEquals(listed.length, 1, `expected one job line, got ${JSON.stringify(out)}`);
  assertEquals(listed[0], "[1]+  Running                 seq 1 2 &");
  // And the column really is 24 wide, said as arithmetic so that changing the padding fails here
  // rather than only shifting a string nobody reads closely.
  assertEquals(listed[0].indexOf("seq"), "[1]+  ".length + 24);
});

Deno.test({
  name: "what `&` cannot background says so rather than running in the foreground",
  ignore: !haveBash,
  fn: () => {
    // bash backgrounds a whole list in a subshell; this cannot, because a subshell here is a
    // `Shell.fork` running in *this* instance and there is nothing to run it on. Each of these is a
    // refusal rather than a foreground run that reports a job number for something already finished.
    //
    // Not compared with bash, which does them: what is asserted is that ours **says** so and fails,
    // which is the distinction design/0001 D6 is about — a plausible-looking job is worse than a
    // refusal a reader can act on.
    for (const script of ["{ echo a; } &", "echo x | rev &", "echo a && echo b &", "echo x > out &"]) {
      const r = new Deno.Command(wacshBinary, {
        args: ["-c", script],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
        env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
        clearEnv: true,
      }).outputSync();
      const dec = new TextDecoder();
      assertEquals(dec.decode(r.stdout), "", `${script}: ran something`);
      assertEquals(
        dec.decode(r.stderr).includes("not implemented") ||
          dec.decode(r.stderr).includes("needs a simple command"),
        true,
        `${script}: ${dec.decode(r.stderr)}`,
      );
      assertEquals(r.code !== 0, true, `${script}: succeeded`);
    }
  },
});

/**
 * `kill %1` **ends** a background job — design/0001 step 3's own criterion, at last.
 *
 * The criterion is "`ps` shows the pipeline you are running and `kill` ends one", and until now `kill`
 * could not end anything at all. Signals here are cooperative — a wasm function call cannot be
 * interrupted from outside — so `kill` writes a signal on a row and the receiver picks it up at its
 * next check. **A background job has no such row to read.** It is a separate instance with its own
 * process table, where its own pid is 1; the row this shell keeps for it is one nothing over there
 * will ever look at. So `kill %1` reported success and did nothing, for ever, by construction.
 *
 * What reaches a separate instance is the capability. `closeSocket` on a child's handle stops the
 * child, so that is how a signal to a job is delivered — the one place in this system where a signal
 * does what a kernel's does, and the reason `kill` ends a *job* where it cannot end a pipeline stage.
 *
 * The measurement is the line count, because a status alone cannot tell the difference: the first
 * version of `endJob` drained the child's output before closing, so `seq 1 300000 & kill %1` printed
 * all three hundred thousand lines and reported 143. The job was not killed; only the number was.
 */
Deno.test("`kill %1` ends a background job rather than relabelling it", () => {
  const run = (script: string) =>
    new Deno.Command(wacshBinary, {
      args: ["-c", script],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
      clearEnv: true,
    }).outputSync();
  const dec = new TextDecoder();

  // Left alone, the job produces all of it — the canary, without which "few lines" below could mean
  // the job never started.
  const whole = dec.decode(run("seq 1 300000 & wait").stdout).trimEnd().split("\n");
  assertEquals(whole.length, 300000, `an unkilled job produced ${whole.length} lines`);

  // Killed, it does not. Not asserted as an exact count: how far a child gets before the close lands
  // is a race, and pinning a number would be pinning this machine's scheduling. What is definite is
  // that it is nowhere near all of them.
  const killed = run("seq 1 300000 & kill %1; wait");
  const lines = dec.decode(killed.stdout).trimEnd().split("\n").filter((l) => l.length > 0);
  assertEquals(lines.length < 1000, true, `the kill did not stop it: ${lines.length} lines`);
  assertEquals(killed.code, 0, dec.decode(killed.stderr));

  // And the status is a shell's for a child a signal ended.
  const status = run("seq 1 300000 & kill %1; wait %1; echo st=$?");
  assertEquals(dec.decode(status.stdout).trimEnd().endsWith("st=143"), true, dec.decode(status.stdout));
  // `kill -9` too, which is the one signal a reader will expect to be special. It is not special
  // here — nothing can end a process except the capability — but it does reach a job.
  const nine = run("seq 1 300000 & kill -9 %1; wait %1; echo st=$?");
  assertEquals(dec.decode(nine.stdout).trimEnd().endsWith("st=137"), true, dec.decode(nine.stdout));
});
