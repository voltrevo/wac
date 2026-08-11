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
// ## Two tests, because there is a known boundary
//
// A tree with no executable file checks out clean. A tree **with** one does not: `packages/fs` cannot
// `chmod` a host mount, because no such capability exists on `Cli`, so the file lands without its
// executable bit and git reports exactly that one file as modified. That is `issues/system/0132`, and
// the second test pins it — so if somebody implements the capability, this fails and says which
// document to update rather than leaving a stale limitation in three places.

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
async function repo(withExecutable: boolean): Promise<{ dir: string; git: (a: string[]) => Promise<{ out: string; code: number }> }> {
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
