// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import { appRunner } from "../../../harness/appRun.ts";
import { pool } from "../../../harness/inFlight.ts";
import { buildApp } from "../../platform/build.ts";
import "../../../harness/spawnRetry.ts";
import { CORPUS, usesDeleted } from "./corpus.ts";
// The shell, against bash.
//
// Every script here runs through GNU bash and through ours, and the two must agree on standard
// output *and* on the exit status. That is the only test worth much for a shell: the behaviour is
// defined by what the real one does, and almost every rule has a case where the obvious
// implementation is subtly wrong.
//
// The scripts are restricted to what this shell implements — no globbing, no compound commands,
// and only the external programs in `program.wac`. Where ours cannot match bash the difference is
// in the README, rather than worked around by choosing kinder scripts.
//
// bash runs with `LC_ALL=C` so `sort` compares bytes, which is what ours does. Without it the
// locale decides and the two disagree on case.

// **Filtered.** `packages/sh` is giving its programs up a few at a time in favour of `packages/box`'s
// applets (wac-mono 0103), and a script naming one it no longer has would run against a shell without
// it. Those scripts are not lost: `packages/box/test/corpus.test.ts` runs every script that names any of
// the eleven through a shell built with the applets. `corpus.ts`'s `DELETED` is the line between them.
const CASES: string[] = CORPUS.filter((s) => !usesDeleted(s));

/**
 * A directory to glob against, made once and used by the pattern cases below.
 *
 * Absolute paths here, so a pattern means the same thing to both shells wherever the suite is run
 * from. Relative ones are covered by the `cd` cases below, which move both shells first.
 */
const globDir = await Deno.makeTempDir();
/**
 * Remove what this file built, however it ends.
 *
 * `Deno.test` has no suite-level teardown, so a module-level temp used by several tests had nowhere to
 * be cleaned up and was left behind — one built binary of about 700 KiB per run of the suite. Five
 * hundred of them were sitting in `/tmp` when a parallel run finally died with "No space left on
 * device", in the middle of a package that had nothing to do with it. `unload` fires on the way out
 * whether the tests passed, failed or threw, which is the only hook that covers all three.
 */
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(globDir, { recursive: true });
  } catch {
    // Already gone, or never made. Nothing to report on the way out.
  }
});

for (const name of ["a.txt", "b.txt", "c.log", ".hidden"]) {
  await Deno.writeTextFile(`${globDir}/${name}`, "");
}
await Deno.mkdir(`${globDir}/sub`);
await Deno.writeTextFile(`${globDir}/sub/x.txt`, "");

for (const pattern of [
  "*.txt", "*", "?.log", "*.log", "nomatch*", "sub/*", "a?txt", "*.t?t", "sub/x.*",
]) {
  CASES.push(`echo ${globDir}/${pattern}`);
}
// Quoted patterns must not glob, and neither must a quoted metacharacter next to an unquoted one.
CASES.push(`echo "${globDir}/*.txt"`);
CASES.push(`echo '${globDir}/*.txt'`);
CASES.push(`echo ${globDir}/"*".txt`);
CASES.push(`x="${globDir}/*.txt"; echo "$x"`);

/**
 * `cd`, `pwd` and `ls`.
 *
 * The three things everybody types into a new shell, and the ones most able to be subtly wrong:
 * a `cd` that moves the prompt but not the next `cat` is worse than no `cd`. Every case moves
 * first and then does something that has to notice — read a file, glob, redirect, list.
 *
 * bash resolves these against the process's directory and this shell against its own idea of one,
 * which is exactly the thing under test: if the two disagree about where "here" is, the output
 * differs and the case fails.
 */
for (const script of [
  `cd ${globDir}; pwd`,
  `cd ${globDir}; cd sub; pwd`,
  `cd ${globDir}/sub; cd ..; pwd`,
  `cd ${globDir}; cd ./sub/../sub; pwd`,
  `cd /; pwd`,
  `cd /; cd ..; pwd`,                                  // `..` above the root stays at the root
  `cd ${globDir}; ls`,
  `cd ${globDir}; ls sub`,
  `cd ${globDir}; ls -a | sort`,                        // the dotfile shows only with -a
  `cd ${globDir}; ls nosuchthing; echo status=$?`,
  `cd ${globDir}; cat sub/x.txt; echo read=$?`,         // a relative read after moving
  `cd ${globDir}/sub; cat ../a.txt; echo read=$?`,      // ...and one through `..`
  `cd ${globDir}; echo ${"${globDir}"}/*.txt | tr " " "\n" | wc -l`,
  `cd ${globDir}; echo *.txt`,                          // a *relative* glob, resolved by cwd
  `cd ${globDir}/sub; echo *.txt`,
  `cd nosuchdir; echo status=$?`,                       // a failed cd changes nothing
  `cd ${globDir}; cd nosuchdir; pwd`,
  `cd ${globDir}; OLDPWD=; cd sub; cd - >/dev/null; pwd`,
]) {
  CASES.push(script);
}

/**
 * `mkdir` and `rm`.
 *
 * They are here because `cd` needs somewhere to go: in a browser the filesystem starts empty, so
 * a shell with `cd` and no `mkdir` looks broken when it is merely alone. Each case works in a
 * directory of its own, since these ones write.
 *
 * Only stdout and the exit status are compared: bash's `mkdir` is `/bin/mkdir` and its wording is
 * its own, so comparing the text of a refusal would be comparing two dialects. The *order* of the
 * two streams is compared, in its own test at the end of this file.
 */
for (const [i, script] of [
  `mkdir one; ls`,
  `mkdir -p one/two/three; ls one/two`,
  `mkdir one; mkdir one; echo status=$?`,
  `mkdir -p one; mkdir -p one; echo status=$?`,
  `mkdir one; echo hi > one/f; cat one/f`,
  `mkdir one; cd one; pwd`,
  `mkdir one; echo x > one/f; rm -r one; ls; echo status=$?`,
  `rm nothing; echo status=$?`,
  `rm -f nothing; echo status=$?`,
  `mkdir one; rm one; echo status=$?`,
  // `test`'s file operators, which need something to look at — the reason they are in this group and
  // not among the string tests above. `test -f f` was "unknown operator" until it was compared with
  // bash: the most ordinary line a script contains, answered with a usage error.
  `echo x > f; test -f f && echo isfile`,
  `echo x > f; test -d f || echo notdir`,
  `mkdir one; test -d one && echo isdir`,
  `mkdir one; test -f one || echo notfile`,
  `echo x > f; test -e f && echo exists`,
  `test -e nothing || echo absent`,
  `test -f nothing; echo status=$?`,
  `echo x > f; [ -f f ] && echo bracket`,
  `echo x > f; test ! -f f; echo status=$?`,
  `test ! -f nothing && echo missing`,
  `echo x > f; test -s f && echo nonempty`,
  `: > empty; test -s empty; echo status=$?`,
  `test -s nothing; echo status=$?`,
  `echo x > f; test -h f; echo status=$?`,       // not a link, and `stat` would have said "file"
  `test -q f; echo status=$?`,                   // still refused, and it is a *usage* error: 2
  // File *operands*. Every program here except `cat` used to ignore them and read standard input
  // regardless, so `wc -l f` printed `0` and exited `0`, and `grep pattern f` exited 1 — which a
  // script reads as "no match" rather than "the file was never opened".
  `printf 'a\nb\n' > f; wc -l f`,
  `printf 'a\nb\n' > f; wc f`,
  // A file big enough for the column width to be visible: GNU takes it from the digits of the total
  // size, so these are six wide where the two-line files above are one.
  `seq 1 20000 > f; wc f`,
  `seq 1 20000 > f; wc -l f`,
  `seq 1 20000 > f1; echo x > f2; wc f1 f2`,
  `seq 1 20000 > f1; echo x > f2; wc -lw f1 f2`,
  `printf 'a\nb\n' > f; wc -l < f`,             // and no name, when it is standard input
  `printf 'a\nb\n' > f; wc -l - < f`,           // …but `-` keeps its name, as GNU prints it
  `printf 'a\nb\n' > f; head -1 f`,
  `printf 'a\nb\n' > f; tail -1 f`,
  `printf 'b\na\n' > f; sort f`,
  `printf 'a\na\n' > f; uniq f`,
  `printf 'ab\n' > f; rev f`,
  `printf 'a\nb\n' > f; nl f`,
  `printf 'a\nb\n' > f; cat f - < f`,
  // Redirections, which used to gather the command's whole output in the shell and write the file
  // afterwards — so `seq 1 2000000000 > out` trapped at one wasm array where bash writes twenty
  // gigabytes (0070). The streaming path opens the file first and relays into it, which is why the
  // truncation, the ordering and the capture interaction all need saying.
  `seq 1 3 > f; cat f`,
  `seq 1 3 > f; seq 4 5 > f; cat f`,
  `seq 1 5 | head -2 > f; cat f`,
  `x=$(seq 1 3 > f); echo "[$x]"; cat f`,
  // **Truncated first, on purpose.** The harness gives each case a directory and runs *both* shells in
  // it, so a case whose answer depends on what is already there sees the other shell's leftovers: this
  // one without the `: > f` reported `1..5` from bash and `1..5` twice from us, which is the harness
  // rather than the shell. Every other case here happens to truncate, which is why nothing had hit it.
  `: > f; seq 1 3 >> f; seq 4 5 >> f; cat f`,
  `printf '' > f; wc -c < f`,
  `cat missing > f; echo status=$?; wc -c < f`,
  `seq 1 3 > sub/f; echo status=$?`,
  `echo one > f; echo two > f; wc -l < f`,
  // The operand paths of the five that now stream, including the two orderings of a file that cannot
  // be opened — `rev` and `nl` report and carry on, `sort` gives up, and the complaint lands *between*
  // the outputs rather than before them, which needs the output sink flushed first.
  `printf 'ab\n' > f1; printf 'cd\n' > f2; rev f1 f2`,
  `printf 'ab\n' > f; rev f missing; echo status=$?`,
  `printf 'a\nb\n' > f; nl f missing; echo status=$?`,
  `printf 'a\n\nb\n' > f1; printf '\nc\n' > f2; nl f1 f2`,
  `printf 'a\na\n' > f; uniq f`,
  `printf 'b\na\n' > f1; printf 'z\n' > f2; sort f1 f2`,
  `printf 'b\na\n' > f; sort - f < f`,
  // A file it cannot open is reported and the *rest are still printed*, as GNU does. This used to
  // stop at the first failure, so `cat missing f` printed the complaint and none of `f` — with the
  // right status, which is what made it invisible.
  `printf 'a\nb\n' > f; cat missing f; echo status=$?`,
  `printf 'a\nb\n' > f; cat f missing; echo status=$?`,
  `printf 'a\nb\n' > f1; printf 'c\n' > f2; cat f1 missing f2; echo status=$?`,
  `printf 'a\nb\n' > f; cat -n f; echo status=$?`,
  // Numbering and squeezing run across the operands, as GNU's do.
  `printf 'a\nb\n' > f1; printf 'c\n' > f2; cat -n f1 f2`,
  `printf 'a\n\n' > f1; printf '\nc\n' > f2; cat -s f1 f2`,
  `printf 'a\nb\n' > f; cat -n f - < f`,
  // Several of them, where the shape of the answer changes: `wc` names each file and totals them,
  // `head` and `tail` write a header per block, `grep` labels its lines, and `sort`, `nl` and `rev`
  // treat the operands as one concatenation — `nl`'s numbering runs on across the boundary.
  `printf 'a\nb\n' > f1; printf 'c\n' > f2; wc -l f1 f2`,
  `printf 'a\nb\n' > f1; printf 'c\n' > f2; wc f1 f2`,
  `printf 'a\nb\n' > f1; printf 'c\n' > f2; wc -c f1 f1`,
  `printf 'a\nb\n' > f1; printf 'c\n' > f2; head -1 f1 f2`,
  `printf 'a\nb\n' > f1; printf 'c\n' > f2; tail -n 1 f1 f2`,
  `printf 'a\nb\n' > f1; printf 'c\n' > f2; nl f1 f2`,
  `printf 'a\nb\n' > f1; printf 'c\n' > f2; sort f1 f2`,
  `printf 'ab\n' > f1; printf 'c\n' > f2; rev f1 f2`,
  // `grep`'s flags, which were not read at all: an option it did not have became the *pattern*, so
  // `grep -c a f` searched for `-c` and reported no match.
  `printf 'a\nb\n' > f; grep a f`,
  `printf 'a\nb\n' > f; grep -c a f`,
  `printf 'a\nb\n' > f; grep -n a f`,
  `printf 'a\nb\n' > f; grep -v a f`,
  `printf 'a\nb\n' > f; grep -cv a f`,
  `printf 'Apple\nbanana\napple\n' > f; grep -i apple f`,
  `printf 'Apple\nbanana\napple\n' > f; grep -in a f`,
  `printf 'Apple\napple\n' > f; grep -x apple f`,
  `printf 'a\nb\n' > f; grep -q a f; echo status=$?`,
  `printf 'a\nb\n' > f; grep -q z f; echo status=$?`,
  `printf 'a\nb\n' > f1; printf 'c\n' > f2; grep a f1 f2`,
  `printf 'a\nb\n' > f1; printf 'c\n' > f2; grep -c a f1 f2`,
  // A file that cannot be read: each of these has GNU's own status for it, and three of the four
  // concatenating programs carry on with what they could read where `sort` gives up.
  `grep a missing; echo status=$?`,
  `wc -l missing; echo status=$?`,
  `head -1 missing; echo status=$?`,
  `tail -1 missing; echo status=$?`,
  `sort missing; echo status=$?`,
  `uniq missing; echo status=$?`,
  `rev missing; echo status=$?`,
  `nl missing; echo status=$?`,
  `wc -l missing1 missing2; echo status=$?`,
  `printf 'c\n' > f2; nl missing f2; echo status=$?`,
  `printf 'c\n' > f2; rev missing f2; echo status=$?`,
  `printf 'c\n' > f2; sort missing f2; echo status=$?`,
  `printf 'c\n' > f2; grep c missing f2; echo status=$?`,
  `printf 'a\nb\n' > f; wc -l f missing; echo status=$?`,
  `printf 'a\nb\n' > f; head -1 f missing; echo status=$?`,
  // An option none of them has, refused rather than taken for something else. The statuses differ by
  // program and are GNU's: 1 for `wc`, `head`, `tail`, `uniq`, `nl` and `rev`; 2 for `sort` and `grep`.
  `echo x | wc -Z; echo status=$?`,
  `echo x | sort -Z; echo status=$?`,
  `echo x | grep -Y x; echo status=$?`,
  `echo x | uniq -Z; echo status=$?`,
  `echo x | head -Z; echo status=$?`,
  `echo x | tail -Z; echo status=$?`,
  `echo x | nl -Z; echo status=$?`,
  `echo x | rev -Z; echo status=$?`,
].filter((script) => !usesDeleted(script)).entries()) {
  // A directory per case, made by the harness rather than the script, so one failure cannot
  // leave a mess that changes what the next case sees.
  const dir = `${globDir}/w${i}`;
  Deno.mkdirSync(dir);
  CASES.push(`cd ${dir}; ${script}`);
}

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` \u2014 ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

async function bash(script: string, cwd: string) {
  const r = await new Deno.Command("bash", {
    args: ["-c", script],
    // **A directory of its own, and the same one our shell gets.** Without it both shells ran in the
    // repository's root, because neither `Deno.Command` nor the in-process runner sets one — so a case
    // like `echo x > f` wrote `f` into the checkout, `git status` grew a stray file after every suite
    // run, and the two shells being compared shared a directory with each other and with the previous
    // 680 cases. A differential test whose halves can see each other's leftovers is comparing the
    // wrong thing; this is also how `f` came to be committed to the repo root once already.
    cwd,
    // No standard input for either shell, and said rather than inherited. A script that reads — `cat`
    // or `read` with nothing redirected into it — now reads the *shell's* input, since `sh` claims it
    // (issue 0032). Inheriting the test runner's would mean both shells waiting on a terminal that
    // never ends, which is a hang rather than a difference.
    stdin: "null",
    env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
    clearEnv: true,
  }).output();
  return { stdout: new TextDecoder().decode(r.stdout), code: r.code };
}

/**
 * The shell, built once as a standalone program.
 *
 * Not `deno task app` per script: that builds every time *and* spawns the result as a child, so a
 * hundred and thirty scripts become several hundred nested processes. This container ran out of
 * process ids once already today for a related reason — see wac-mono 0017 — and the build is the
 * slow part regardless.
 */
/**
 * Remove the built shell however this file ends.
 *
 * `Deno.test` has no suite-level teardown, so a module-level temp had nowhere to be cleaned up: 98 of
 * these were sitting in `/tmp` — one 400 KiB shell per run of the suite, since March by the timestamps —
 * and the same leak in `spawn.test.ts` is what filled the disk once already today. `unload` fires
 * whether the tests passed, failed or threw, which is the only hook that covers all three.
 */
const GRANTS = { read: true, write: true, env: true };

/**
 * The shell as an executable, for the tests that need a real process: one redirects both streams
 * into a file through bash, one feeds a script on standard input, and one compares what two
 * *processes* see of `HOME` and `OLDPWD`.
 */
const wacshBinary = await (async () => {
  const out = await Deno.makeTempFile({ prefix: "wacsh-" });
  globalThis.addEventListener("unload", () => {
    try {
      Deno.removeSync(out);
    } catch {
      // Already gone, or never built. Nothing to report on the way out.
    }
  });
  // `buildApp` directly rather than `deno run build.ts` — a whole extra Deno start for a function
  // this file can import.
  await buildApp("packages/sh/src/sh.wac", out, GRANTS);
  return out;
})();

/**
 * The shell in *this* process, which is how the 604 cases run.
 *
 * Each case was two subprocesses and one of them was ours at ~167ms, which was most of what this
 * file cost. `appRunner` is the launcher half of a built program, so a case is a worker here — same
 * wasm, same world, no second Deno. bash stays a process: it is the oracle at 2.5ms, and running it
 * any other way would be testing something else.
 */
const sh = await appRunner("packages/sh/src/sh.wac", GRANTS);

/**
 * The environment the shell is given.
 *
 * The spawning version passed three variables with `clearEnv: false`, so it *inherited* the suite's
 * environment and overrode those. `appRunner`'s `env` is exhaustive, so the inheritance is spelled
 * out rather than quietly dropped — a variable the suite had and this did not would be a difference
 * between the two shells that nothing here would attribute correctly.
 */
const SH_ENV: Record<string, string> = {
  ...Deno.env.toObject(),
  LC_ALL: "C",
  PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin",
  HOME: Deno.env.get("HOME") ?? "",
};

async function wacsh(script: string, cwd: string, note?: (what: string) => void) {
  // No standard input, as for bash above: the comparison is of scripts, not of terminals. The
  // runner ends the input stream at once when none is given, which is what `stdin: "null"` did.
  const r = await sh.run(["-c", script], { env: SH_ENV, cwd, note });
  return { stdout: r.out, code: r.code, stderr: r.err };
}

const haveBash = await (async () => {
  try {
    return (await new Deno.Command("bash", { args: ["-c", "exit 0"] }).output()).code === 0;
  } catch {
    return false;
  }
})();

Deno.test({
  name: "every script agrees with bash on output and exit status",
  ignore: !haveBash,
  fn: async () => {
    // Four at a time. Each script is a bash subprocess and an in-process run of our shell, so serially this
    // is twenty-odd seconds of a suite that runs in a minute.
    //
    // Through `pool` rather than a hand-rolled queue for one reason: when this test wedges — and it has,
    // for over ten minutes at load 0.55, which is 0082's last open question — the pool writes the scripts
    // it is still holding to standard error. Without that, a hang here reports the name of this test and
    // nothing about which of 614 scripts caused it, and the only way to find out is to instrument the
    // harness by hand, which is what I did the first time and then deleted.
    const differences: string[] = [];
    await pool(CASES, 4, async (script, _index, note) => {
      // One directory per case, removed after it. Per case rather than per run because several scripts
      // write the same names — `f`, `d`, `out` — and a case that found the previous one's file would
      // pass or fail on the order the pool happened to run them in.
      const dir = await Deno.makeTempDir({ prefix: "sh-case-" });
      try {
      // Both halves run at once, and the note says which are still outstanding. Without it a wedge names
      // the script and leaves it open whether the stuck half is the real `bash` subprocess or our own
      // shell in this process — wac-mono 0082, where four cases hung for 550s and that was the question.
      let waiting = new Set(["bash", "wacsh"]);
      const finish = (half: string) => {
        waiting.delete(half);
        note([...waiting].join("+"));
      };
      note("bash+wacsh");
      const [want, got] = await Promise.all([
        bash(script, dir).then((r) => {
          finish("bash");
          return r;
        }),
        // The phase goes into the note too: `[wacsh:running]` and `[wacsh:draining]` are different
        // bugs, and a wedge that says which costs one run instead of a bisect.
        wacsh(script, dir, (phase) => {
          if (waiting.has("wacsh")) note([...waiting].join("+").replace("wacsh", `wacsh:${phase}`));
        }).then((r) => {
          finish("wacsh");
          return r;
        }),
      ]);
      if (want.stdout !== got.stdout || want.code !== got.code) {
        differences.push(
          `script: ${JSON.stringify(script)}\n` +
          `  bash: ${JSON.stringify(want.stdout)} exit ${want.code}\n` +
          `  ours: ${JSON.stringify(got.stdout)} exit ${got.code}` +
          (got.stderr.trim() === "" ? "" : `\n  stderr: ${got.stderr.trim().split("\n")[0]}`),
        );
      }
      } finally {
        await Deno.remove(dir, { recursive: true }).catch(() => {});
      }
    }, {
      what: "script",
      // The script itself is the label, shortened: a case is identified by what it runs, and the longest
      // here would wrap several times in a terminal.
      label: (script) => (script.length > 110 ? `${script.slice(0, 110)}…` : script),
    });
    if (differences.length > 0) {
      throw new Error(`${differences.length} of ${CASES.length} scripts differ from bash:\n\n` +
                      differences.join("\n\n"));
    }
  },
});

/**
 * Standard error arrives when it happened, not at the end of the run.
 *
 * Its own test rather than a case above, because the two shells word their diagnostics differently —
 * bash says `bash: line 1: nope: command not found` — so what is comparable is *where* the line
 * lands, not what it says. That is the whole of what issue 0014 was about: the shell used to collect
 * standard error in a buffer and flush it through `Core.warn` at the end, because the capability
 * world had no byte-level error stream, so `echo one; nope; echo two 2>&1` put the complaint after
 * both lines of output no matter when it happened.
 */
Deno.test({
  name: "standard error interleaves with standard output, as bash does",
  ignore: !haveBash,
  fn: async () => {
    const script = "echo one; nope; echo two";
    // Both streams into one file, which is the only way to observe their order. The redirection is
    // done by bash rather than by `Deno.Command`, which will not take a file handle for either.
    const both = async (cmd: string) => {
      const out = await Deno.makeTempFile({ prefix: "sh-order-" });
      const r = await new Deno.Command("bash", {
        args: ["-c", '"$0" -c "$1" >"$2" 2>&1', cmd, script, out],
        env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
        clearEnv: true,
      }).output();
      const text = await Deno.readTextFile(out);
      await Deno.remove(out);
      return { lines: text.trimEnd().split("\n"), code: r.code };
    };

    const theirs = await both("bash");
    const ours = await both(wacshBinary);
    const at = (lines: string[]) => lines.findIndex((l) => l.includes("not found"));
    assertEquals(ours.lines.length, 3, ours.lines.join(" | "));
    assertEquals(at(ours.lines), at(theirs.lines), `ours: ${ours.lines.join(" | ")}`);
    assertEquals(at(ours.lines), 1, "the complaint is between the two outputs");
    assertEquals(ours.lines[0], "one");
    assertEquals(ours.lines[2], "two");

    // And a diagnostic naming a file whose bytes are not valid UTF-8 survives, which the old flush
    // through a string could not do: `string.fromBytes` of an invalid sequence is not the bytes back.
    const odd = await new Deno.Command(wacshBinary, {
      args: ["-c", "cat $(printf '\\xff\\xfe')"],
      env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
      clearEnv: true,
    }).output();
    const raw = odd.stderr;
    assertEquals(raw.includes(0xff) && raw.includes(0xfe), true,
      `the bytes reached standard error unchanged: ${Array.from(raw).join(",")}`);
  },
});

/**
 * The shell's *own* standard input, which nothing else here exercises.
 *
 * Every case above is a script with no input piped in, which is why issue 0032 survived so long:
 * `printf x | sh -c 'cat'` printed nothing, because `stdinBytes` was only ever filled by a
 * redirection, a here-document or a pipeline. These pass the same bytes to both shells and compare
 * what comes out, so the cursor (`read` then `cat`), the empty case, and a command that consumes
 * everything are all pinned against bash rather than against my idea of bash.
 *
 * `cat; cat` is **not** here, and where it lives is the point. This binary is `packages/sh` alone, whose
 * `cat` is one of the small wac implementations in `program.wac` — a function call inside the shell,
 * handed a byte array. Nothing can tell how much of it that call read, so the shell cannot mark the
 * input consumed and the second `cat` sees it again. Where the commands are *real programs* — the shell
 * in `packages/box`, whose applets are spawned — the child is handed the shell's own descriptor and the
 * second finds what the first left, exactly as in bash. That case is pinned in
 * `packages/box/test/shell.test.ts`, and issue 0042 is where the reasoning is.
 *
 * `echo hi; cat` and `seq 1 2; cat` are the other side of it and belong here: a command that ignores its
 * input must leave it for the next one, in-process or not.
 */
const STDIN_CASES: [string, string][] = [
  ["cat", "a b c\nd\n"],
  ["read x; echo \"[$x]\"; cat", "a b c\nd\n"],
  ["echo hi; cat", "kept\n"],
  ["seq 1 2; cat", "kept\n"],
  ["read x; read y; echo \"[$x][$y]\"", "one\ntwo\nthree\n"],
  ["cat", ""],
  ["read x; echo \"[$x]\"", ""],
  ["while read line; do echo \"got $line\"; done", "a\nb\nc\n"],
  ["echo before; cat; echo after", "middle\n"],
];

Deno.test({
  name: "the shell reads its own standard input, as bash does",
  ignore: !haveBash,
  fn: async () => {
    for (const [script, input] of STDIN_CASES) {
      const fed = async (cmd: string, args: string[]) => {
        const p = new Deno.Command(cmd, {
          args,
          stdin: "piped",
          stdout: "piped",
          stderr: "null",
          env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
          clearEnv: true,
        }).spawn();
        const w = p.stdin.getWriter();
        await w.write(new TextEncoder().encode(input));
        await w.close();
        const out = await p.output();
        return { out: new TextDecoder().decode(out.stdout), code: out.code };
      };
      const theirs = await fed("bash", ["-c", script]);
      const ours = await fed(wacshBinary, ["-c", script]);
      assertEquals(
        ours.out,
        theirs.out,
        `${JSON.stringify(script)} over ${JSON.stringify(input)}`,
      );
      assertEquals(ours.code, theirs.code, `${JSON.stringify(script)}: exit status`);
    }

    // A script *read from* standard input consumes it, so a command inside it has nothing left —
    // `echo cat | sh` runs `cat` with no input rather than feeding it the rest of the script.
    const script = "cat\n";
    const asScript = async (cmd: string, args: string[]) => {
      const p = new Deno.Command(cmd, {
        args,
        stdin: "piped",
        stdout: "piped",
        stderr: "null",
        env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
        clearEnv: true,
      }).spawn();
      const w = p.stdin.getWriter();
      await w.write(new TextEncoder().encode(script));
      await w.close();
      return new TextDecoder().decode((await p.output()).stdout);
    };
    assertEquals(await asScript(wacshBinary, []), await asScript("bash", []), "script from stdin");
  },
});

/**
 * `HOME` and `OLDPWD`, which every case above runs without.
 *
 * The harness clears the environment and sets `LC_ALL` and `PATH`, deliberately: a script whose answer
 * depends on the machine's `$USER` is not a comparison. But `cd` and `cd -` read `HOME` and `OLDPWD`,
 * and with those cleared *bash* refuses too — so the corpus agreed with bash about the failure and
 * never asked about the success. `cd` alone went nowhere and said "HOME not set" while `echo $HOME` in
 * the same shell printed it, because expansion fell back to the environment and `cd` looked only at
 * variables this shell had assigned.
 *
 * Two named variables, both set to a temporary directory, so the answer is still the shell's and not
 * the machine's. `~` is here for the same reason and could not have been compared above either: with
 * `HOME` unset bash reads the password file instead, so `echo ~` would be the container's own answer.
 */
Deno.test({
  name: "HOME and OLDPWD reach `cd`, `cd -` and `~`, as they do in bash",
  ignore: !haveBash,
  fn: async () => {
    const home = await Deno.makeTempDir({ prefix: "sh-home-" });
    const old = await Deno.makeTempDir({ prefix: "sh-old-" });
    const from = await Deno.makeTempDir({ prefix: "sh-from-" });
    try {
      const cases = [
        "cd; pwd",                     // HOME from the environment
        "cd -",                        // OLDPWD from the environment, and `cd -` prints where it went
        'cd ""; pwd',                  // present but empty: a no-op, not "go home"
        "cd; cd -; pwd",               // and OLDPWD as this shell set it, not as it inherited it
        "HOME=; cd; pwd",              // assigned empty in this shell, which is not the same as unset
        "cd nowhere; pwd",             // still where it was, and status 1
        "cd; echo st=$?",
        // Tilde expansion, which is the same `HOME` and could not be compared with it cleared either:
        // bash falls back to the password file, so `echo ~` there prints the real home directory and
        // nothing in this container's environment makes the two shells agree.
        "echo ~",
        "echo ~/x",
        'echo "~"',                    // quoted: a tilde is a tilde
        "echo \\~",
        "echo a~",                     // not at the front of the word
        "echo ~a",                     // a user name, which neither shell can resolve here
        "echo ~/x ~",
        "echo ~:~",                    // in a *word* only the leading one expands
        "echo ~:x",                    // …and a colon ends a tilde-prefix even so
        "echo ~=x",                    // while other punctuation does not: a word, not a home
        "echo ~/a:~/b",                // still one, in a word
        'echo "a~"~',                  // …and the front of the word is not the front of a part
        "x=~/a; echo $x",
        "y=/u:~/b; echo $y",           // in an assignment, one after every colon
        "v=~:~; echo $v",              // …so both of these expand, unlike in the word above
        "z=~; echo $z/y",              // expanded once, at assignment time
        "cd ~; pwd",
        "echo hi > ~/f; cat ~/f",      // a redirection target, which is why `joinWord` does it too
      ];
      for (const script of cases) {
        const run = (cmd: string, args: string[]) =>
          new Deno.Command(cmd, {
            args,
            cwd: from,
            stdin: "null",
            stdout: "piped",
            stderr: "null",
            env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: home, OLDPWD: old },
            clearEnv: true,
          }).outputSync();
        const theirs = run("bash", ["-c", script]);
        const ours = run(wacshBinary, ["-c", script]);
        const text = (r: Deno.CommandOutput) => new TextDecoder().decode(r.stdout);
        assertEquals(text(ours), text(theirs), `${JSON.stringify(script)}: output`);
        assertEquals(ours.code, theirs.code, `${JSON.stringify(script)}: exit status`);
      }
    } finally {
      for (const d of [home, old, from]) await Deno.remove(d, { recursive: true });
    }
  },
});

/**
 * The builtins' *diagnostics*, against GNU's own.
 *
 * Every case above compares standard output, which is the right default — a shell's job is what it
 * prints — and it means the wording of a failure was never checked against anything. `mkdir` and `rm`
 * are the two builtins here that GNU also ships as programs, so their lines are comparable, and they
 * were not comparable at all: they carried the host's errno and an absolute path GNU does not print
 * ("File exists (os error 17): mkdir '/tmp/…'"), which also differed by runtime — Node says
 * "EEXIST: file already exists" for the same fault.
 *
 * `LC_ALL=C` matters here and is why the harness above sets it: GNU quotes the path with typographic
 * marks in a UTF-8 locale and with apostrophes in C.
 */
Deno.test({
  name: "a file that cannot be read is reported in GNU's own words",
  ignore: !haveBash,
  fn: async () => {
    // The *reason* used to be the host's: "No such file or directory (os error 2): readfile
    // '/tmp/x/missing'" under Deno, and "ENOENT: no such file or directory, open '…'" under Node — one
    // fact, three spellings, none of them GNU's four words. `FileResult` carries a fault category now
    // (wac-mono 0062), so each program translates the category rather than printing the sentence.
    //
    // The whole line is compared, not just the reason: each of these tools words the *prefix*
    // differently too — `head` says "cannot open 'x' for reading", `sort` says "cannot read: x", `rev`
    // says "cannot open x" — and those were already matched, which is what makes the whole line
    // comparable now that the reason is.
    const dir = await Deno.makeTempDir({ prefix: "sh-unread-" });
    try {
      const cases = [
        // Usage errors, which GNU words to the byte and follows with a "Try 'x --help'" line. They are
        // here rather than in a test of their own because the property is the same one: where the
        // message is derivable it is compared, and where it is *ours* — a gap this shell has and GNU
        // does not — it is not comparable and is not compared.
        "seq",
        "seq abc",
        "seq 1 2 3 4",
        "seq 1 0 3",
        "seq -q 1",
        // Not `seq --nope 1`, which used to be here. GNU answers "unrecognized option '--nope'", and
        // this shell said the same — correctly for `--nope`, and *falsely* for `--separator`, which GNU
        // has and this does not. Telling the two apart needs a table of every long name GNU documents,
        // which nothing here has; so both now get one sentence that is true of either, and it is ours
        // rather than GNU's: "seq: long options are not implemented: --nope". Under the rule this list
        // states, a message that is ours is not comparable and is not compared.
        "echo x | cat -Q",
        "cat missing",
        "wc -l missing",
        "head -1 missing",
        "tail -1 missing",
        "sort missing",
        "uniq missing",
        "grep x missing",
        // Not `rev missing` or `nl missing`: those programs are gone from this shell, and the same two
        // cases run against `packages/box`'s in `packages/box/test/programs.test.ts`. The rest of this
        // list follows them as each is deleted.
        // `ls`'s own wording, which was invented rather than GNU's until 0067's work went past it: it said
        // `ls: x: no such file or directory` where GNU says `ls: cannot access 'x': No such file or
        // directory`. Nothing compared it, because every `ls` case in the corpus lists something that
        // exists.
        "ls nosuchthing",
      ];
      for (const script of cases) {
        const run = (cmd: string, args: string[]) =>
          new Deno.Command(cmd, {
            args,
            cwd: dir,
            stdin: "null",
            stdout: "null",
            stderr: "piped",
            env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
            clearEnv: true,
          }).outputSync();
        const theirs = new TextDecoder().decode(run("bash", ["-c", script]).stderr).trim();
        const ours = new TextDecoder().decode(run(wacshBinary, ["-c", script]).stderr).trim();
        assertEquals(ours, theirs, script);
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "mkdir and rm say what GNU says when they fail",
  ignore: !haveBash,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "sh-diag-" });
    try {
      await Deno.mkdir(`${dir}/full/inner`, { recursive: true });
      await Deno.mkdir(`${dir}/taken`);

      // Builtins only. This binary is `packages/sh` alone, so `rmdir` here is "command not found" —
      // it is `packages/box`'s applet, and its "Directory not empty" is compared against GNU in
      // `box/test/shell.test.ts` where that applet exists.
      const cases = [
        "mkdir taken",      // exists
        "rm nosuchthing",   // absent
        "rm full",          // a directory, without -r
      ];
      for (const script of cases) {
        const run = (cmd: string, args: string[]) =>
          new Deno.Command(cmd, {
            args,
            cwd: dir,
            stdin: "null",
            stdout: "null",
            stderr: "piped",
            env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
            clearEnv: true,
          }).outputSync();
        const theirs = new TextDecoder().decode(run("bash", ["-c", script]).stderr).trim();
        const ours = new TextDecoder().decode(run(wacshBinary, ["-c", script]).stderr).trim();
        // The reason, which is the part a person reads and the part that was wrong. Compared rather than
        // the whole line because a prefix can legitimately differ in shape; the reason cannot.
        const reason = (line: string) => line.slice(line.lastIndexOf(": ") + 2);
        assertEquals(reason(ours), reason(theirs), `${script}\n  ours:  ${ours}\n  theirs: ${theirs}`);
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
