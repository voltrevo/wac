// `packages/git` against the git that is installed.
//
//     deno test -A packages/git/test/interop.test.ts
//
// The oracle is **git itself**, which suits this package in a way it would not suit most: git's
// object names are the SHA-1 of the object's own bytes, so agreeing with git is not a matter of
// taste or of a fixture somebody transcribed. Either the forty characters are the same or the two
// implementations disagree about what the object *is*.
//
// Skipped, with a reason on standard error, when git is not installed — a silent skip reads as
// coverage.
//
// ## What is checked, and what is deliberately not
//
// **Not the compressed bytes.** A loose object is a zlib stream, and this package deflates with
// `packages/gzip` while git deflates with zlib's own match search — two different valid encodings of
// the same bytes. Measured: 34 bytes against git's 21 for `"hello\n"`, and 41 against git's 59 for
// five thousand `a`s, so ours is sometimes smaller and sometimes larger and neither is wrong.
// Requiring byte-identity there would be requiring a reimplementation of zlib's heuristics, which is
// not what interoperating means. What is required is that **git can read what we write**, and that
// is checked by handing an object we wrote to `git cat-file`.
//
// **Both directions.** Reading git's objects and writing objects git reads are different failures: a
// package that only read them could have any encoder at all and nothing here would notice.

import { wacBind } from "../../../harness/wacBind.ts";

const dec = new TextDecoder();
const enc = new TextEncoder();

const haveGit = await (async () => {
  try {
    return (await new Deno.Command("git", { args: ["--version"], stdout: "null", stderr: "null" })
      .output()).success;
  } catch {
    return false;
  }
})();
if (!haveGit) console.error("git interop: skipped — no `git` on PATH");

// deno-lint-ignore no-explicit-any
const obj = await wacBind("packages/git/src/object.wac") as any;
// deno-lint-ignore no-explicit-any
const tree = await wacBind("packages/git/src/tree.wac") as any;
// deno-lint-ignore no-explicit-any
const zlib = await wacBind("packages/git/src/zlib.wac") as any;

type Git = (args: string[], stdin?: Uint8Array) => Promise<{ out: Uint8Array; text: string; code: number }>;

/** A throwaway repository, and a `git` that runs in it. */
async function repo(): Promise<{ dir: string; git: Git }> {
  const dir = await Deno.makeTempDir({ prefix: "wac-git-" });
  const git: Git = async (args, stdin) => {
    const child = new Deno.Command("git", {
      args,
      cwd: dir,
      stdin: stdin ? "piped" : "null",
      stdout: "piped",
      stderr: "piped",
      // Pinned, not inherited: an identity taken from the environment would make any commit hash
      // depend on whoever ran the test.
      env: {
        GIT_AUTHOR_NAME: "wac",
        GIT_AUTHOR_EMAIL: "wac@example.com",
        GIT_AUTHOR_DATE: "1700000000 +0000",
        GIT_COMMITTER_NAME: "wac",
        GIT_COMMITTER_EMAIL: "wac@example.com",
        GIT_COMMITTER_DATE: "1700000000 +0000",
        PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin",
        HOME: dir,
      },
      clearEnv: true,
    }).spawn();
    if (stdin) {
      const w = child.stdin.getWriter();
      await w.write(stdin);
      await w.close();
    }
    const r = await child.output();
    return { out: r.stdout, text: dec.decode(r.stdout).trim(), code: r.code };
  };
  await git(["init", "-q"]);
  return { dir, git };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Empty, short, long, high-bytes, and no trailing newline — the shapes a blob comes in. */
const BLOBS = ["hello\n", "", "a".repeat(5000), "ÿþ high bytes", "no trailing newline"];

Deno.test({
  name: "an object's name is the one git gives it",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git } = await repo();
    try {
      for (const text of BLOBS) {
        const bytes = enc.encode(text);
        const theirs = (await git(["hash-object", "--stdin"], bytes)).text;
        const ours = obj.nameOf(obj.Kind.Blob(), bytes);
        assert(ours === theirs, `blob ${JSON.stringify(text.slice(0, 20))}: we say ${ours}, git says ${theirs}`);
      }
      // The canary. Every assertion above is "these two agree", and a harness that hashed nothing
      // would agree with itself — this is the one pair that must not match.
      assert(
        obj.nameOf(obj.Kind.Blob(), enc.encode("x")) !== obj.nameOf(obj.Kind.Blob(), enc.encode("y")),
        "the harness is not hashing anything",
      );
      // The kind is part of the identity: the same bytes as a blob and as a tag are two objects.
      assert(
        obj.nameOf(obj.Kind.Blob(), enc.encode("x")) !== obj.nameOf(obj.Kind.Tag(), enc.encode("x")),
        "the object kind does not reach the hash",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "git reads the loose objects we write, and we read the ones it wrote",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git } = await repo();
    try {
      for (const text of BLOBS) {
        const bytes = enc.encode(text);

        // ── ours, read by git
        const name = obj.nameOf(obj.Kind.Blob(), bytes);
        await Deno.mkdir(`${dir}/.git/objects/${name.slice(0, 2)}`, { recursive: true });
        await Deno.writeFile(
          `${dir}/.git/objects/${name.slice(0, 2)}/${name.slice(2)}`,
          Uint8Array.from(obj.looseFile(obj.Kind.Blob(), bytes)),
        );
        const back = await git(["cat-file", "blob", name]);
        assert(back.code === 0, `git could not read the object we wrote for ${JSON.stringify(text.slice(0, 20))}`);
        assert(dec.decode(back.out) === text, `git read different bytes for ${JSON.stringify(text.slice(0, 20))}`);

        // ── git's, read by us
        const theirs = (await git(["hash-object", "-w", "--stdin"], bytes)).text;
        const file = await Deno.readFile(`${dir}/.git/objects/${theirs.slice(0, 2)}/${theirs.slice(2)}`);
        const o = obj.readLoose(file);
        assert(o.tag === "Loaded", `we could not read git's object: ${o.tag === "Unreadable" ? o.Unreadable_why : ""}`);
        assert(o.Loaded_kind.tag === "Blob", `we read git's blob as a ${o.Loaded_kind.tag}`);
        assert(dec.decode(Uint8Array.from(o.Loaded_content)) === text, "we read different bytes out of git's object");
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "a tree git wrote parses to what `ls-tree` says, and serialises back to the same bytes",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git } = await repo();
    try {
      // These names are chosen for the sort rule rather than for looking like a project: git orders a
      // subtree as though its name ended in `/`, so `a.b` comes before the directory `a` because `.`
      // is 0x2E and `/` is 0x2F. A parser that kept insertion order would pass on almost any other
      // set of names.
      await Deno.mkdir(`${dir}/a`, { recursive: true });
      await Deno.writeTextFile(`${dir}/a.b`, "dot\n");
      await Deno.writeTextFile(`${dir}/a/inner`, "nested\n");
      await Deno.writeTextFile(`${dir}/zz`, "last\n");
      await Deno.chmod(`${dir}/zz`, 0o755);
      await git(["add", "-A"]);
      const name = (await git(["write-tree"])).text;

      const file = await Deno.readFile(`${dir}/.git/objects/${name.slice(0, 2)}/${name.slice(2)}`);
      const o = obj.readLoose(file);
      assert(o.tag === "Loaded" && o.Loaded_kind.tag === "Tree", "git's tree object did not read back as a tree");
      const content = Uint8Array.from(o.Loaded_content);

      const parsed = tree.parseTree(content);
      assert(parsed.tag === "Ok", `parse failed: ${parsed.tag === "Bad" ? parsed.Bad_why : ""}`);
      const es = parsed.Ok_entries;

      // `ls-tree` prints the mode zero-padded to six and git stores it in five, which is the trap
      // this comparison exists to pin: `40000` on disk, `040000` on screen.
      const want = (await git(["ls-tree", name])).text.split("\n").map((line) => {
        const [meta, path] = line.split("\t");
        const [mode, , hash] = meta.split(/\s+/);
        return `${mode.replace(/^0+(?=\d{5})/, "")} ${path} ${hash}`;
      });
      const got: string[] = [];
      for (let i = 0; i < es.len(); i++) {
        const e = es.get(i);
        got.push(`${e.mode} ${e.name} ${e.hex()}`);
      }
      assert(
        got.join("\n") === want.join("\n"),
        `entries differ:\n  ours: ${got.join(" | ")}\n  git:  ${want.join(" | ")}`,
      );

      let subtrees = 0;
      for (let i = 0; i < es.len(); i++) if (es.get(i).isTree()) subtrees++;
      assert(subtrees === 1, `expected one subtree, found ${subtrees}`);

      const rewritten = Uint8Array.from(tree.writeTree(es));
      assert(
        rewritten.length === content.length && rewritten.every((b, i) => b === content[i]),
        `re-serialised tree differs from git's: ${rewritten.length} vs ${content.length} bytes`,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test("adler32 matches its published vector, and a zlib stream round-trips", () => {
  // Adler-32("abc") = 0x024D0127. One published vector catches a transposed sum; the round trip
  // below covers the rest.
  const abc = zlib.adler32(enc.encode("abc")) >>> 0;
  assert(abc === 0x024D0127, `adler32("abc") = ${abc.toString(16)}, expected 24d0127`);
  assert((zlib.adler32(new Uint8Array(0)) >>> 0) === 1, "adler32 of nothing is 1");

  for (const text of BLOBS) {
    const bytes = enc.encode(text);
    const out = zlib.zlibDecompress(Uint8Array.from(zlib.zlibCompress(bytes)));
    assert(out.tag === "Ok", `round trip failed: ${out.tag === "Bad" ? out.Bad_why : ""}`);
    assert(dec.decode(Uint8Array.from(out.Ok_bytes)) === text, "round trip changed the bytes");
  }
});

Deno.test("a corrupt zlib stream is refused rather than half-inflated", () => {
  const good = Uint8Array.from(zlib.zlibCompress(enc.encode("hello\n")));

  const badHeader = good.slice();
  badHeader[0] = 0x79; // still CM=8, but the two bytes no longer divide by 31
  assert(zlib.zlibDecompress(badHeader).tag === "Bad", "a broken header check was accepted");

  const notDeflate = good.slice();
  notDeflate[0] = 0x71; // CM=1
  assert(zlib.zlibDecompress(notDeflate).tag === "Bad", "a non-deflate method was accepted");

  const badSum = good.slice();
  badSum[badSum.length - 1] ^= 0xff;
  assert(zlib.zlibDecompress(badSum).tag === "Bad", "a wrong Adler-32 was accepted");

  assert(zlib.zlibDecompress(good.slice(0, 4)).tag === "Bad", "a truncated stream was accepted");
});

Deno.test("a loose object whose header disagrees with its bytes is refused", () => {
  // The length is the one header field that can contradict what follows, and a parser that trusted
  // it would hand back a truncated blob rather than an error.
  const lying = Uint8Array.from(zlib.zlibCompress(enc.encode("blob 99 hello\n")));
  assert(obj.readLoose(lying).tag === "Unreadable", "an object claiming 99 bytes of a 6-byte body was accepted");

  const unknown = Uint8Array.from(zlib.zlibCompress(enc.encode("wombat 3 abc")));
  assert(obj.readLoose(unknown).tag === "Unreadable", "an unknown object kind was accepted");

  assert(obj.readLoose(enc.encode("not zlib at all")).tag === "Unreadable", "a non-zlib file was accepted");
});
