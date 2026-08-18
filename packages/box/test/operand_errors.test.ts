// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";
import { buildApp } from "../../platform/build.ts";
// An operand in the *middle* of a list that cannot be opened, against the real tools.
//
// The applets stopped. `cat a missing b` printed `a`, complained, and never printed `b` — and the exit
// status was 1 either way, so nothing in the status said that a file had been skipped rather than a run
// abandoned. `lib/input.wac` said so in a comment and called it "a difference worth naming rather than a
// difference worth pretending about", which is a good sentence about a bad answer: the cost is not the
// status, it is `b`, silently absent.
//
// Nothing found it for months because every operand case anyone wrote names **one** file, or names two
// that both exist. It turned up when `backingsprocess_test.wac` moved into this package (wac-mono 0103) carrying
// one script — `cat f1 nothing f2` — out of forty.
//
// GNU's rule, measured here rather than remembered: report it, skip it, carry on, and exit non-zero at
// the end. `sort` is the exception and refuses the whole run with 2, because it cannot answer about an
// ordering it has not seen all of.
//
// ## Two kinds of operand, and both are here
//
// **Missing** — the file is not there, and the open fails. **A directory** — the open *succeeds* and the
// read is what refuses, which is a different code path, a different message in every tool, and was
// answered here by printing the host's own sentence: `wc: Is a directory (os error 21)`, with an errno,
// no filename, and a different wording under Node. `FAULT_IS_DIR` is the category that fixes that, and
// wac-mono 0062 is the same fix on the open path, made a year earlier for the same reason.
//
// The directory cases also found the worse half of the same bug: `head -1 somedir` printed **nothing and
// exited 0**, because `Line.ok` false means "no more lines" whether the input ended or the read failed.
//
// ## Where a comparison is not possible
//
// Where the whole invocation matches byte for byte, it is compared byte for byte. Two entries compare
// the streams separately, and each says why in its own row.

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const shell = await Deno.makeTempFile({ prefix: "box-operand-errors-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(shell);
  } catch {
    // Already gone, or never built.
  }
});
await buildApp("packages/box/src/bin/sh.wac", shell, { read: true, write: true, env: true });

const ENV = { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" };

/** Everything a run said, in the order it said it: standard error is merged into standard output. */
function ran(binary: string, args: string[], cwd: string) {
  const r = new Deno.Command(binary, {
    args,
    cwd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: ENV,
    clearEnv: true,
  }).outputSync();
  const dec = new TextDecoder();
  return { out: dec.decode(r.stdout), err: dec.decode(r.stderr), code: r.code };
}

/**
 * Invocations naming three files, the middle of which does not exist.
 *
 * `interleaves: false` means our standard error still arrives ahead of output that was produced before
 * it — the applet's output is block-buffered and the complaint is not, where GNU's `error()` flushes
 * standard output first. Where it is `true` the whole run is compared byte for byte.
 */
const CASES: { script: string; interleaves: boolean; wording?: false; why?: string }[] = [
  // ── An operand that is not there ──────────────────────────────────────────
  { script: "cat f1 nothing f2", interleaves: true },
  { script: "cat -n f1 nothing f2", interleaves: true },
  { script: "cat f1 bad worse f2", interleaves: true },
  { script: "head -1 f1 nothing f2", interleaves: true },
  { script: "sha256sum f1 nothing f2", interleaves: true },
  { script: "wc -l f1 nothing f2", interleaves: true },
  { script: "wc f1 nothing f2", interleaves: true },
  { script: "cut -c1 f1 nothing f2", interleaves: true },
  { script: "nl f1 nothing f2", interleaves: true },
  { script: "fold f1 nothing f2", interleaves: true },
  { script: "tac f1 nothing f2", interleaves: true },
  // Refuses the whole run with 2 rather than skipping, which is what GNU's does.
  { script: "sort f1 nothing f2", interleaves: true },
  // util-linux rather than coreutils, and its `error()` does not flush standard output first — so where
  // both streams are merged, *its* ordering depends on whether stdout is a pipe or a terminal, and ours
  // does not. Measured with `stdbuf -o0`, where it prints in the order things happened, as we do.
  {
    script: "rev f1 nothing f2",
    interleaves: false,
    why: "util-linux does not flush stdout before complaining, so its merged order is a libc artefact",
  },

  // ── An operand that is a directory: the open succeeds and the read refuses ─
  { script: "cat adir", interleaves: true },
  { script: "cat f1 adir f2", interleaves: true },
  { script: "wc -l adir", interleaves: true },
  { script: "wc -l f1 adir f2", interleaves: true },
  { script: "wc f1 adir", interleaves: true },
  { script: "head -1 adir", interleaves: true },
  { script: "head -c 3 adir", interleaves: true },
  { script: "head -1 f1 adir f2", interleaves: true },
  { script: "cut -c1 adir", interleaves: true },
  { script: "cut -c1 f1 adir f2", interleaves: true },
  { script: "nl f1 adir f2", interleaves: true },
  { script: "fold f1 adir f2", interleaves: true },
  { script: "sha256sum adir", interleaves: true },
  { script: "sha256sum f1 adir f2", interleaves: true },
  { script: "sort adir", interleaves: true },
  // GNU's own message here is `tac: adir: read error: Invalid argument`, which is neither its
  // open-failure wording nor the reason any other tool gives for the same file. Ours says what the file
  // is; the streams are compared separately rather than matching a sentence that describes nothing.
  {
    script: "tac adir",
    interleaves: false,
    wording: false,
    why: "GNU says 'read error: Invalid argument', which names neither the fault nor its own convention",
  },
];

Deno.test("an operand that cannot be opened is skipped, not the end of the run", async () => {
  const dir = await Deno.makeTempDir({ prefix: "box-operand-errors-" });
  try {
    await Deno.writeTextFile(`${dir}/f1`, "a\n");
    await Deno.writeTextFile(`${dir}/f2`, "b\n");
    await Deno.mkdir(`${dir}/adir`);

    // **The canary.** Every assertion below is "these two agree", which a harness comparing nothing also
    // satisfies. Two invocations that must *not* agree prove the comparison is live.
    const live = ran("bash", ["-c", "cat f1 f2"], dir);
    const dead = ran("bash", ["-c", "cat f2 f1"], dir);
    assertEquals(live.out === dead.out, false, "the harness compares nothing");

    const differed: string[] = [];
    for (const { script, interleaves, wording, why } of CASES) {
      const theirs = ran("bash", ["-c", script], dir);
      const ours = ran(shell, ["-c", script], dir);

      if (ours.code !== theirs.code) {
        differed.push(`${script}: exit ${ours.code}, bash ${theirs.code}`);
        continue;
      }
      if (interleaves) {
        if (ours.out !== theirs.out || ours.err !== theirs.err) {
          differed.push(
            `${script}\n    bash: ${JSON.stringify(theirs.out)} / ${JSON.stringify(theirs.err)}` +
              `\n    ours: ${JSON.stringify(ours.out)} / ${JSON.stringify(ours.err)}`,
          );
        }
        continue;
      }
      // Where the merged order is not comparable, the same bytes on each stream still are — including
      // `b`, which is what this file exists to keep.
      if (ours.out !== theirs.out) {
        differed.push(`${script} (${why}): output ${JSON.stringify(ours.out)} vs ${JSON.stringify(theirs.out)}`);
      }
      // `wording: false` is the third kind: not the order, the *sentence*. Only one case has it, and
      // what is still asserted there is that we said something and that the status matches — a sentence
      // we would have to copy without agreeing with is not an oracle.
      if (wording !== false && ours.err !== theirs.err) {
        differed.push(`${script} (${why}): stderr ${JSON.stringify(ours.err)} vs ${JSON.stringify(theirs.err)}`);
      }
      if (wording === false && ours.err.trim() === "") {
        differed.push(`${script} (${why}): said nothing, where bash said ${JSON.stringify(theirs.err)}`);
      }
    }
    assertEquals(differed.length, 0, `${differed.length} of ${CASES.length} differ:\n  ${differed.join("\n  ")}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
