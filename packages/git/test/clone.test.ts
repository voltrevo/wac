// A clone from a real server, judged by `git fsck` and `git status`.
//
//     deno test -A packages/git/test/clone.test.ts
//
// `design/system/0005` step 8 — the row that closes the document. Everything it uses was measured
// separately: the tunnel against Squid, the trust store against `host/connect.ts`, the advertisement
// against `git ls-remote`, the pack against content addressing, the index against git's own `.idx` byte
// for byte, the checkout against `git status` on a repository git made. **None of that says they compose
// into a repository**, and this is the only test that asks.
//
// **It downloads about 1.6MB**, which is why it clones at `depth 1` and is skipped without a proxy.
//
// ## What is asserted, and why each one is not redundant
//
// `git fsck` clean says every object is present and every link resolves. `git status` says our index and
// our working tree agree with the commit — and it is allowed exactly one kind of difference, the
// executable bit `packages/fs` cannot set, which the test does not merely tolerate: every line git
// reports has to be a file whose *index* mode is `100755`, and the count has to equal what the program
// itself warned about. A limitation that is reported and a limitation that is discovered are different
// things, and this is where they are held to being the same.
//
// And `.git/shallow` gets a canary. A deepened fetch yields a commit whose parent is absent, so that file
// is the only thing standing between this and a repository git calls broken — remove it and `git fsck`
// must fail, or the file is not doing the work this claims it does.

import { buildApp } from "../../platform/build.ts";

const dec = new TextDecoder();

const REMOTE = "https://github.com/ethereum/eth2.0-specs.git";

const haveGit = await (async () => {
  try {
    return (await new Deno.Command("git", { args: ["--version"], stdout: "null", stderr: "null" })
      .output()).success;
  } catch {
    return false;
  }
})();
const proxy = Deno.env.get("HTTP_PROXY") ?? "";
const skip = !haveGit || proxy === "";
if (skip) {
  console.error(`git clone tests: skipped — ${!haveGit ? "no `git` on PATH" : "HTTP_PROXY is not set"}`);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

Deno.test({
  name: "a clone from a real server is a repository git calls correct",
  ignore: skip,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-git-clone-" });
    const exe = await Deno.makeTempFile({ prefix: "gitclone-" });
    const git = async (args: string[]) => {
      const r = await new Deno.Command("git", { args, cwd: dir, stdout: "piped", stderr: "piped" })
        .output();
      // **`raw` exists because porcelain's first column is a space.** Trimming turns ` M path` into
      // `M path` and loses which side disagrees — index-vs-HEAD or worktree-vs-index. That distinction
      // is the whole point of the mode assertion below, and this is the second test in this package to
      // be caught by it.
      return {
        out: dec.decode(r.stdout).trim(),
        raw: dec.decode(r.stdout),
        err: dec.decode(r.stderr).trim(),
        code: r.code,
      };
    };
    try {
      await buildApp("packages/git/example/gitclone.wac", exe, {
        net: true,
        env: true,
        read: true,
        write: true,
      });
      await Deno.chmod(exe, 0o755);
      const r = await new Deno.Command(exe, {
        args: [REMOTE, dir, "1"],
        stdout: "piped",
        stderr: "piped",
      }).output();
      const out = dec.decode(r.stdout).trim();
      const warned = dec.decode(r.stderr).trim();
      assert(r.code === 0, `gitclone failed (${r.code}): ${warned}`);

      // What the program says it did, so the assertions below can be compared against its own claim
      // rather than only against git's opinion.
      const objects = Number(out.match(/^(\d+) objects in (\d+) bytes$/m)?.[1] ?? "0");
      const files = Number(out.match(/^(\d+) files on (\S+)$/m)?.[1] ?? "0");
      const branch = out.match(/^\d+ files on (\S+)$/m)?.[1] ?? "";
      assert(objects > 100, `a pack of ${objects} objects is too small to be this repository's`);
      assert(files > 100, `a checkout of ${files} files is too small`);
      assert(branch.startsWith("refs/heads/"), `the branch is ${JSON.stringify(branch)}`);

      // **git's verdict on the objects.** Clean means every object is there and every link resolves.
      const fsck = await git(["fsck"]);
      assert(fsck.code === 0, `git fsck refused the clone: ${fsck.err || fsck.out}`);

      // **git's verdict on the working tree**, allowed one kind of difference and no other.
      const status = await git(["status", "--porcelain"]);
      const lines = status.raw === "" ? [] : status.raw.replace(/\n$/, "").split("\n");
      const modeWarned = Number(warned.match(/(\d+) file\(s\) wanted the executable bit/)?.[1] ?? "0");
      assert(
        lines.length === modeWarned,
        `git reports ${lines.length} difference(s) and the program warned about ${modeWarned}:\n${status.out}`,
      );
      for (const line of lines) {
        assert(line.startsWith(" M "), `an unexpected kind of difference: ${JSON.stringify(line)}`);
        const path = line.slice(3);
        const staged = await git(["ls-files", "-s", "--", path]);
        assert(
          staged.out.startsWith("100755 "),
          `${path} differs and is not an executable in the index: ${JSON.stringify(staged.out)}`,
        );
      }

      // HEAD is symbolic and resolves — a clone whose HEAD named a branch that did not exist would
      // still pass fsck.
      const symbolic = await git(["symbolic-ref", "HEAD"]);
      assert(symbolic.code === 0 && symbolic.out === branch, `HEAD is ${JSON.stringify(symbolic.out)}`);
      const resolved = await git(["rev-parse", "HEAD"]);
      assert(/^[0-9a-f]{40}$/.test(resolved.out), `HEAD does not resolve: ${resolved.out}`);

      // The pack is named the way git names one: the stem is the pack's own trailing SHA-1.
      const packs = [...Deno.readDirSync(`${dir}/.git/objects/pack`)].map((e) => e.name).sort();
      assert(packs.length === 2, `expected a .pack and a .idx, found ${JSON.stringify(packs)}`);
      const stem = packs[0].replace(/\.(idx|pack)$/, "");
      const packBytes = await Deno.readFile(`${dir}/.git/objects/pack/${stem}.pack`);
      const trailer = [...packBytes.subarray(packBytes.length - 20)]
        .map((b) => b.toString(16).padStart(2, "0")).join("");
      assert(stem === `pack-${trailer}`, `the pack is ${stem} and its trailing hash is ${trailer}`);

      // **The shape that makes this a shallow clone, and the canary that says the file matters.**
      const shallow = await Deno.readTextFile(`${dir}/.git/shallow`);
      assert(/^[0-9a-f]{40}\n$/m.test(shallow), `.git/shallow is ${JSON.stringify(shallow)}`);
      await Deno.rename(`${dir}/.git/shallow`, `${dir}/.git/shallow.away`);
      const without = await git(["fsck"]);
      assert(
        without.code !== 0 || /broken link|missing commit/.test(without.err + without.out),
        "removing .git/shallow left git happy, so that file is not what makes this clone valid",
      );
      await Deno.rename(`${dir}/.git/shallow.away`, `${dir}/.git/shallow`);
      assert((await git(["fsck"])).code === 0, "putting .git/shallow back did not restore fsck");

      // The checkout reached into subdirectories, not just the root.
      const nested = await git(["ls-files"]);
      assert(
        nested.out.split("\n").some((p) => p.split("/").length > 2),
        "nothing in the checkout is more than one directory deep",
      );
    } finally {
      await Deno.remove(exe).catch(() => {});
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  },
});
