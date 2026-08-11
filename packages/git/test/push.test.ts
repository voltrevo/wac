// A push to real `git receive-pack`, judged by whether the ref moved and `git fsck` accepts what arrived.
//
//     deno test -A packages/git/test/push.test.ts
//
// `design/system/0005` ruled push out because authentication was a non-goal — true of GitHub, and not true
// of pushing at all. `git receive-pack` over a pipe asks for no credentials, so the whole conversation is
// arrangeable here and every piece of it has an oracle. It is also what finally gives `writePack` a caller:
// step 7 built a pack writer and nothing sent one anywhere.
//
// ## What each assertion is for
//
// The **report** says the server accepted it — `unpack ok`, then `ok <ref>`. A push can unpack perfectly and
// still have every ref refused, so reading the report is the only way to tell those apart, and a client that
// checked the exit status would call a rejected push a success.
//
// The **ref** having moved says the server did it, not that it said it would.
//
// **`git fsck` in the target** says the pack we wrote is a repository's worth of objects and not just bytes
// that unpacked: every object present, every link resolving, every name the hash of its content.
//
// And **`git log` in the target** says the history arrived in order, not merely that the tip is there.

import { wacBind } from "../../../harness/wacBind.ts";
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
if (!haveGit) console.error("git push tests: skipped — no `git` on PATH");

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const recv = await wacBind("packages/git/src/receive.wac") as any;
const fetchmod = await wacBind("packages/git/src/fetch.wac") as any;

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));

Deno.test({
  name: "a pack we wrote, pushed to `git receive-pack`, moves the ref it was told to",
  ignore: !haveGit,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-git-push-" });
    const src = `${dir}/src`;
    const target = `${dir}/target.git`;
    const git = async (args: string[], cwd = src) => {
      const r = await new Deno.Command("git", {
        args,
        cwd,
        stdout: "piped",
        stderr: "piped",
        env: {
          GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: "a@b", GIT_AUTHOR_DATE: "1700000000 +0000",
          GIT_COMMITTER_NAME: "a", GIT_COMMITTER_EMAIL: "a@b", GIT_COMMITTER_DATE: "1700000000 +0000",
          PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: dir,
        },
        clearEnv: true,
      }).output();
      return { out: r.stdout, text: dec.decode(r.stdout).trim(), err: dec.decode(r.stderr).trim(), code: r.code };
    };
    try {
      await Deno.mkdir(src);
      // `-b main` so the bare repository's HEAD names the branch being pushed; otherwise `git fsck` adds a
      // notice about an unborn `master`, which is noise rather than a finding.
      await new Deno.Command("git", { args: ["init", "-q", "--bare", "-b", "main", target], stdout: "null", stderr: "null" }).output();
      await git(["init", "-q", "-b", "main"]);
      // **Two commits and a subdirectory**, so the walk has to follow a parent and descend a tree. One
      // commit over one file would exercise neither, and a pack of three objects would pass while a
      // reachability walk that ignored parents was broken.
      await Deno.mkdir(`${src}/sub`);
      await Deno.writeTextFile(`${src}/a.txt`, "one\n");
      await Deno.writeTextFile(`${src}/sub/b.txt`, "two\n");
      await git(["add", "-A"]);
      await git(["commit", "-qm", "one"]);
      await Deno.writeTextFile(`${src}/a.txt`, "two\n");
      await git(["add", "-A"]);
      await git(["commit", "-qm", "two"]);
      const tip = (await git(["rev-parse", "HEAD"])).text;

      // What git says has to travel, so the walk below is compared against it rather than trusted.
      const wanted = new Set(
        (await git(["rev-list", "--objects", "HEAD"])).text.split("\n").map((l) => l.split(" ")[0]),
      );
      assert(wanted.size >= 7, `only ${wanted.size} objects; the fixture is too thin for two commits`);

      // ── The advertisement ──
      const adv = await new Deno.Command("git", {
        args: ["receive-pack", target],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }).output();
      const ad = fetchmod.parseAdvertisement(adv.stdout);
      assert(ad.tag === "Said", `the advertisement did not parse: ${ad.tag}`);
      // **An empty repository advertises one line that is not a ref**, asserted rather than assumed — a
      // client treating it as a branch would try to update something called `capabilities^{}`. Asked with
      // the bytes, because a parsed `Advertised` cannot cross from `fetch.wac`'s wasm instance to
      // `receive.wac`'s; `noRefsIn` exists for that.
      assert(recv.noRefsIn(adv.stdout) === true, "an empty repository was not recognised as having no refs");

      // ── The request, written by our program ──
      const exe = await Deno.makeTempFile({ prefix: "gitpush-" });
      await buildApp("packages/git/example/gitpush.wac", exe, { read: true, write: true });
      await Deno.chmod(exe, 0o755);
      await Deno.writeFile(`${dir}/adv.bin`, adv.stdout);
      const built = await new Deno.Command(exe, {
        args: [src, `${dir}/adv.bin`, "refs/heads/main"],
        stdout: "piped",
        stderr: "piped",
      }).output();
      const note = dec.decode(built.stderr).trim();
      assert(built.code === 0, `gitpush failed: ${note}`);
      const request = built.stdout;
      assert(request.length > 0, "gitpush wrote no request");

      // **The object count against git's own**, because a walk that missed a parent's tree still produces a
      // pack the server unpacks and a ref update that succeeds — the history would simply be incomplete,
      // which `git fsck` in the target would then catch. Comparing here says *which* step was wrong.
      const counted = Number(note.match(/(\d+) objects/)?.[1] ?? "0");
      assert(
        counted === wanted.size,
        `we walked ${counted} objects and git says ${wanted.size} are reachable`,
      );

      // The request is the update commands and then a pack, which is what makes it pipeable straight back.
      assert(
        dec.decode(request.subarray(0, 4)) !== "PACK",
        "the request starts with a pack; the update commands are missing",
      );
      const packAt = (() => {
        for (let i = 0; i + 4 <= request.length; i++) {
          if (dec.decode(request.subarray(i, i + 4)) === "PACK") return i;
        }
        return -1;
      })();
      assert(packAt > 0, "no pack in the request");

      // ── The push ──
      const rp = new Deno.Command("git", {
        args: ["receive-pack", target],
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const w = rp.stdin.getWriter();
      await w.write(request);
      await w.close();
      const said = await rp.output();

      // The reply repeats the advertisement before the report, so the report starts after it.
      const report = recv.readReport(said.stdout.subarray(adv.stdout.length));
      assert(report.garbled === "", `the report did not parse: ${report.garbled}`);
      assert(report.unpacked === true, `the server could not unpack our pack: ${report.unpackWhy}`);
      assert(report.refs.len() === 1, `expected one ref in the report, got ${report.refs.len()}`);
      const one = report.refs.get(0);
      assert(one.name === "refs/heads/main", `the report names ${JSON.stringify(one.name)}`);
      assert(one.ok === true, `the server refused the ref: ${one.why}`);
      await Deno.remove(exe).catch(() => {});

      // ── And what the target actually has now ──
      const moved = await git(["rev-parse", "refs/heads/main"], target);
      assert(moved.text === tip, `the ref is ${moved.text} and we pushed ${tip}`);
      const fsck = await git(["fsck"], target);
      assert(fsck.code === 0, `git fsck refused the pushed repository: ${fsck.err || fsck.text}`);
      const log = await git(["log", "--format=%s", "refs/heads/main"], target);
      assert(log.text === "two\none", `the history arrived as ${JSON.stringify(log.text)}`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test("a report of a refused ref keeps the server's own words", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const pkt = (s: string) => `${(s.length + 4).toString(16).padStart(4, "0")}${s}`;
  const reply = pkt("unpack ok\n") + pkt("ng refs/heads/main non-fast-forward\n") + "0000";
  const r = recv.readReport(enc(reply));
  assert(r.garbled === "", `did not parse: ${r.garbled}`);
  assert(r.unpacked === true, "unpack ok was not read");
  assert(r.refs.len() === 1 && r.refs.get(0).ok === false, "the refusal was read as an acceptance");
  // The reason is the part a caller needs: "the push failed" and "you are not up to date" are different
  // things to be told.
  assert(
    r.refs.get(0).why === "non-fast-forward",
    `the reason came back as ${JSON.stringify(r.refs.get(0).why)}`,
  );
});

Deno.test("a pack the server cannot read is reported as such, not as a refused ref", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const pkt = (s: string) => `${(s.length + 4).toString(16).padStart(4, "0")}${s}`;
  const r = recv.readReport(enc(pkt("unpack index-pack failed\n") + "0000"));
  assert(r.unpacked === false, "a failed unpack was read as a success");
  assert(r.unpackWhy === "index-pack failed", `the reason is ${JSON.stringify(r.unpackWhy)}`);
});
