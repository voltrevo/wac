// `core.excludesFile`, which is the one part of `gitst` that still needs a host.
//
//     deno test -A packages/git/test/status.test.ts
//
// **The rest of this file moved to `test/wac/status_test.wac` on 2026-08-17** — the whole porcelain
// diff and the mode-change case. This one stayed because it needs `HOME` pointing at a fixture that
// holds `~/.gitignore_global`, and `Cli.exec` passes no environment: a deliberate limit, since an
// inherited environment is a capability nobody declared. `configchain.test.ts` is behind the same
// wall. `issues/system/0161`.
//
// The README said "checkout, not diff": this package could write a working tree and an index and never
// read one back. This is the other direction, and it has the sharpest oracle in the package — git's own
// `status`, on the same files, with our output written in its format so the two can be compared as text
// rather than interpreted.
//
// ## Where the two deliberately differ, and why the fixture forces it
//
// `statusOf` reports all three of git's answers: the index against `HEAD`, the working tree against the
// index, and untracked files. The comparison is a **diff of the whole output**, order included — git groups
// tracked changes before untracked ones rather than sorting the lot, which one global sort got wrong and
// this catches.
//
// Ignore rules are gathered the way git gathers them: `.git/info/exclude` first, then the root
// `.gitignore`, then each nested one as the walk descends — so a deeper file's rules land later and win,
// which is what last-match-wins gives. `core.excludesFile` is the fourth and lowest, supplied by the
// program because expanding its `~` needs an environment; the second test below is where its precedence
// against the other two is forced to matter.
//
// The one thing it cannot report is an **unstaged mode change**, because `Stat` has no mode
// (`issues/system/0132`). A *staged* mode change is visible, since both sides of that comparison are
// recorded rather than read off the disk. The fixture holds no executable, so the difference does not arise
// here — `checkout.test.ts` is where that boundary is measured.

// Imported for its side effect: retries a spawn that fails with "Text file busy", and installs the
// `WAC_PROFILE` coverage wrapper. Both need to happen before `Deno.test` registers anything, which is
// why it is a static import here rather than something the builder could arrange. issues/system 0074.
import "../../../harness/spawnRetry.ts";
import { buildApp } from "../../platform/build.ts";

const dec = new TextDecoder();

const haveGit = await (async () => {
  try {
    return (await new Deno.Command("git", { args: ["--version"], stdout: "null", stderr: "null" })
      .output()).success;
  } catch {
    return false;
  }
})();
if (!haveGit) console.error("git status tests: skipped — no `git` on PATH");

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

let exePath: string | null = null;
async function gitst(): Promise<string> {
  if (exePath === null) {
    exePath = await Deno.makeTempFile({ prefix: "gitst-" });
    // `env` is granted because `core.excludesFile` is usually `~/…` and expanding it needs `HOME`. Without
    // the grant every variable reports unset rather than failing, so a missing grant would look exactly
    // like an unset `HOME` — the excludes-file case below is what turns that silence into a red test.
    await buildApp("packages/git/example/gitst.wac", exePath, { read: true, write: true, env: true });
    await Deno.chmod(exePath, 0o755);
  }
  return exePath;
}


// **`core.excludesFile`, and the two places its precedence is visible.**
//
// It is the lowest of git's four ignore sources, and a matcher that read it at the *wrong* level — or
// never read it at all — agrees with git on every path where the sources agree. So this fixture is built
// so that all three disagree, and asserts in git's own answer that each disagreement was resolved before
// comparing ours to it:
//
//   - `drop.txt` is named only by the excludes file      -> ignored, proving it was read
//   - `kept.txt` is `!kept.txt` there and `kept.txt` in `.gitignore`   -> ignored, the .gitignore wins
//   - `both.txt` is `both.txt` there and `!both.txt` in `info/exclude` -> listed, info/exclude wins
//
// The order was measured with `git check-ignore -v`, which names the deciding file and line, rather than
// taken from the documentation. `~/` is used rather than an absolute path on purpose: it is what people
// actually write, and expanding it needs `HOME` — so this is also what proves the `env` grant is real.
Deno.test({
  name: "core.excludesFile is read, and loses to both .gitignore and info/exclude",
  ignore: !haveGit,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-git-ex-" });
    const home = await Deno.makeTempDir({ prefix: "wac-git-home-" });
    const env = { HOME: home };
    const git = async (args: string[]) => {
      const r = await new Deno.Command("git", { args: ["-C", dir, ...args], env, stdout: "piped", stderr: "piped" })
        .output();
      assert(r.success, `git ${args.join(" ")}: ${dec.decode(r.stderr).trim()}`);
      return dec.decode(r.stdout);
    };
    try {
      await git(["init", "-q", "-b", "main", "."]);
      await git(["config", "user.name", "T"]);
      await git(["config", "user.email", "t@e"]);
      await Deno.writeTextFile(`${home}/.gitignore_global`, "drop.txt\n!kept.txt\nboth.txt\n");
      // In the repository's own config, so ours and git's read the setting from the same file.
      await git(["config", "core.excludesFile", "~/.gitignore_global"]);
      await Deno.writeTextFile(`${dir}/.git/info/exclude`, "!both.txt\n");
      await Deno.writeTextFile(`${dir}/.gitignore`, "kept.txt\n");
      for (const f of ["drop.txt", "kept.txt", "both.txt", "plain.txt"]) {
        await Deno.writeTextFile(`${dir}/${f}`, "x\n");
      }
      await Deno.writeTextFile(`${dir}/tracked.txt`, "x\n");
      await git(["add", "tracked.txt"]);
      await git(["commit", "-qm", "one"]);

      const theirs = (await git(["status", "--porcelain"])).replace(/\n$/, "").split("\n").filter((l) => l !== "");

      // **The shape, asserted before the comparison.** Each of these is the fixture doing its job; a
      // fixture where the excludes file never mattered would pass against a matcher that ignored it.
      assert(!theirs.some((l) => l.endsWith(" drop.txt")), `the excludes file was not read by git: ${theirs.join(" | ")}`);
      assert(!theirs.some((l) => l.endsWith(" kept.txt")), "a .gitignore did not override the excludes file's negation");
      assert(theirs.some((l) => l.endsWith(" both.txt")), "info/exclude did not override the excludes file");
      assert(theirs.some((l) => l.endsWith(" plain.txt")), "the fixture has no plainly-untracked file left");
      // And the deciding lines themselves, which is the measurement rather than an inference from the list.
      const why = await new Deno.Command("git", {
        args: ["-C", dir, "check-ignore", "-v", "kept.txt", "both.txt"],
        env,
        stdout: "piped",
        stderr: "piped",
      }).output();
      const verdicts = dec.decode(why.stdout);
      assert(verdicts.includes(".gitignore:1:kept.txt"), `.gitignore did not decide kept.txt: ${verdicts}`);

      const r = await new Deno.Command(await gitst(), { args: [dir], env, stdout: "piped", stderr: "piped" })
        .output();
      assert(r.code === 0, `gitst failed: ${dec.decode(r.stderr).trim()}`);
      const ours = dec.decode(r.stdout).replace(/\n$/, "").split("\n").filter((l) => l !== "");
      assert(
        ours.join("\n") === theirs.join("\n"),
        `we say:\n${ours.join("\n")}\ngit says:\n${theirs.join("\n")}`,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
      await Deno.remove(home, { recursive: true });
    }
  },
});

