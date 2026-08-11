// `gitco` — a checkout written in wac — judged by `git status`.
//
//     deno test -A packages/git/test/checkout.test.ts
//
// This is `design/system/0005` step 4's criterion, and it is the strongest test in the package. The
// others compare a parse against what git prints; this one **deletes a repository's working tree, rebuilds
// it from the object database, and asks git whether the result is correct.** A wrong byte, a missing
// file, a wrong mode or an index in the wrong order each show up by name.
//
// It runs a real built program rather than binding a module, because that is the only way to get a
// host-backed `Fs`: a checkout writes an unknown number of files, so it cannot be driven from outside
// without the driver becoming the client.
//
// ## Three tests, because there are two known boundaries
//
// A tree with no executable file and no symlink checks out clean. The other two do not, and both are
// missing capabilities on `Cli` rather than bugs here:
//
// - **An executable** lands without its bit, because `packages/fs` cannot `chmod` a host mount, and
//   git reports exactly that one file as modified. `issues/system/0132`.
// - **A symlink** lands as an ordinary file holding its target path, because there is no way to create
//   one at all, and git reports ` T` — a typechange in the *worktree* column, our index having recorded
//   mode 40960 and agreeing with HEAD. That distinction is asserted on the untrimmed porcelain output,
//   because trimming it would let a wrong index pass as a filesystem limitation.
//
// Each is pinned rather than described, so implementing the capability fails the test and names the
// documents to update instead of leaving a stale limitation in three places.

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
if (!haveGit) console.error("git checkout tests: skipped — no `git` on PATH");

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Built once: `buildApp` compiles the whole of `packages/git`, which is not free. */
let exePath: string | null = null;
async function gitco(): Promise<string> {
  if (exePath === null) {
    exePath = await Deno.makeTempFile({ prefix: "gitco-" });
    await buildApp("packages/git/example/gitco.wac", exePath, { read: true, write: true });
    await Deno.chmod(exePath, 0o755);
  }
  return exePath;
}

/**
 * A repository whose tree holds the shapes a checkout gets wrong, and whose objects are packed.
 *
 * `git gc` matters here: without it every object is loose and the pack path — most of the reading this
 * exercises — is never touched.
 */
async function repo(withExecutable: boolean, withSymlink = false): Promise<{ dir: string; git: (a: string[]) => Promise<{ out: string; code: number }> }> {
  const dir = await Deno.makeTempDir({ prefix: "wac-git-co-" });
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
    return { out: dec.decode(r.stdout).trim(), code: r.code };
  };
  await git(["init", "-q"]);
  await Deno.mkdir(`${dir}/sub/deep`, { recursive: true });
  await Deno.writeTextFile(`${dir}/a.txt`, "one\n");
  await Deno.writeTextFile(`${dir}/sub/b.txt`, "two\n");
  await Deno.writeTextFile(`${dir}/sub/deep/c.txt`, "three\n");
  // Bytes a text encoder would not survive, so the blob path is not just ASCII.
  await Deno.writeFile(`${dir}/blob.bin`, new Uint8Array([0, 1, 2, 255, 254, 10]));
  await Deno.writeTextFile(`${dir}/script.sh`, "#!/bin/sh\necho hi\n");
  if (withExecutable) await Deno.chmod(`${dir}/script.sh`, 0o755);
  // A symlink is a *kind* of entry rather than a mode: git stores mode 120000 whose blob is the target
  // path. `packages/fs` cannot create one, so `checkout` writes an ordinary file holding that path and
  // says so — and the point of putting one here is that the claim gets measured instead of predicted.
  if (withSymlink) await Deno.symlink("a.txt", `${dir}/link`);
  await git(["add", "-A"]);
  await git(["commit", "-qm", "one"]);
  await git(["gc", "-q"]);
  return { dir, git };
}

/** Delete everything but `.git`, so a checkout has to rebuild the lot. */
async function wipe(dir: string): Promise<void> {
  for (const e of Deno.readDirSync(dir)) {
    if (e.name !== ".git") await Deno.remove(`${dir}/${e.name}`, { recursive: true });
  }
  await Deno.remove(`${dir}/.git/index`);
}

async function run(exe: string, dir: string): Promise<{ out: string; err: string; code: number }> {
  const r = await new Deno.Command(exe, { args: [dir], stdout: "piped", stderr: "piped" }).output();
  return { out: dec.decode(r.stdout).trim(), err: dec.decode(r.stderr).trim(), code: r.code };
}

Deno.test({
  name: "a working tree we rebuilt from the object database is one git calls clean",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git } = await repo(false);
    try {
      assert((await git(["status", "--porcelain"])).out === "", "the fixture was not clean to begin with");
      const before = (await git(["ls-files"])).out;

      await wipe(dir);
      // The canary: with the working tree gone git must *disagree*, or the test below proves nothing.
      assert(
        (await git(["status", "--porcelain"])).out !== "",
        "git called the repository clean with no working tree — the wipe did not happen",
      );

      const r = await run(await gitco(), dir);
      assert(r.code === 0, `gitco failed: ${r.err}`);
      assert(r.out === "5 files", `gitco wrote ${JSON.stringify(r.out)}, expected "5 files"`);
      assert(r.err === "", `gitco warned about something: ${r.err}`);

      const after = await git(["status", "--porcelain"]);
      assert(after.out === "", `git called the rebuilt tree dirty: ${after.out}`);
      assert((await git(["ls-files"])).out === before, "the index we wrote lists different paths");
      assert((await git(["fsck"])).code === 0, "git fsck failed after our checkout");

      // The bytes, not just the names — `status` would catch this, and saying it directly makes a
      // failure point at the file rather than at a mode.
      assert(await Deno.readTextFile(`${dir}/sub/deep/c.txt`) === "three\n", "a nested file has the wrong contents");
      const bin = await Deno.readFile(`${dir}/blob.bin`);
      assert(bin.length === 6 && bin[3] === 255, "a binary file did not survive the round trip");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "an executable checks out without its mode, and says so — issues/system/0132",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git } = await repo(true);
    try {
      await wipe(dir);
      const r = await run(await gitco(), dir);
      assert(r.code === 0, `gitco failed: ${r.err}`);

      // **The limitation is reported rather than discovered.** If this stops being true because a
      // `chmod` capability landed, that is good news and this test is where to start: update
      // issues/system/0132, `packages/git`'s README, and design/system/0005's step 4 row.
      assert(
        r.err.includes("executable bit"),
        `gitco did not warn that it could not set a mode; it said ${JSON.stringify(r.err)}. If Cli grew ` +
          `a chmod capability, close issues/system/0132 and update this test, the README and ` +
          `design/system/0005 step 4.`,
      );

      const after = await git(["status", "--porcelain"]);
      assert(
        after.out === "M script.sh",
        `expected exactly the executable to be reported, git said ${JSON.stringify(after.out)}`,
      );
      // And it really is only the mode: the contents match, so nothing else is wrong with the checkout.
      assert(
        (await git(["diff", "--summary"])).out === "mode change 100755 => 100644 script.sh",
        "the difference is not only the mode",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

// The built program is shared by both tests and removed once they are done.
addEventListener("unload", () => {
  if (exePath !== null) {
    try {
      Deno.removeSync(exePath);
    } catch { /* already gone */ }
  }
});

Deno.test({
  name: "a symlink checks out as a file holding its target, and says so",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git } = await repo(false, true);
    try {
      // **The shape, asserted.** A fixture with no symlink would let this pass while proving nothing,
      // and there are two ordinary ways to get one: a platform without symlinks, or `core.symlinks`
      // false. Both store mode 100644 here and warn nobody.
      const tree = (await git(["ls-tree", "-r", "HEAD"])).out;
      assert(
        /^120000 blob [0-9a-f]{40}\tlink$/m.test(tree),
        `the fixture holds no symlink entry, so this test would prove nothing:\n${tree}`,
      );
      const before = (await git(["ls-files"])).out;
      await wipe(dir);

      const r = await run(await gitco(), dir);
      assert(r.code === 0, `gitco failed: ${r.err}`);
      assert(r.out === "6 files", `gitco wrote ${JSON.stringify(r.out)}, expected "6 files"`);
      // Reported rather than left to git — the same standard the executable bit is held to above.
      assert(
        r.err.includes("symlink"),
        `gitco did not say it had written a symlink as a file; it said ${JSON.stringify(r.err)}. If ` +
          `Cli grew a symlink capability, this test, packages/git's README and design/system/0005 ` +
          `step 4 all need updating.`,
      );

      // **Untrimmed, because the column is the finding.** Porcelain is two columns, index-vs-HEAD then
      // worktree-vs-index, and the difference here is in the second: our index records mode 40960 and
      // agrees with HEAD, while the thing on disk is a regular file. Trimming this would hide which
      // half disagrees and let a wrong index pass as a filesystem limitation.
      const raw = new TextDecoder().decode(
        (await new Deno.Command("git", { args: ["status", "--porcelain"], cwd: dir, stdout: "piped" })
          .output()).stdout,
      );
      assert(raw === " T link\n", `expected exactly an unstaged typechange, got ${JSON.stringify(raw)}`);

      assert((await git(["ls-files"])).out === before, "the index we wrote lists different paths");
      assert((await git(["fsck"])).code === 0, "git fsck failed after our checkout");
      const st = await Deno.lstat(`${dir}/link`);
      assert(!st.isSymlink && st.isFile, "the entry on disk is not the ordinary file this claims to write");
      assert(await Deno.readTextFile(`${dir}/link`) === "a.txt", "the file does not hold the link target");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
