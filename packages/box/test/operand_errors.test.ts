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
// that both exist. It turned up when `backings.test.ts` moved into this package (wac-mono 0103) carrying
// one script — `cat f1 nothing f2` — out of forty.
//
// GNU's rule, measured here rather than remembered: report it, skip it, carry on, and exit non-zero at
// the end. `sort` is the exception and refuses the whole run with 2, because it cannot answer about an
// ordering it has not seen all of.
//
// ## Two kinds of assertion, because two things are true
//
// Where the whole invocation matches byte for byte, it is compared byte for byte. Where only the
// *ordering* of standard error against standard output still differs, that is stated as such and the
// content and status are compared instead — with the difference named in the table, rather than dropped
// from the sweep. wac-mono 0112 is that difference.

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
const CASES: { script: string; interleaves: boolean; why?: string }[] = [
  { script: "cat f1 nothing f2", interleaves: true },
  { script: "cat -n f1 nothing f2", interleaves: true },
  { script: "cat f1 bad worse f2", interleaves: true },
  { script: "head -1 f1 nothing f2", interleaves: true },
  { script: "sha256sum f1 nothing f2", interleaves: true },
  { script: "rev f1 nothing f2", interleaves: true },
  // Refuses the whole run with 2 rather than skipping, which is what GNU's does.
  { script: "sort f1 nothing f2", interleaves: true },
  // The column width is the digits in the *total* byte count, so no line can be printed until every file
  // has been counted — GNU stats the files up front and gets its width without reading them.
  { script: "wc -l f1 nothing f2", interleaves: false, why: "the width needs every file's size first" },
  { script: "wc f1 nothing f2", interleaves: false, why: "the width needs every file's size first" },
  // `Reader` opens the next operand as soon as the current one ends, which is before the caller has
  // flushed what it wrote from the current one.
  { script: "cut -c1 f1 nothing f2", interleaves: false, why: "Reader opens ahead of the flush" },
  { script: "nl f1 nothing f2", interleaves: false, why: "Reader opens ahead of the flush" },
  { script: "fold f1 nothing f2", interleaves: false, why: "Reader opens ahead of the flush" },
  // GNU's `tac` reports every unopenable operand before printing anything; ours reports at the join.
  { script: "tac f1 nothing f2", interleaves: false, why: "GNU reports before it writes; we report at the join" },
];

Deno.test("an operand that cannot be opened is skipped, not the end of the run", async () => {
  const dir = await Deno.makeTempDir({ prefix: "box-operand-errors-" });
  try {
    await Deno.writeTextFile(`${dir}/f1`, "a\n");
    await Deno.writeTextFile(`${dir}/f2`, "b\n");

    // **The canary.** Every assertion below is "these two agree", which a harness comparing nothing also
    // satisfies. Two invocations that must *not* agree prove the comparison is live.
    const live = ran("bash", ["-c", "cat f1 f2"], dir);
    const dead = ran("bash", ["-c", "cat f2 f1"], dir);
    assertEquals(live.out === dead.out, false, "the harness compares nothing");

    const differed: string[] = [];
    for (const { script, interleaves, why } of CASES) {
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
      // Ordering aside (0112, and `why` says which), the same bytes on each stream is still the whole of
      // what the applet produced — including `b`, which is what this file exists to keep.
      if (ours.out !== theirs.out) {
        differed.push(`${script} (${why}): output ${JSON.stringify(ours.out)} vs ${JSON.stringify(theirs.out)}`);
      }
      if (ours.err !== theirs.err) {
        differed.push(`${script} (${why}): stderr ${JSON.stringify(ours.err)} vs ${JSON.stringify(theirs.err)}`);
      }
    }
    assertEquals(differed.length, 0, `${differed.length} of ${CASES.length} differ:\n  ${differed.join("\n  ")}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
