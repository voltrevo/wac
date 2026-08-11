// An incremental fetch from real `git upload-pack`, and the thin pack it sends back.
//
//     deno test -A packages/git/test/pull.test.ts
//
// Every other fetch here starts from an empty directory, says no `have`, and gets whole objects. This one
// starts from a repository that already holds most of the history, says what it has, and the server
// answers with **deltas against objects that are not in the pack** — a thin pack, which `git index-pack`
// refuses outright. Repairing it from the local store is what `completeThin` is for, and until now
// nothing had ever sent one at it: step 7 built the repair and the caller was missing.
//
// ## Why this is arrangeable when the README said it was not
//
// `packages/git` recorded a thin pack from a real server as unarrangeable. That was measured against
// GitHub with a `deepen`, which returns whole objects — true of the case tried, and not true of the
// protocol. An **incremental** fetch is a different conversation: `have` is what invites the server to
// deltify. `git upload-pack` over a pipe asks for no credentials, the same reason push was arrangeable.
//
// ## What each assertion is for
//
// The **fixture's shape comes first**: `git index-pack` must *refuse* the raw reply. A test that skipped
// that would pass just as happily against a server that had sent whole objects, which is the exact
// failure this file exists to avoid — the repair would never run and nothing would say so.
//
// Then ours: the program reports how many bases it appended, `git fsck` accepts the repository
// afterwards, and the commit that was fetched is readable through `git cat-file`. `fsck` is the one that
// matters, because a pack completed wrongly still writes a file and still has a plausible name.

// Imported for its side effect: retries a spawn that fails with "Text file busy", and installs the
// `WAC_PROFILE` coverage wrapper. issues/system 0074.
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
if (!haveGit) console.error("git pull tests: skipped — no `git` on PATH");

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

let exePath: string | null = null;
async function gitpull(): Promise<string> {
  if (exePath === null) {
    exePath = await Deno.makeTempFile({ prefix: "gitpull-" });
    await buildApp("packages/git/example/gitpull.wac", exePath, { read: true, write: true });
    await Deno.chmod(exePath, 0o755);
  }
  return exePath;
}
addEventListener("unload", () => {
  if (exePath !== null) {
    try {
      Deno.removeSync(exePath);
    } catch { /* already gone */ }
  }
});

Deno.test({
  name: "a thin pack from `git upload-pack`, completed from the local store and written",
  ignore: !haveGit,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-git-pull-" });
    const src = `${dir}/src`;
    const mine = `${dir}/mine`;
    const env = {
      GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: "a@b", GIT_AUTHOR_DATE: "1700000000 +0000",
      GIT_COMMITTER_NAME: "a", GIT_COMMITTER_EMAIL: "a@b", GIT_COMMITTER_DATE: "1700000000 +0000",
      PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: dir,
    };
    const git = async (args: string[], cwd = src) => {
      const r = await new Deno.Command("git", { args, cwd, env, clearEnv: true, stdout: "piped", stderr: "piped" })
        .output();
      return { out: dec.decode(r.stdout).trim(), err: dec.decode(r.stderr).trim(), code: r.code };
    };

    try {
      // **A history whose later commits deltify against earlier ones.** The file keeps a long common
      // body and changes one line, which is what makes a delta worth sending — five unrelated files
      // would give the server nothing to compress against and no thin pack to send.
      await Deno.mkdir(src);
      await git(["init", "-q", "-b", "main", "."]);
      const body = "x".repeat(400);
      for (let i = 1; i <= 5; i++) {
        await Deno.writeTextFile(`${src}/f.txt`, `line ${i}\n${body}\n`);
        await git(["add", "-A"]);
        await git(["commit", "-qm", `c${i}`]);
      }
      const tip = (await git(["rev-parse", "HEAD"])).out;
      const behind = (await git(["rev-parse", "HEAD~2"])).out;

      // Our repository: the same history minus the last two commits.
      const cloned = await new Deno.Command("git", {
        args: ["clone", "-q", "--no-local", src, mine],
        env,
        clearEnv: true,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(cloned.success, `clone failed: ${dec.decode(cloned.stderr)}`);
      await git(["reset", "-q", "--hard", behind], mine);
      // **The reflog keeps the discarded commits reachable**, so `gc --prune=now` alone prunes nothing
      // and the repository still holds the tip it is about to fetch. Found by the assertion below, which
      // is the whole reason it is there: without it this test would have fetched a pack of objects it
      // already had and called that a success.
      await git(["remote", "remove", "origin"], mine);
      await git(["reflog", "expire", "--expire=now", "--expire-unreachable=now", "--all"], mine);
      await git(["gc", "-q", "--prune=now", "--aggressive"], mine);
      assert((await git(["rev-parse", "HEAD"], mine)).out === behind, "our repository is not two commits behind");
      assert(
        (await git(["cat-file", "-e", `${tip}^{commit}`], mine)).code !== 0,
        "our repository already holds the commit it is about to fetch, so nothing would be fetched",
      );

      // The advertisement, from real `git upload-pack`.
      const adv = await new Deno.Command("git", {
        args: ["upload-pack", "--advertise-refs", src],
        env,
        clearEnv: true,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(adv.success, `upload-pack --advertise-refs failed: ${dec.decode(adv.stderr)}`);
      await Deno.writeFile(`${dir}/adv.bin`, adv.stdout);

      // Phase one: our request, with a `have`.
      const req = await new Deno.Command(await gitpull(), {
        args: ["request", mine, "refs/heads/main", `${dir}/adv.bin`],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(req.code === 0, `gitpull request failed: ${dec.decode(req.stderr).trim()}`);
      const requestBytes = req.stdout;
      const asText = dec.decode(requestBytes);
      // **The `have` is the point of the request**, so it is checked rather than assumed: without one the
      // server sends whole objects and the rest of this test would prove nothing.
      assert(asText.includes(`have ${behind}`), `the request carries no have for what we hold:\n${asText}`);
      assert(asText.includes(`want ${tip}`), `the request does not want the tip:\n${asText}`);
      assert(asText.includes("thin-pack"), "the request does not ask for a thin pack");

      // Phase two: real `git upload-pack` answers it.
      const up = new Deno.Command("git", {
        args: ["upload-pack", "--stateless-rpc", src],
        env,
        clearEnv: true,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const w = up.stdin.getWriter();
      await w.write(requestBytes);
      await w.close();
      const reply = await up.output();
      assert(reply.success, `upload-pack refused the request: ${dec.decode(reply.stderr)}`);
      await Deno.writeFile(`${dir}/reply.bin`, reply.stdout);

      // **The fixture's hard shape, asserted in git's own answer before ours is judged.** The reply must
      // be a pack that plain `git index-pack` cannot resolve — that is what "thin" means, and if the
      // server had sent whole objects this whole test would be vacuous.
      const packAt = reply.stdout.indexOf(0x50); // 'P' of PACK
      const sig = reply.stdout.subarray(packAt, packAt + 4);
      assert(dec.decode(sig) === "PACK", "no packfile in the reply");
      const rawDir = `${dir}/raw`;
      await Deno.mkdir(rawDir);
      await Deno.writeFile(`${rawDir}/got.pack`, reply.stdout.subarray(packAt));
      const refused = await new Deno.Command("git", {
        args: ["index-pack", "got.pack"],
        cwd: rawDir,
        env,
        clearEnv: true,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(
        !refused.success && dec.decode(refused.stderr).includes("unresolved delta"),
        `git accepted the pack, so it is not thin and this test proves nothing: ` +
          `exit ${refused.code}, ${dec.decode(refused.stderr).trim()}`,
      );

      // Ours: complete it from the local store and write it in.
      const applied = await new Deno.Command(await gitpull(), {
        args: ["apply", mine, "refs/heads/main", `${dir}/adv.bin`, `${dir}/reply.bin`],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(applied.code === 0, `gitpull apply failed: ${dec.decode(applied.stderr).trim()}`);
      const said = dec.decode(applied.stdout).trim();
      const appended = Number(said.match(/(\d+) base\(s\) appended/)?.[1] ?? "0");
      assert(appended > 0, `the program appended no bases, so the repair never ran: ${said}`);

      // **git's verdict on what we wrote.** A pack completed wrongly still writes a file with a
      // plausible name; `fsck` is what refuses it.
      const fsck = await git(["fsck", "--strict"], mine);
      assert(fsck.code === 0, `fsck refused the repository after our fetch: ${fsck.err || fsck.out}`);

      // And the objects are really there and readable — the commit we asked for, and its tree.
      assert(
        (await git(["cat-file", "-e", `${tip}^{commit}`], mine)).code === 0,
        "the commit we fetched is not in the repository afterwards",
      );
      const type = await git(["cat-file", "-t", tip], mine);
      assert(type.out === "commit", `the fetched object is a ${type.out}`);
      const blob = await git(["cat-file", "-p", `${tip}:f.txt`], mine);
      assert(blob.out.startsWith("line 5"), `the fetched tree does not hold the tip's file: ${blob.out.slice(0, 40)}`);

      // **`FETCH_HEAD` is what makes this a fetch**, and git reads the file we wrote: `rev-parse` resolves
      // it rather than this test parsing our own output back to itself.
      const fetchHead = await git(["rev-parse", "FETCH_HEAD"], mine);
      assert(fetchHead.out === tip, `FETCH_HEAD is ${fetchHead.out}, not the tip we fetched`);
      // And the branch is deliberately *not* moved: fetching is not merging, and this writes no ref.
      assert(
        (await git(["rev-parse", "refs/heads/main"], mine)).out === behind,
        "the branch moved — a fetch must not fast-forward a ref on its own",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "a fetch of what we already have is refused rather than sent as an empty request",
  ignore: !haveGit,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-git-pull-up-" });
    const src = `${dir}/src`;
    const mine = `${dir}/mine`;
    const env = {
      GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: "a@b", GIT_AUTHOR_DATE: "1700000000 +0000",
      GIT_COMMITTER_NAME: "a", GIT_COMMITTER_EMAIL: "a@b", GIT_COMMITTER_DATE: "1700000000 +0000",
      PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: dir,
    };
    const git = async (args: string[], cwd = src) =>
      await new Deno.Command("git", { args, cwd, env, clearEnv: true, stdout: "piped", stderr: "piped" }).output();
    try {
      await Deno.mkdir(src);
      await git(["init", "-q", "-b", "main", "."]);
      await Deno.writeTextFile(`${src}/a.txt`, "one\n");
      await git(["add", "-A"]);
      await git(["commit", "-qm", "one"]);
      const cloned = await new Deno.Command("git", {
        args: ["clone", "-q", "--no-local", src, mine],
        env,
        clearEnv: true,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(cloned.success, "clone failed");

      const adv = await new Deno.Command("git", {
        args: ["upload-pack", "--advertise-refs", src],
        env,
        clearEnv: true,
        stdout: "piped",
        stderr: "piped",
      }).output();
      await Deno.writeFile(`${dir}/adv.bin`, adv.stdout);

      const r = await new Deno.Command(await gitpull(), {
        args: ["request", mine, "refs/heads/main", `${dir}/adv.bin`],
        stdout: "piped",
        stderr: "piped",
      }).output();
      // Its own exit code, not a failure and not a fetch: asking for what we hold would make the server
      // answer with a pack of nothing, which every layer below would then have to treat as damage.
      assert(r.code === 3, `expected the up-to-date code 3, got ${r.code}: ${dec.decode(r.stderr).trim()}`);
      assert(dec.decode(r.stdout).length === 0, "a request was written for a fetch that has nothing to ask");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
