// `gitst` against `git status --porcelain`, on the same directory.
//
//     deno test -A packages/git/test/status.test.ts
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
// which is what last-match-wins gives. `core.excludesFile` is the one source still unread.
//
// The one thing it cannot report is an **unstaged mode change**, because `Stat` has no mode
// (`issues/system/0132`). A *staged* mode change is visible, since both sides of that comparison are
// recorded rather than read off the disk. The fixture holds no executable, so the difference does not arise
// here — `checkout.test.ts` is where that boundary is measured.

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
    await buildApp("packages/git/example/gitst.wac", exePath, { read: true, write: true });
    await Deno.chmod(exePath, 0o755);
  }
  return exePath;
}

Deno.test({
  name: "all three of git's answers, in git's order — staged, unstaged and untracked",
  ignore: !haveGit,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-git-st-" });
    const git = async (args: string[]) => {
      const r = await new Deno.Command("git", {
        args,
        cwd: dir,
        stdout: "piped",
        stderr: "piped",
        env: {
          GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: "a@b", GIT_AUTHOR_DATE: "1700000000 +0000",
          GIT_COMMITTER_NAME: "a", GIT_COMMITTER_EMAIL: "a@b", GIT_COMMITTER_DATE: "1700000000 +0000",
          PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: dir,
        },
        clearEnv: true,
      }).output();
      // Untrimmed: porcelain's first column is a space, and trimming it loses which side disagrees. This
      // package has been caught by that three times.
      return { raw: dec.decode(r.stdout), text: dec.decode(r.stdout).trim(), code: r.code };
    };
    try {
      await git(["init", "-q", "-b", "main"]);
      await Deno.mkdir(`${dir}/sub`);
      await Deno.writeTextFile(`${dir}/a.txt`, "one\n");
      await Deno.writeTextFile(`${dir}/sub/b.txt`, "two\n");
      await Deno.writeTextFile(`${dir}/gone.txt`, "three\n");
      await Deno.writeTextFile(`${dir}/same.txt`, "unchanged\n");
      await Deno.writeTextFile(`${dir}/both.txt`, "first\n");
      await Deno.writeFile(`${dir}/blob.bin`, new Uint8Array([0, 1, 2, 255, 254, 10]));
      await git(["add", "-A"]);
      await git(["commit", "-qm", "one"]);

      // Every shape porcelain can put in either column, plus two files that must appear in neither answer.
      await Deno.writeTextFile(`${dir}/a.txt`, "staged\n");
      await git(["add", "a.txt"]);                                  // M  — staged only
      await Deno.writeTextFile(`${dir}/sub/b.txt`, "unstaged\n");    //  M — unstaged only, nested
      await git(["rm", "-q", "gone.txt"]);                          // D  — staged deletion
      await Deno.writeTextFile(`${dir}/added.txt`, "new\n");
      await git(["add", "added.txt"]);                              // A  — staged addition
      await Deno.writeTextFile(`${dir}/both.txt`, "staged then\n");
      await git(["add", "both.txt"]);
      await Deno.writeTextFile(`${dir}/both.txt`, "edited again\n"); // MM — both columns at once
      await Deno.writeTextFile(`${dir}/untracked.txt`, "new\n");     // ?? — untracked
      // An entirely untracked directory, which git collapses to one line; a directory with a tracked file
      // in it, whose untracked contents are listed individually; and files an ignore rule covers.
      await Deno.mkdir(`${dir}/fresh`);
      await Deno.writeTextFile(`${dir}/fresh/one.txt`, "x\n");
      await Deno.writeTextFile(`${dir}/fresh/two.txt`, "y\n");
      await Deno.writeTextFile(`${dir}/sub/alsonew.txt`, "z\n");
      await Deno.writeTextFile(`${dir}/.gitignore`, "*.tmp\n!keep.tmp\nbuilt/\n");
      await Deno.writeTextFile(`${dir}/junk.tmp`, "ignored\n");
      await Deno.writeTextFile(`${dir}/keep.tmp`, "negated back\n");
      // **A nested `.gitignore`, which only works if a deeper file's rules are applied after a shallower
      // one's.** `sub/` holds a tracked file, so the walk descends into it rather than collapsing it. The
      // same name at the root proves the nested rule does not reach outside its own directory.
      await Deno.writeTextFile(`${dir}/sub/.gitignore`, "!inner.tmp\nscoped\n");
      await Deno.writeTextFile(`${dir}/sub/inner.tmp`, "brought back by sub/.gitignore\n");
      await Deno.writeTextFile(`${dir}/sub/scoped`, "ignored only under sub\n");
      await Deno.writeTextFile(`${dir}/inner.tmp`, "still ignored at the root\n");
      await Deno.mkdir(`${dir}/built`);
      await Deno.writeTextFile(`${dir}/built/out`, "ignored\n");

      const theirs = (await git(["status", "--porcelain"])).raw.replace(/\n$/, "").split("\n");
      // **The fixture's own shape, asserted.** `MM` is the one that matters most: it is the only line that
      // proves the two columns are computed separately rather than one derived from the other.
      assert(theirs.includes("M  a.txt"), `no staged-only change:\n${theirs.join("\n")}`);
      assert(theirs.includes(" M sub/b.txt"), "no unstaged-only change in a subdirectory");
      assert(theirs.includes("MM both.txt"), "no file that is staged and then edited again");
      assert(theirs.includes("A  added.txt"), "no staged addition");
      assert(theirs.includes("D  gone.txt"), "no staged deletion");
      assert(theirs.includes("?? untracked.txt"), "no untracked file");
      // **The shapes untracked reporting is easy to get wrong**, each asserted in git's own answer first.
      assert(theirs.includes("?? fresh/"), `git did not collapse an untracked directory:\n${theirs.join("\n")}`);
      assert(theirs.includes("?? sub/alsonew.txt"), "git did not list inside a directory holding a tracked file");
      assert(theirs.includes("?? keep.tmp"), "the negated ignore rule did not bring keep.tmp back");
      assert(!theirs.some((l) => l.includes("junk.tmp")), "git did not ignore junk.tmp");
      assert(!theirs.some((l) => l.includes("built")), "git did not ignore the built/ directory");
      // The nested file's two effects, in git's own answer, before ours is compared to it.
      assert(theirs.includes("?? sub/inner.tmp"), "the nested negation did not bring sub/inner.tmp back");
      assert(!theirs.some((l) => l === "?? inner.tmp"), "the nested negation reached the root");
      assert(!theirs.some((l) => l.includes("sub/scoped")), "the nested rule did not ignore its own name");
      assert(!theirs.some((l) => l.endsWith(" same.txt")), "git thinks the unchanged file changed");
      assert(!theirs.some((l) => l.endsWith(" blob.bin")), "git thinks the untouched binary changed");

      const r = await new Deno.Command(await gitst(), { args: [dir], stdout: "piped", stderr: "piped" })
        .output();
      assert(r.code === 0, `gitst failed: ${dec.decode(r.stderr).trim()}`);
      const ours = dec.decode(r.stdout).replace(/\n$/, "").split("\n").filter((l) => l !== "");

      // **A diff, not a set comparison** — and now the whole of git's answer, untracked lines included.
      // Order is part of it: git groups tracked changes before untracked ones rather than sorting the lot,
      // so `?? .gitignore` follows `M  a.txt` even though `.` sorts before `a`.
      assert(
        ours.join("\n") === theirs.join("\n"),
        `we say:\n${ours.join("\n")}\ngit says:\n${theirs.join("\n")}`,
      );

      // A clean tree is empty on both sides — the case that catches a status reporting every file.
      await git(["reset", "-q", "--hard", "HEAD"]);
      for (const junk of ["untracked.txt", ".gitignore", "junk.tmp", "keep.tmp", "sub/alsonew.txt",
                          "sub/.gitignore", "sub/inner.tmp", "sub/scoped", "inner.tmp"]) {
        await Deno.remove(`${dir}/${junk}`);
      }
      await Deno.remove(`${dir}/fresh`, { recursive: true });
      await Deno.remove(`${dir}/built`, { recursive: true });
      assert((await git(["status", "--porcelain"])).text === "", "git still sees changes after a reset");
      const clean = await new Deno.Command(await gitst(), { args: [dir], stdout: "piped", stderr: "piped" })
        .output();
      assert(dec.decode(clean.stdout).trim() === "", `we report changes in a clean tree: ${dec.decode(clean.stdout)}`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
