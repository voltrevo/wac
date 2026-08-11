// `.git/index`, against git's own.
//
//     deno test -A packages/git/test/index.test.ts
//
// ## The oracle is `git status`, and it is the right one
//
// An index is not interesting in itself — it is interesting because git compares it against the working
// tree and the commit. So the test is: **replace git's index with ours and ask git whether the
// repository is still clean.** If any field is wrong the answer changes, and it changes in a way that
// names the file.
//
// That covers more than a field-by-field comparison would. `git status` reads the mode, the object name,
// the path and the entry order, and it re-hashes anything whose stat data does not match — so an index
// that parses and re-serialises correctly but sorts wrongly, or loses an extension, fails here.
//
// ## The stat fields are zeros on purpose
//
// `packages/fs` cannot answer `ctime`, `dev`, `ino` or `uid`. It does not need to: the test below
// asserts that zeroing every stat field of *git's own* index leaves `git status` empty, which is the
// measurement `design/system/0005` records as settling that risk. git treats the field as a cache, so a
// miss costs it a re-read rather than costing us correctness.

import { wacBind } from "../../../harness/wacBind.ts";

const dec = new TextDecoder();

const haveGit = await (async () => {
  try {
    return (await new Deno.Command("git", { args: ["--version"], stdout: "null", stderr: "null" })
      .output()).success;
  } catch {
    return false;
  }
})();
if (!haveGit) console.error("git index tests: skipped — no `git` on PATH");

// deno-lint-ignore no-explicit-any
const ix = await wacBind("packages/git/src/index.wac") as any;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/**
 * A repository whose index holds the shapes an index reader gets wrong.
 *
 * A subdirectory, because the path is stored whole and sorting is by raw bytes — so `sub/b.txt` must
 * come after `exec.sh` and a reader that sorted by component would disagree. An executable, because the
 * mode is a field rather than a flag. A path long enough that its own length field is exercised.
 */
async function staged(): Promise<{ dir: string; git: (a: string[]) => Promise<{ out: string; code: number }> }> {
  const dir = await Deno.makeTempDir({ prefix: "wac-git-index-" });
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
  await Deno.mkdir(`${dir}/sub`, { recursive: true });
  await Deno.writeTextFile(`${dir}/a.txt`, "one\n");
  await Deno.writeTextFile(`${dir}/sub/b.txt`, "two\n");
  await Deno.writeTextFile(`${dir}/exec.sh`, "#!/bin/sh\n");
  await Deno.chmod(`${dir}/exec.sh`, 0o755);
  await Deno.writeTextFile(`${dir}/a-rather-long-path-name-that-exercises-the-length-field.txt`, "long\n");
  await git(["add", "-A"]);
  await git(["commit", "-qm", "one"]);
  return { dir, git };
}

Deno.test({
  name: "an index we wrote leaves `git status` as clean as git's own did",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git } = await staged();
    try {
      assert((await git(["status", "--porcelain"])).out === "", "the fixture was not clean to begin with");

      const parsed = ix.parseIndex(await Deno.readFile(`${dir}/.git/index`));
      assert(parsed.tag === "Present", `git's index did not parse: ${parsed.tag === "Unreadable" ? parsed.Unreadable_why : ""}`);
      const idx = parsed.Present_index;

      // What git says is in the index, in git's order, so a reader that lost or reordered one fails.
      const want = (await git(["ls-files"])).out.split("\n");
      assert(idx.entries.len() === want.length, `we read ${idx.entries.len()} entries, ls-files lists ${want.length}`);
      for (let i = 0; i < want.length; i++) {
        assert(idx.entries.get(i).path === want[i], `entry ${i}: we say ${idx.entries.get(i).path}, git says ${want[i]}`);
      }

      // Modes and object names, against `ls-files --stage`, which prints both.
      const stage = new Map<string, string>();
      for (const line of (await git(["ls-files", "--stage"])).out.split("\n")) {
        const [meta, path] = line.split("\t");
        const [mode, sha] = meta.split(/\s+/);
        stage.set(path, `${mode} ${sha}`);
      }
      for (let i = 0; i < idx.entries.len(); i++) {
        const e = idx.entries.get(i);
        const mine = `${e.mode.toString(8).padStart(6, "0")} ${e.nameHex()}`;
        assert(stage.get(e.path) === mine, `${e.path}: we read ${mine}, git says ${stage.get(e.path)}`);
        assert(e.stage === 0, `${e.path}: stage ${e.stage} on an unconflicted entry`);
      }

      // **The test that matters**: hand our own bytes back and let git judge them.
      await Deno.writeFile(`${dir}/.git/index`, Uint8Array.from(ix.writeIndex(idx)));
      assert(
        (await git(["status", "--porcelain"])).out === "",
        `git called the repository dirty after reading our index: ${(await git(["status", "--porcelain"])).out}`,
      );
      assert((await git(["ls-files"])).out.split("\n").join(",") === want.join(","), "ls-files differs after our write");
      assert((await git(["fsck"])).code === 0, "git fsck failed after our index was written");

      // The canary. Every assertion above is "git agrees", and git agreeing with an index it silently
      // rebuilt would prove nothing — so an index missing an entry must make git *disagree*.
      const short = ix.parseIndex(await Deno.readFile(`${dir}/.git/index`)).Present_index;
      const trimmed = Uint8Array.from(ix.writeIndex(short));
      // Claim one fewer entry than follows, which is a corrupt index rather than a shorter one.
      trimmed[11] = trimmed[11] - 1;
      // Not asked of git: it rebuilds a damaged index on the next read, so it would report clean and
      // prove nothing. The check that means something is that *we* refuse what we would not have
      // written — the count no longer matches the body, and the checksum no longer matches either.
      assert(ix.parseIndex(trimmed).tag === "Unreadable", "an index whose checksum no longer matches was accepted");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "a zeroed stat cache still leaves git clean, which is why we may write zeros",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git } = await staged();
    try {
      // Zero every stat field of *git's own* index and repair the trailing SHA-1. This is the
      // measurement `design/system/0005` rests on, kept as a test so the plan cannot quietly stop
      // being true: if a future git trusts these fields, this fails and says so.
      const b = await Deno.readFile(`${dir}/.git/index`);
      const n = (b[8] << 24) | (b[9] << 16) | (b[10] << 8) | b[11];
      let at = 12;
      for (let e = 0; e < n; e++) {
        for (let i = 0; i < 24; i++) b[at + i] = 0;   // ctime, mtime, dev, ino
        for (let i = 28; i < 36; i++) b[at + i] = 0;  // uid, gid
        const nameLen = ((b[at + 60] << 8) | b[at + 61]) & 0x0fff;
        const used = 62 + nameLen;
        at += used + (8 - (used % 8));
      }
      const sum = new Uint8Array(await crypto.subtle.digest("SHA-1", b.subarray(0, b.length - 20)));
      b.set(sum, b.length - 20);
      await Deno.writeFile(`${dir}/.git/index`, b);

      assert(
        (await git(["status", "--porcelain"])).out === "",
        "git called the repository dirty once the stat cache was zeroed — `index.wac` writing zeros is " +
          "no longer sound, and design/system/0005 step 4's criterion has to change",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test("an index that is not one is refused rather than half-read", () => {
  const enc = new TextEncoder();
  assert(ix.parseIndex(new Uint8Array(8)).tag === "Unreadable", "a truncated index was accepted");
  assert(ix.parseIndex(enc.encode("XXXX" + "\0".repeat(40))).tag === "Unreadable", "a bad signature was accepted");

  // Version 4 prefix-compresses paths, so reading it as version 2 gives one correct path and then
  // nonsense — refusing is the only honest option for a reader that does not implement it.
  const v4 = new Uint8Array(12 + 20);
  v4.set(enc.encode("DIRC"), 0);
  v4[7] = 4;
  assert(ix.parseIndex(v4).tag === "Unreadable", "a version-4 index was accepted");
});
