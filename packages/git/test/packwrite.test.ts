// A pack we wrote, put to the three commands `design/system/0005` step 7 names.
//
//     deno test -A packages/git/test/packwrite.test.ts
//
// `git index-pack` verifies the pack and builds an index for it; `git verify-pack -v` prints every
// object's name, type, size and offset; `git unpack-objects` explodes it into a repository `git fsck` then
// audits. Three commands rather than one because they fail on different things: a wrong varint gives
// `index-pack` a wrong size, a wrong SHA-1 trailer fails it outright, and a pack that is internally
// consistent but holds the wrong bytes only shows up when the objects come back out and are re-hashed.
//
// **The objects come from a repository git built.** Writing objects we invented and reading them back
// would agree with itself; these are git's own bytes for git's own commit, so `unpack-objects` followed by
// `fsck` is a round trip through both implementations.
//
// ## The shape this needs, and why the fixture is what it is
//
// A pack of one blob exercises almost nothing. This one asserts, before writing anything, that its input
// holds **a commit, a tree and a blob** — three of the four type numbers — and **an object over 2,047
// bytes**, which is what forces the size varint past two bytes into a third. Four bits of the size live in
// the first byte and seven in each byte after, so a fixture of small files would leave the continuation
// loop unentered and a writer that emitted only one byte of size would pass.

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
if (!haveGit) console.error("git pack-write tests: skipped — no `git` on PATH");

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const pack = await wacBind("packages/git/src/pack.wac") as any;
const fetchmod = await wacBind("packages/git/src/fetch.wac") as any;

/** The pack format's own type numbers. */
const KIND: Record<string, number> = { commit: 1, tree: 2, blob: 3, tag: 4 };

Deno.test({
  name: "a pack we wrote is one git indexes, verifies and unpacks",
  ignore: !haveGit,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-git-packw-" });
    const git = async (args: string[], cwd = dir) => {
      const r = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" }).output();
      return { out: dec.decode(r.stdout), text: dec.decode(r.stdout).trim(), err: dec.decode(r.stderr).trim(), code: r.code };
    };
    try {
      await git(["init", "-q", "-b", "main"]);
      // Big enough that its size needs three bytes of varint, and compressible so the zlib stream is not
      // larger than the input.
      await Deno.writeTextFile(`${dir}/big.txt`, "a line that repeats\n".repeat(300));
      await Deno.mkdir(`${dir}/sub`);
      await Deno.writeTextFile(`${dir}/sub/small.txt`, "one\n");
      await git(["add", "-A"]);
      await git([
        "-c", "user.name=a", "-c", "user.email=a@b", "commit", "-qm", "one",
        "--date", "1700000000 +0000",
      ]);

      // Every object git made, with its type and bytes. `--batch-all-objects` is the enumeration and
      // `cat-file` the contents; taking them from git is the point.
      const names = (await git(["cat-file", "--batch-all-objects", "--batch-check"])).text.split("\n");
      const objects: { name: string; kind: string; size: number; body: Uint8Array }[] = [];
      for (const line of names) {
        const [name, kind, size] = line.split(" ");
        const r = await new Deno.Command("git", {
          args: ["cat-file", kind, name],
          cwd: dir,
          stdout: "piped",
          stderr: "piped",
        }).output();
        assert(r.success, `git cat-file ${kind} ${name} failed`);
        objects.push({ name, kind, size: Number(size), body: r.stdout });
      }

      // **The shape, asserted before anything is written.**
      const kinds = new Set(objects.map((o) => o.kind));
      assert(kinds.has("commit"), `no commit among ${[...kinds].join(", ")}`);
      assert(kinds.has("tree"), `no tree among ${[...kinds].join(", ")}`);
      assert(kinds.has("blob"), `no blob among ${[...kinds].join(", ")}`);
      assert(
        objects.some((o) => o.size > 2047),
        `the largest object is ${Math.max(...objects.map((o) => o.size))} bytes; ` +
          "nothing here needs a third byte of size varint",
      );
      // Two trees, so a nested one is in there rather than only the root.
      assert(objects.filter((o) => o.kind === "tree").length >= 2, "only one tree; the nesting is untested");

      const contents = pack["Vec$u8Arr"].create();
      for (const o of objects) contents.push(o.body);
      const bytes = Uint8Array.from(
        pack.writePack(objects.map((o) => KIND[o.kind]), contents),
      );
      assert(dec.decode(bytes.subarray(0, 4)) === "PACK", "what we wrote does not begin PACK");
      const count = (bytes[8] << 24) | (bytes[9] << 16) | (bytes[10] << 8) | bytes[11];
      assert(count === objects.length, `the header says ${count} objects and we passed ${objects.length}`);

      // ── 1. `git index-pack`, which verifies the pack and writes an index for it ──
      const into = await Deno.makeTempDir({ prefix: "wac-git-packw-idx-" });
      await Deno.writeFile(`${into}/ours.pack`, bytes);
      const indexed = await git(["index-pack", "-v", "ours.pack"], into);
      assert(indexed.code === 0, `git index-pack refused our pack: ${indexed.err}`);

      // ── 2. `git verify-pack -v`, field for field against what git said the objects are ──
      const verified = await git(["verify-pack", "-v", "ours.pack"], into);
      assert(verified.code === 0, `git verify-pack refused it: ${verified.err}`);
      const rows = new Map<string, { kind: string; size: number }>();
      for (const line of verified.text.split("\n")) {
        // **The type is padded to six columns** — `blob   2 11 107` — so this cannot ask for one space.
        // With a single space it matched `commit` and nothing else, and read as "verify-pack listed 1
        // object" on a pack git had just accepted.
        const m = line.match(/^([0-9a-f]{40}) (commit|tree|blob|tag)\s+(\d+)\s/);
        if (m) rows.set(m[1], { kind: m[2], size: Number(m[3]) });
      }
      assert(
        rows.size === objects.length,
        `verify-pack listed ${rows.size} objects and we wrote ${objects.length}`,
      );
      for (const o of objects) {
        const row = rows.get(o.name);
        assert(row !== undefined, `verify-pack does not list ${o.name} (${o.kind})`);
        assert(row!.kind === o.kind, `${o.name} is a ${row!.kind} in our pack and a ${o.kind} in git's`);
        assert(row!.size === o.size, `${o.name} is ${row!.size} bytes in our pack and ${o.size} in git's`);
      }
      // No deltas, which is what step 7 says this writer produces — and git says it in its own words
      // rather than being inferred from the absence of a pattern.
      assert(
        verified.text.includes(`non delta: ${objects.length} objects`),
        `verify-pack does not call all ${objects.length} objects non-delta:\n${verified.text}`,
      );

      // ── 3. `git unpack-objects` into an empty repository, and `git fsck` on the result ──
      const fresh = await Deno.makeTempDir({ prefix: "wac-git-packw-out-" });
      await git(["init", "-q", "-b", "main"], fresh);
      const unpacked = await new Deno.Command("git", {
        args: ["unpack-objects", "-q"],
        cwd: fresh,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const w = unpacked.stdin.getWriter();
      await w.write(bytes);
      await w.close();
      const done = await unpacked.output();
      assert(done.code === 0, `git unpack-objects refused it: ${dec.decode(done.stderr).trim()}`);

      // Every object arrived, under the name git gave it — which is the re-hash, since a loose object's
      // path *is* its SHA-1.
      for (const o of objects) {
        const r = await git(["cat-file", "-t", o.name], fresh);
        assert(r.code === 0 && r.text === o.kind, `${o.name} did not come back as a ${o.kind}: ${r.text || r.err}`);
      }
      const fsck = await git(["fsck"], fresh);
      assert(fsck.code === 0, `git fsck refused the unpacked repository: ${fsck.err || fsck.text}`);

      await Deno.remove(into, { recursive: true });
      await Deno.remove(fresh, { recursive: true });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "a thin pack says what it needs, and the completed one is what git accepts",
  ignore: !haveGit,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-git-thin-" });
    const git = async (args: string[], cwd = dir) => {
      const r = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" }).output();
      return { out: r.stdout, text: dec.decode(r.stdout).trim(), err: dec.decode(r.stderr).trim(), code: r.code };
    };
    try {
      // Two commits over one large, mostly-unchanged file. That shape is what makes the server deltify
      // against what we claim to have: a second commit touching only small files gives whole objects and
      // the thin case never arises.
      await git(["init", "-q", "-b", "main"]);
      const body = "a line that repeats\n".repeat(400);
      await Deno.writeTextFile(`${dir}/big.txt`, body);
      await git(["add", "-A"]);
      await git(["-c", "user.name=a", "-c", "user.email=a@b", "commit", "-qm", "one"]);
      await Deno.writeTextFile(`${dir}/big.txt`, body + "one more line\n");
      await git(["add", "-A"]);
      await git(["-c", "user.name=a", "-c", "user.email=a@b", "commit", "-qm", "two"]);
      const c1 = (await git(["rev-parse", "HEAD~1"])).text;
      const c2 = (await git(["rev-parse", "HEAD"])).text;

      // Ask for the second commit while claiming the first: the server may then send a delta against an
      // object it knows we hold, and that is a thin pack.
      // **From `fetchmod`, not from `pack`.** Each `wacBind` is its own wasm instance with its own types,
      // so a `Vec` made by one is not the type the other accepts — that is
      // `type incompatibility when transforming from/to JS`, and it is the same wall `test/wac/idxprobe.wac`
      // exists for. The `contents` Vec below is made from `pack`, because `completePack` is `pack`'s.
      const wants = fetchmod["Vec$u8Arr"].create();
      const haves = fetchmod["Vec$u8Arr"].create();
      const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));
      wants.push(hex(c2));
      haves.push(hex(c1));
      const req = Uint8Array.from(fetchmod.wantRequest(wants, haves, "ofs-delta thin-pack", 0));
      const up = new Deno.Command("git", {
        args: ["upload-pack", "--stateless-rpc", "."],
        cwd: dir,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const w = up.stdin.getWriter();
      await w.write(req);
      await w.close();
      const reply = (await up.output()).stdout;
      const found = fetchmod.findPack(reply);
      assert(found.tag === "Packfile", `no pack in the reply: ${found.tag}`);
      const thin = Uint8Array.from(found.Packfile_pack);

      // **The shape, asserted.** Without a reference delta whose base is absent there is nothing thin
      // here, and everything below would pass while testing an ordinary pack.
      const said = pack.indexPack(thin);
      assert(
        said.tag === "Thin",
        `the pack is not thin (${said.tag}), so this test proves nothing about completing one`,
      );
      const needed: Uint8Array[] = [];
      for (let i = 0; i < said.Thin_bases.len(); i++) needed.push(Uint8Array.from(said.Thin_bases.get(i)));
      assert(needed.length >= 1, "a thin pack that needs nothing is not thin");

      // **The canary: the same command that refuses this must accept what we build from it.** Unpiped, so
      // the exit code is git's own.
      await Deno.writeFile(`${dir}/thin.pack`, thin);
      const refused = await git(["index-pack", "thin.pack"]);
      assert(
        refused.code !== 0 && /unresolved delta/.test(refused.err),
        `git index-pack accepted a thin pack, so the comparison below means nothing: ${refused.err}`,
      );

      // The bases, out of the repository that has them — which is what an incremental fetch would do
      // against its own object store.
      const kinds: number[] = [];
      const contents = pack["Vec$u8Arr"].create();
      for (const name of needed) {
        const hexName = [...name].map((b) => b.toString(16).padStart(2, "0")).join("");
        const kind = (await git(["cat-file", "-t", hexName])).text;
        assert(KIND[kind] !== undefined, `the base ${hexName} is a ${kind}`);
        const raw = await git(["cat-file", kind, hexName]);
        assert(raw.code === 0, `cannot read the base ${hexName}`);
        kinds.push(KIND[kind]);
        contents.push(raw.out);
      }
      const whole = Uint8Array.from(pack.completePack(thin, kinds, contents));

      const before = (thin[8] << 24) | (thin[9] << 16) | (thin[10] << 8) | thin[11];
      const after = (whole[8] << 24) | (whole[9] << 16) | (whole[10] << 8) | whole[11];
      assert(after === before + needed.length, `the count went ${before} -> ${after} for ${needed.length} added`);

      await Deno.writeFile(`${dir}/whole.pack`, whole);
      const accepted = await git(["index-pack", "whole.pack"]);
      assert(accepted.code === 0, `git index-pack refused the completed pack: ${accepted.err}`);

      // And ours agrees it is no longer thin.
      const built = pack.indexPack(whole);
      assert(built.tag === "Built", `we still call the completed pack ${built.tag}`);
      assert(
        built.Built_idx.count === after,
        `we indexed ${built.Built_idx.count} objects and the header says ${after}`,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
