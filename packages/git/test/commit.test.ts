// `gitci` — a commit written in wac — audited by git.
//
//     deno test -A packages/git/test/commit.test.ts
//
// `design/system/0005` step 5's criterion: **`git fsck --strict` reports no problem and `git log` shows
// our commit with its parent.** Both are asked here, and two more that are stronger than the criterion
// and available for free — `git status` empty afterwards, and `git ls-tree -r` listing exactly the paths
// we meant in git's own order.
//
// ## The fixture contains the sort trap, and the test asserts it did
//
// git orders tree entries by name as raw bytes with a **subtree compared as though its name ended in
// `/`**. So `a.b` sorts before the directory `a`, because `.` is 0x2E and `/` is 0x2F. A tree builder
// that sorted plain names produces a different hash that git will happily read and then disagree with
// every other client about — and it passes on any fixture that does not contain both names. So the
// fixture has both, and the test checks they came back in that order rather than assuming.
//
// ## Root commits
//
// The second test commits into an empty repository, where `HEAD`'s branch names nothing yet. That is the
// zero-parent case, and it is a different path through `commitTree` — a commit with no `parent` header
// at all, which `fsck --strict` is particular about.

// Imported for its side effect: retries a spawn that fails with "Text file busy", and installs the
// `WAC_PROFILE` coverage wrapper. Both need to happen before `Deno.test` registers anything, which is
// why it is a static import here rather than something the builder could arrange. issues/system 0074.
import "../../../harness/spawnRetry.ts";
// **Host-side because `gitci` reads `GIT_AUTHOR_DATE` and `Cli.exec` passes no environment.**
// Without it the clock is used, and the assertion that committing one tree twice names the same
// commit — which is what makes a commit content-addressed — cannot be made. `issues/system/0182`.
//
// Everything else here would convert: `wac run --allow-… example/gitci.wac -- <dir> <message>`
// replaces the `buildApp` below, and every other assertion compares against git's own answer.
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
if (!haveGit) console.error("git commit tests: skipped — no `git` on PATH");

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

let exePath: string | null = null;
async function gitci(): Promise<string> {
  if (exePath === null) {
    exePath = await Deno.makeTempFile({ prefix: "gitci-" });
    await buildApp("packages/git/example/gitci.wac", exePath, { read: true, write: true, env: true });
    await Deno.chmod(exePath, 0o755);
  }
  return exePath;
}

async function repo(): Promise<{ dir: string; git: (a: string[]) => Promise<{ out: string; err: string; code: number }> }> {
  const dir = await Deno.makeTempDir({ prefix: "wac-git-ci-" });
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
    // stderr included: `git fsck` writes its complaints there, so dropping it makes a failure say
    // "complained: " and nothing else.
    return { out: dec.decode(r.stdout).trim(), err: dec.decode(r.stderr).trim(), code: r.code };
  };
  await git(["init", "-q", "-b", "main"]);
  // **`gitci` reads `user.name` and `user.email` and refuses without them**, as git does — so the fixture
  // has to configure an identity rather than relying on a built-in one.
  await git(["config", "user.name", "Ada Lovelace"]);
  await git(["config", "user.email", "ada@example.com"]);
  return { dir, git };
}

/** The tree that holds the sort trap, nested directories and bytes a text encoder would not survive. */
async function populate(dir: string): Promise<string[]> {
  await Deno.mkdir(`${dir}/sub/deep`, { recursive: true });
  await Deno.mkdir(`${dir}/a`, { recursive: true });
  await Deno.writeTextFile(`${dir}/a.txt`, "one\n");
  await Deno.writeTextFile(`${dir}/a.b`, "dot\n");
  await Deno.writeTextFile(`${dir}/a/inner`, "nested\n");
  await Deno.writeTextFile(`${dir}/sub/b.txt`, "two\n");
  await Deno.writeTextFile(`${dir}/sub/deep/c.txt`, "three\n");
  await Deno.writeFile(`${dir}/blob.bin`, new Uint8Array([0, 1, 255, 254, 10]));
  // git's own order for these, which is what `ls-tree -r` will print.
  return ["a.b", "a.txt", "a/inner", "blob.bin", "sub/b.txt", "sub/deep/c.txt"];
}

async function run(exe: string, args: string[]): Promise<{ out: string; err: string; code: number }> {
  // `GIT_AUTHOR_DATE` is git's own lever for a reproducible commit, and `gitci` honours it for the same
  // reason: without it the clock is used and two runs of one tree produce different commits. Every `git`
  // invocation in this file already sets it; this is the same value.
  const r = await new Deno.Command(exe, {
    args,
    stdout: "piped",
    stderr: "piped",
    env: { GIT_AUTHOR_DATE: "1700000000 +0000", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
    clearEnv: true,
  }).output();
  return { out: dec.decode(r.stdout).trim(), err: dec.decode(r.stderr).trim(), code: r.code };
}

Deno.test({
  name: "a commit we made passes `git fsck --strict` and `git log` shows it with its parent",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git } = await repo();
    try {
      // A first commit by git, so ours has a parent to point at.
      await Deno.writeTextFile(`${dir}/a.txt`, "before\n");
      await git(["add", "-A"]);
      await git(["commit", "-qm", "first, by git"]);
      const parent = (await git(["rev-parse", "HEAD"])).out;

      const paths = await populate(dir);
      const r = await run(await gitci(), [dir, "second, by wac\n"]);
      assert(r.code === 0, `gitci failed: ${r.err}`);
      const made = r.out;
      assert(/^[0-9a-f]{40}$/.test(made), `gitci printed ${JSON.stringify(made)}, expected a commit name`);

      // The criterion, both halves.
      assert((await git(["fsck", "--strict"])).code === 0, `git fsck --strict complained: ${(await git(["fsck", "--strict"])).err}`);
      assert((await git(["rev-parse", "HEAD"])).out === made, "the branch does not point at the commit we made");
      assert((await git(["log", "-1", "--format=%P"])).out === parent, "our commit's parent is not git's commit");
      assert((await git(["log", "--format=%s"])).out.split("\n").length === 2, "git does not show two commits");

      // Stronger than the criterion and free: the whole repository agrees.
      assert((await git(["status", "--porcelain"])).out === "", `git status is not clean: ${(await git(["status", "--porcelain"])).out}`);

      // **The sort trap.** `a.b` before `a/inner`, which is git's rule and not a plain name sort.
      const listed = (await git(["ls-tree", "-r", "--name-only", "HEAD"])).out.split("\n");
      assert(listed.join(",") === paths.join(","), `ls-tree gave ${listed.join(" ")}, expected ${paths.join(" ")}`);
      assert(
        listed.indexOf("a.b") < listed.indexOf("a/inner"),
        "the fixture did not exercise the subtree sort rule — `a.b` must come before `a/inner`",
      );

      // What git reads back out of the commit is what we wrote into it.
      const body = (await git(["cat-file", "commit", made])).out;
      assert(
        body.includes("author Ada Lovelace <ada@example.com> 1700000000 +0000"),
        `the author line is not the configured identity at the pinned time:\n${body}`,
      );
      assert(body.endsWith("second, by wac"), `the message is not at the end of:\n${body}`);
      assert((await git(["log", "-1", "--format=%s"])).out === "second, by wac", "git shows a different subject");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "a first commit has no parent header, and git accepts it as a root",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git } = await repo();
    try {
      await populate(dir);
      const r = await run(await gitci(), [dir, "the only commit\n"]);
      assert(r.code === 0, `gitci failed on an empty repository: ${r.err}`);

      assert((await git(["fsck", "--strict"])).code === 0, `git fsck --strict complained about a root commit: ${(await git(["fsck", "--strict"])).err}`);
      assert((await git(["log", "-1", "--format=%P"])).out === "", "a first commit was given a parent");
      assert((await git(["rev-list", "--count", "HEAD"])).out === "1", "the history is not one commit long");
      assert((await git(["status", "--porcelain"])).out === "", "git status is not clean after a root commit");

      // A commit is content-addressed, so committing the same tree twice must name the same commit —
      // which also proves the identity fields are fixed rather than taken from a clock.
      const first = (await git(["rev-parse", "HEAD"])).out;
      await git(["update-ref", "-d", "refs/heads/main"]);
      const again = await run(await gitci(), [dir, "the only commit\n"]);
      assert(again.out === first, `the same tree and message gave ${again.out} and then ${first}`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "writing an object that is already there leaves it alone",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git } = await repo();
    try {
      await populate(dir);
      assert((await run(await gitci(), [dir, "once\n"])).code === 0, "the first commit failed");
      const before = (await git(["count-objects", "-v"])).out;

      // The same tree again: every blob and tree already exists, so only the commit is new.
      await git(["update-ref", "-d", "refs/heads/main"]);
      assert((await run(await gitci(), [dir, "once\n"])).code === 0, "the second commit failed");
      const after = (await git(["count-objects", "-v"])).out;
      assert(before === after, `object counts changed on a re-commit of the same tree:\n${before}\n${after}`);
      assert((await git(["fsck", "--strict"])).code === 0, `git fsck --strict complained after a re-commit: ${(await git(["fsck", "--strict"])).err}`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

addEventListener("unload", () => {
  if (exePath !== null) {
    try {
      Deno.removeSync(exePath);
    } catch { /* already gone */ }
  }
});

Deno.test({
  name: "an unset identity is refused, and no commit is made",
  ignore: !haveGit,
  fn: async () => {
    // **A commit is signed, and inventing a name to put on it is the one thing a tool must not do.** git
    // refuses here with "Please tell me who you are"; this refuses too, and the assertion that matters is
    // the second one — that nothing was written, rather than that a message was printed.
    const { dir, git } = await repo();
    try {
      await git(["config", "--unset", "user.name"]);
      await git(["config", "--unset", "user.email"]);
      await Deno.writeTextFile(`${dir}/a.txt`, "one\n");
      const r = await run(await gitci(), [dir, "no author"]);
      assert(r.code !== 0, `gitci committed without an identity: ${r.out}`);
      assert(r.err.includes("user.name"), `the refusal does not name what is missing: ${JSON.stringify(r.err)}`);
      const log = await git(["log", "--oneline"]);
      assert(log.code !== 0, `a commit was made anyway: ${log.out}`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

// **An executable committed as an executable** — the reading half of issues/system/0132.
//
// `Stat` had no mode, so the tree walk recorded every blob as `100644` and a commit of an executable
// carried a mode change nobody asked for. The oracle is `git ls-tree`, which prints the mode the tree
// actually stores, and `git status`, which is empty only if the mode matches what is on disk.
//
// **The fixture asserts the shape in git's own answer first.** A repository whose files are all plain
// would pass against a walk that still hard-coded `100644`, so this one holds an executable *and* a plain
// file, and checks git agrees they differ before ours is compared to anything.
Deno.test({
  name: "a tree built from a working tree records 100755 for an executable",
  ignore: !haveGit,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-git-exec-" });
    const git = async (args: string[]) => {
      const r = await new Deno.Command("git", {
        args: ["-C", dir, ...args],
        env: {
          GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: "a@b", GIT_AUTHOR_DATE: "1700000000 +0000",
          GIT_COMMITTER_NAME: "a", GIT_COMMITTER_EMAIL: "a@b", GIT_COMMITTER_DATE: "1700000000 +0000",
          PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: dir,
        },
        clearEnv: true,
        stdout: "piped",
        stderr: "piped",
      }).output();
      return { text: dec.decode(r.stdout).trim(), err: dec.decode(r.stderr).trim(), ok: r.success };
    };
    try {
      await git(["init", "-q", "-b", "main", "."]);
      await git(["config", "user.name", "a"]);
      await git(["config", "user.email", "a@b"]);
      await Deno.writeTextFile(`${dir}/run.sh`, "#!/bin/sh\necho hi\n");
      await Deno.chmod(`${dir}/run.sh`, 0o755);
      await Deno.writeTextFile(`${dir}/plain.txt`, "not executable\n");

      // The fixture's own shape: git must see the two files as different modes on disk.
      const probe = await git(["hash-object", "-w", "run.sh"]);
      assert(probe.ok, `git could not hash the fixture: ${probe.err}`);
      const execBit = (await Deno.stat(`${dir}/run.sh`)).mode ?? 0;
      assert((execBit & 0o100) !== 0, `the fixture's run.sh is not executable: mode ${execBit.toString(8)}`);
      const plainBit = (await Deno.stat(`${dir}/plain.txt`)).mode ?? 0;
      assert((plainBit & 0o100) === 0, `the fixture's plain.txt is executable: mode ${plainBit.toString(8)}`);

      const r = await run(await gitci(), [dir, "an executable\n"]);
      assert(r.code === 0, `gitci failed: ${r.err}`);

      // **`git ls-tree` is the adjudicator**: it prints the mode the tree stores, not the mode on disk.
      const tree = await git(["ls-tree", "HEAD"]);
      assert(
        tree.text.includes("100755 blob") && /100755 blob \w+\trun\.sh/.test(tree.text),
        `run.sh was not recorded executable:\n${tree.text}`,
      );
      assert(/100644 blob \w+\tplain\.txt/.test(tree.text), `plain.txt was not recorded plain:\n${tree.text}`);

      // And the whole point: the mode matching the disk is what makes status empty.
      const st = await git(["status", "--porcelain"]);
      assert(st.text === "", `git reports a difference after our commit:\n${st.text}`);
      const fsck = await git(["fsck", "--strict"]);
      assert(fsck.ok, `fsck refused the commit: ${fsck.err}`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
