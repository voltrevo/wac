// The config search, against the files real git reads — driven through `gitci`, which is what needs it.
//
//     deno test -A packages/git/test/configchain.test.ts
//
// `gitci` used to read `.git/config` and nothing else, so it refused to commit for a user whose identity
// is in `~/.gitconfig` — which is where essentially everyone's is. That is the defect this pins, and the
// oracle is not a claim about which file was read: it is `git log`, reporting the author of a commit our
// program wrote.
//
// ## The fixture makes all four levels disagree
//
// A test where only one file sets `user.name` passes against a reader that searches in the wrong order, or
// that stops at the first file it finds. So every level names a *different* author and the test walks down
// them, removing one at a time and requiring the next to take over:
//
//     .git/config                      LOCAL      <- wins while present
//     ~/.gitconfig                     DOTFILE
//     ~/.config/git/config             XDG
//     /etc/gitconfig                   (not written — see below)
//
// The system file is the one level this cannot write, since `/etc` is not ours to touch in a test; it is
// covered by `$GIT_CONFIG_SYSTEM` in the probe that established the order, and named here as untested
// rather than quietly counted.
//
// **`user.email` is left set only at the XDG level throughout.** That is what proves the levels merge per
// *key* rather than per file: if the dotfile replaced the XDG file instead of layering over it, the email
// would vanish the moment the dotfile appeared and `gitci` would refuse.

// Imported for its side effect: retries a spawn that fails with "Text file busy", and installs the
// `WAC_PROFILE` coverage wrapper. Both need to happen before `Deno.test` registers anything, which is
// why it is a static import here rather than something the builder could arrange. issues/system 0074.
import "../../../harness/spawnRetry.ts";
// **Host-side because it needs `HOME` and `XDG_CONFIG_HOME` set for a child, and `Cli.exec` passes
// no environment.** Which config file git reads *is* the subject here, so naming the files on a
// command line would be testing a different program. `issues/system/0181`.
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
if (!haveGit) console.error("git config-chain tests: skipped — no `git` on PATH");

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

let exePath: string | null = null;
async function gitci(): Promise<string> {
  if (exePath === null) {
    exePath = await Deno.makeTempFile({ prefix: "gitci-chain-" });
    await buildApp("packages/git/example/gitci.wac", exePath, { read: true, write: true, env: true });
    await Deno.chmod(exePath, 0o755);
  }
  return exePath;
}

Deno.test({
  name: "an identity in ~/.gitconfig is enough to commit, and the local file still wins",
  ignore: !haveGit,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-git-chain-" });
    const home = await Deno.makeTempDir({ prefix: "wac-git-chome-" });
    const env = {
      HOME: home,
      XDG_CONFIG_HOME: `${home}/.config`,
      GIT_AUTHOR_DATE: "1700000000 +0000",
      PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin",
    };
    const git = async (args: string[]) => {
      const r = await new Deno.Command("git", {
        args: ["-C", dir, ...args],
        env,
        clearEnv: true,
        stdout: "piped",
        stderr: "piped",
      }).output();
      return { text: dec.decode(r.stdout).trim(), err: dec.decode(r.stderr).trim(), ok: r.success };
    };
    const commit = async (file: string) => {
      await Deno.writeTextFile(`${dir}/${file}`, `${file}\n`);
      return await new Deno.Command(await gitci(), {
        args: [dir, `add ${file}`],
        env,
        stdout: "piped",
        stderr: "piped",
      }).output();
    };

    try {
      const init = await git(["init", "-q", "-b", "main", "."]);
      assert(init.ok, `git init: ${init.err}`);
      await Deno.mkdir(`${home}/.config/git`, { recursive: true });
      // The email lives only here, all the way through, so a level that replaced rather than layered
      // would take it away and turn every commit below into a refusal.
      await Deno.writeTextFile(`${home}/.config/git/config`, "[user]\n\tname = XDG\n\temail = xdg@example.com\n");
      await Deno.writeTextFile(`${home}/.gitconfig`, "[user]\n\tname = DOTFILE\n");
      await Deno.writeTextFile(`${dir}/.git/config`,
        await Deno.readTextFile(`${dir}/.git/config`) + "[user]\n\tname = LOCAL\n");

      // **git's own answer first**, so the fixture is known to make the levels disagree before ours is
      // compared to anything.
      const theirName = await git(["config", "user.name"]);
      const theirMail = await git(["config", "user.email"]);
      assert(theirName.text === "LOCAL", `git does not prefer the local file: ${theirName.text}`);
      assert(theirMail.text === "xdg@example.com", `the XDG email did not survive the dotfile: ${theirMail.text}`);

      const r1 = await commit("a.txt");
      assert(r1.code === 0, `gitci refused with a full chain: ${dec.decode(r1.stderr).trim()}`);
      const a1 = await git(["log", "-1", "--format=%an <%ae>"]);
      assert(a1.text === "LOCAL <xdg@example.com>", `wrong author with all levels set: ${a1.text}`);

      // Drop the local file's identity: the dotfile takes over, for git and for us.
      await Deno.writeTextFile(`${dir}/.git/config`,
        (await Deno.readTextFile(`${dir}/.git/config`)).replace("[user]\n\tname = LOCAL\n", ""));
      assert((await git(["config", "user.name"])).text === "DOTFILE", "git did not fall back to ~/.gitconfig");
      const r2 = await commit("b.txt");
      assert(r2.code === 0, `gitci refused with the identity in ~/.gitconfig: ${dec.decode(r2.stderr).trim()}`);
      const a2 = await git(["log", "-1", "--format=%an <%ae>"]);
      assert(a2.text === "DOTFILE <xdg@example.com>", `wrong author from the dotfile: ${a2.text}`);

      // And drop that too: the XDG file is the last one standing.
      await Deno.remove(`${home}/.gitconfig`);
      assert((await git(["config", "user.name"])).text === "XDG", "git did not fall back to the XDG file");
      const r3 = await commit("c.txt");
      assert(r3.code === 0, `gitci refused with the identity in the XDG file: ${dec.decode(r3.stderr).trim()}`);
      const a3 = await git(["log", "-1", "--format=%an <%ae>"]);
      assert(a3.text === "XDG <xdg@example.com>", `wrong author from the XDG file: ${a3.text}`);

      // With nothing set anywhere it must still **refuse** rather than invent one — the behaviour the
      // previous commit established, which a wider search must not quietly undo.
      await Deno.remove(`${home}/.config/git/config`);
      assert(!(await git(["config", "user.name"])).ok, "git still finds an identity after every file is gone");
      const r4 = await commit("d.txt");
      assert(r4.code !== 0, "gitci invented an author once no file set one");
      const count = await git(["rev-list", "--count", "HEAD"]);
      assert(count.text === "3", `a refused commit still landed: ${count.text} commits`);

      // Every commit above is one git can read, not merely one it accepted at write time.
      const fsck = await git(["fsck", "--strict"]);
      assert(fsck.ok, `fsck refused the commits: ${fsck.err}`);
    } finally {
      await Deno.remove(dir, { recursive: true });
      await Deno.remove(home, { recursive: true });
    }
  },
});
