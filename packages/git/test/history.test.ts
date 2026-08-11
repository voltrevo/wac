// Refs and commits, and the two together: walking a real history.
//
//     deno test -A packages/git/test/history.test.ts
//
// The oracle is `git rev-list`, `git show-ref` and `git cat-file`. What makes this worth more than a
// parser test is the **walk**: resolving `HEAD` to a ref, that ref to a commit, and then following
// parents until a root — because every step feeds the next, and a mistake anywhere ends the walk early
// or takes it somewhere git does not go.
//
// The fixture has a root commit, a merge and a packed-refs file on purpose. All three are shapes a
// parser can be wrong about while working on an ordinary linear history:
//
//   - a **root** commit has no `parent` header at all,
//   - a **merge** has two, and a parser expecting one silently follows only the first,
//   - **`git gc`** deletes the loose ref files and writes `packed-refs`, so a reader that only looks in
//     `refs/` finds nothing afterwards.

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
if (!haveGit) console.error("git history tests: skipped — no `git` on PATH");

// deno-lint-ignore no-explicit-any
const refs = await wacBind("packages/git/src/refs.wac") as any;
// deno-lint-ignore no-explicit-any
const cm = await wacBind("packages/git/src/commit.wac") as any;
// deno-lint-ignore no-explicit-any
const objs = await wacBind("packages/git/src/object.wac") as any;
// deno-lint-ignore no-explicit-any
const pack = await wacBind("packages/git/src/pack.wac") as any;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");
const bin = (h: string) => {
  const u = new Uint8Array(20);
  for (let i = 0; i < 20; i++) u[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return u;
};

/** A repository with a root commit, a merge, and its refs packed. */
async function history(): Promise<{ dir: string; git: (a: string[]) => Promise<string> }> {
  const dir = await Deno.makeTempDir({ prefix: "wac-git-hist-" });
  const git = async (args: string[]) => {
    const r = await new Deno.Command("git", {
      args,
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
      env: {
        GIT_AUTHOR_NAME: "Ada L", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_AUTHOR_DATE: "1700000000 +0000",
        GIT_COMMITTER_NAME: "Ada L", GIT_COMMITTER_EMAIL: "ada@example.com", GIT_COMMITTER_DATE: "1700000000 +0000",
        PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: dir,
      },
      clearEnv: true,
    }).output();
    return dec.decode(r.stdout).trim();
  };
  await git(["init", "-q", "-b", "main"]);
  await Deno.writeTextFile(`${dir}/a.txt`, "one\n");
  await git(["add", "-A"]);
  await git(["commit", "-qm", "root commit"]);
  await git(["checkout", "-qb", "side"]);
  await Deno.writeTextFile(`${dir}/b.txt`, "side\n");
  await git(["add", "-A"]);
  await git(["commit", "-qm", "on the side"]);
  await git(["checkout", "-q", "main"]);
  await Deno.writeTextFile(`${dir}/c.txt`, "main\n");
  await git(["add", "-A"]);
  await git(["commit", "-qm", "on main"]);
  await git(["merge", "-q", "--no-ff", "-m", "the merge", "side"]);
  await git(["gc", "-q"]);
  return { dir, git };
}

/** Read an object by name, loose first and then the pack — the order git looks in. */
async function reader(dir: string) {
  const pd = `${dir}/.git/objects/pack`;
  let p: unknown = null;
  const idxName = [...Deno.readDirSync(pd)].find((e) => e.name.endsWith(".idx"))?.name;
  if (idxName !== undefined) {
    const stem = idxName.replace(/\.idx$/, "");
    const opened = pack.openPack(await Deno.readFile(`${pd}/${stem}.pack`), await Deno.readFile(`${pd}/${stem}.idx`));
    assert(opened.tag === "Ready", "the fixture's pack did not open");
    p = opened.Ready_pack;
  }
  let loose = 0;
  let packed = 0;
  return {
    counts: () => ({ loose, packed }),
    read: async (name: string): Promise<Uint8Array | null> => {
      try {
        const o = objs.readLoose(await Deno.readFile(`${dir}/.git/objects/${name.slice(0, 2)}/${name.slice(2)}`));
        if (o.tag === "Loaded") { loose++; return Uint8Array.from(o.Loaded_content); }
      } catch { /* not loose, try the pack */ }
      if (p === null) return null;
      const got = pack.objectNamed(p, bin(name));
      if (got.tag === "Found") { packed++; return Uint8Array.from(got.Found_data); }
      return null;
    },
  };
}

Deno.test({
  name: "HEAD resolves through a symbolic ref to the commit `rev-parse` names",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git } = await history();
    try {
      const head = refs.parseRef(await Deno.readFile(`${dir}/.git/HEAD`));
      assert(head.tag === "Symbolic", `HEAD read as ${head.tag}, expected Symbolic`);
      assert(head.Symbolic_target === "refs/heads/main", `HEAD points at ${head.Symbolic_target}`);

      // `git gc` packed the refs, so the loose file is gone and `packed-refs` is the only copy — which
      // is exactly the state a reader that only looks in `refs/` gets wrong.
      const packedRefs = refs.parsePackedRefs(await Deno.readFile(`${dir}/.git/packed-refs`));
      assert(packedRefs.len() >= 2, `packed-refs held ${packedRefs.len()} refs, expected at least main and side`);

      const target = refs.packedTarget(packedRefs, "refs/heads/main");
      assert(target !== null, "refs/heads/main is not in packed-refs");
      assert(
        hex(Uint8Array.from(target)) === await git(["rev-parse", "HEAD"]),
        `packed-refs says ${hex(Uint8Array.from(target))}, rev-parse says ${await git(["rev-parse", "HEAD"])}`,
      );

      // Every ref we found must be one git agrees exists, with the same target.
      const want = new Map<string, string>();
      for (const line of (await git(["show-ref"])).split("\n").filter((l) => l.length > 0)) {
        const [sha, name] = line.split(" ");
        want.set(name, sha);
      }
      for (let i = 0; i < packedRefs.len(); i++) {
        const r = packedRefs.get(i);
        assert(want.has(r.name), `we read a ref git does not have: ${r.name}`);
        assert(
          want.get(r.name) === hex(Uint8Array.from(r.target)),
          `${r.name}: we say ${hex(Uint8Array.from(r.target))}, git says ${want.get(r.name)}`,
        );
      }

      // A detached HEAD is the other shape, and it is direct rather than symbolic.
      await git(["checkout", "-q", "--detach"]);
      const detached = refs.parseRef(await Deno.readFile(`${dir}/.git/HEAD`));
      assert(detached.tag === "Direct", `a detached HEAD read as ${detached.tag}`);
      assert(hex(Uint8Array.from(detached.Direct_name)) === await git(["rev-parse", "HEAD"]), "detached HEAD names the wrong commit");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "walking parents from HEAD gives what `rev-list --first-parent` gives",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git } = await history();
    try {
      const r = await reader(dir);
      const packedRefs = refs.parsePackedRefs(await Deno.readFile(`${dir}/.git/packed-refs`));
      const head = refs.parseRef(await Deno.readFile(`${dir}/.git/HEAD`));
      const start = refs.packedTarget(packedRefs, head.Symbolic_target);
      assert(start !== null, "could not resolve HEAD through packed-refs");

      const ours: string[] = [];
      let merges = 0;
      let root = false;
      let cur: string | null = hex(Uint8Array.from(start));
      while (cur !== null) {
        const bytes = await r.read(cur);
        assert(bytes !== null, `${cur} is in neither loose objects nor the pack`);
        const parsed = cm.parseCommit(bytes);
        assert(parsed.tag === "Understood", `${cur} did not parse: ${parsed.tag === "Malformed" ? parsed.Malformed_why : ""}`);
        ours.push(cur);
        const c = parsed.Understood_commit;
        if (c.parents.len() > 1) merges++;
        if (c.parents.len() === 0) { root = true; break; }
        cur = hex(Uint8Array.from(c.parents.get(0)));
      }

      const theirs = (await git(["rev-list", "--first-parent", "HEAD"])).split("\n");
      assert(
        ours.join(",") === theirs.join(","),
        `our walk differs from git's:\n  ours: ${ours.join(" ")}\n  git:  ${theirs.join(" ")}`,
      );

      // The two shapes a linear-history parser gets wrong, both required to have been crossed.
      assert(merges >= 1, "the walk crossed no merge, so the several-parents case is untested");
      assert(root, "the walk did not reach a commit with no parent");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "a commit's fields are the ones git prints",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git } = await history();
    try {
      const r = await reader(dir);
      const head = await git(["rev-parse", "HEAD"]);
      const c = cm.parseCommit((await r.read(head))!).Understood_commit;

      assert(c.treeHex() === await git(["rev-parse", "HEAD^{tree}"]), "the tree does not match rev-parse");
      assert(c.message.split("\n")[0] === await git(["log", "-1", "--format=%s"]), "the subject does not match");
      assert(c.author.name === "Ada L <ada@example.com>", `author read as ${JSON.stringify(c.author.name)}`);
      assert(String(c.author.when) === await git(["log", "-1", "--format=%at"]), "the author timestamp does not match");
      assert(c.author.zone === "+0000", `zone read as ${c.author.zone}`);
      assert(c.committer.name === "Ada L <ada@example.com>", "committer does not match");

      // The merge's parents, in git's order — a set comparison would pass on a reader that reversed them.
      const parents = (await git(["log", "-1", "--format=%P"])).split(" ");
      assert(c.parents.len() === parents.length, `we read ${c.parents.len()} parents, git says ${parents.length}`);
      for (let i = 0; i < parents.length; i++) {
        assert(hex(Uint8Array.from(c.parents.get(i))) === parents[i], `parent ${i} differs`);
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test("a ref file or commit that is not one is refused rather than guessed at", () => {
  const enc = new TextEncoder();

  assert(refs.parseRef(enc.encode("")).tag === "Unparsed", "an empty ref file was accepted");
  assert(refs.parseRef(enc.encode("not a hash\n")).tag === "Unparsed", "a ref that is not a hash was accepted");
  assert(refs.parseRef(enc.encode("z".repeat(40) + "\n")).tag === "Unparsed", "forty non-hex characters were accepted");
  // A trailing newline is optional, and CRLF happens on repositories touched by Windows.
  assert(refs.parseRef(enc.encode("a".repeat(40))).tag === "Direct", "a ref with no trailing newline was refused");
  assert(refs.parseRef(enc.encode("a".repeat(40) + "\r\n")).tag === "Direct", "a CRLF ref was refused");

  // `^<sha>` belongs to the ref above it. A parser treating it as a ref invents one with an empty name.
  const withPeel = enc.encode(
    "# pack-refs with: peeled fully-peeled sorted \n" +
      "b".repeat(40) + " refs/tags/v1\n" +
      "^" + "c".repeat(40) + "\n",
  );
  const parsed = refs.parsePackedRefs(withPeel);
  assert(parsed.len() === 1, `expected one ref, got ${parsed.len()} — the peel or the comment became a ref`);
  assert(parsed.get(0).name === "refs/tags/v1", "the ref name is wrong");
  assert(parsed.get(0).peeled.length === 20, "the peel was not attached to the ref above it");

  assert(cm.parseCommit(enc.encode("tree abc\n\nmsg")).tag === "Malformed", "a short tree was accepted");
  assert(cm.parseCommit(enc.encode("no headers at all")).tag === "Malformed", "headers with no blank line were accepted");
  assert(
    cm.parseCommit(enc.encode("tree " + "a".repeat(40) + "\n\nmsg")).tag === "Malformed",
    "a commit with no author was accepted",
  );
});

Deno.test("a header continued onto the next line does not eat the message", () => {
  // `gpgsig` is indented on every line after the first, and its armour contains a blank line — which is
  // what makes this the case a naive parser loses the message on.
  const enc = new TextEncoder();
  const commit = "tree " + "a".repeat(40) + "\n" +
    "parent " + "b".repeat(40) + "\n" +
    "author Ada L <ada@example.com> 1700000000 +0000\n" +
    "committer Ada L <ada@example.com> 1700000000 +0000\n" +
    "gpgsig -----BEGIN PGP SIGNATURE-----\n" +
    " \n" +
    " iQEzBAABCgAdFiEE\n" +
    " -----END PGP SIGNATURE-----\n" +
    "\n" +
    "the real message\n";
  const p = cm.parseCommit(enc.encode(commit));
  assert(p.tag === "Understood", `a signed commit did not parse: ${p.tag === "Malformed" ? p.Malformed_why : ""}`);
  assert(p.Understood_commit.message === "the real message\n", `message read as ${JSON.stringify(p.Understood_commit.message)}`);
  assert(p.Understood_commit.parents.len() === 1, "the parent was lost");
});
