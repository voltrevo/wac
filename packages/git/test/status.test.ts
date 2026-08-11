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
// `worktreeStatus` reports porcelain's **second** column only: the working tree against the index. It does
// not report untracked files, because deciding which of them count needs `.gitignore`; it cannot report a
// mode change, because `Stat` has no mode (`issues/system/0132`); and it does not fill the first column,
// which compares the index against `HEAD`.
//
// So the fixture **contains an untracked file on purpose**, and the test asserts git reports it while we do
// not. A fixture with none would make the comparison pass while saying nothing about the difference — and
// the difference is the part somebody reading the output needs to know.

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
  name: "the working tree we report as changed is the one git reports",
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
      await Deno.writeFile(`${dir}/blob.bin`, new Uint8Array([0, 1, 2, 255, 254, 10]));
      await git(["add", "-A"]);
      await git(["commit", "-qm", "one"]);

      // The four shapes: a modified file, a modified file inside a directory, a deleted file, and an
      // untracked one. `same.txt` and `blob.bin` must appear in neither output.
      await Deno.writeTextFile(`${dir}/a.txt`, "CHANGED\n");
      await Deno.writeTextFile(`${dir}/sub/b.txt`, "also changed\n");
      await Deno.remove(`${dir}/gone.txt`);
      await Deno.writeTextFile(`${dir}/untracked.txt`, "new\n");

      const theirs = (await git(["status", "--porcelain"])).raw.replace(/\n$/, "").split("\n");
      // **The fixture's own shape, asserted.** Each of these has to be in git's answer or the comparison
      // below is not testing what it claims.
      assert(theirs.includes(" M a.txt"), `no modified file in git's answer:\n${theirs.join("\n")}`);
      assert(theirs.includes(" M sub/b.txt"), "no modified file in a subdirectory");
      assert(theirs.includes(" D gone.txt"), "no deleted file");
      assert(theirs.includes("?? untracked.txt"), "no untracked file, so the difference below is untested");
      assert(!theirs.some((l) => l.endsWith(" same.txt")), "git thinks the unchanged file changed");

      const r = await new Deno.Command(await gitst(), { args: [dir], stdout: "piped", stderr: "piped" })
        .output();
      assert(r.code === 0, `gitst failed: ${dec.decode(r.stderr).trim()}`);
      const ours = dec.decode(r.stdout).replace(/\n$/, "").split("\n").filter((l) => l !== "");

      // Ours is git's, minus the untracked line we do not claim to find. Sorted, because neither promises
      // an order and asserting one would be asserting an implementation detail.
      const wanted = theirs.filter((l) => !l.startsWith("?? ")).sort();
      assert(
        ours.slice().sort().join("\n") === wanted.join("\n"),
        `we say:\n${ours.join("\n")}\ngit says (without untracked):\n${wanted.join("\n")}`,
      );

      // And the difference is exactly the one documented: we are silent about the untracked file.
      assert(
        !ours.some((l) => l.includes("untracked.txt")),
        "we reported an untracked file, which `worktreeStatus` says it does not do",
      );

      // A clean tree is empty on both sides — the case that catches a status reporting every file.
      await git(["checkout", "--", "."]);
      await Deno.remove(`${dir}/untracked.txt`);
      assert((await git(["status", "--porcelain"])).text === "", "git still sees changes after a restore");
      const clean = await new Deno.Command(await gitst(), { args: [dir], stdout: "piped", stderr: "piped" })
        .output();
      assert(dec.decode(clean.stdout).trim() === "", `we report changes in a clean tree: ${dec.decode(clean.stdout)}`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
