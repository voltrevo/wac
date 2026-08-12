// `parseTag` — annotated tags, read back against the tags git wrote.
//
//     deno test -A packages/git/test/tag.test.ts
//
// ## Why this exists
//
// `deno task dead` (issue 0009) reported `parseTag` as the one exported wac function in the tree
// that nothing calls. It was worse than the constants that check was written for: a sixty-line
// parser for bytes **somebody else wrote**, with no consumer and no test, in a package whose README
// says `src/commit.wac` handles "commits and annotated tags". A parser nothing drives cannot be
// wrong in a way anything notices, and this repository has already been shown what that costs —
// `packages/fs`'s image reader had three defects the day its first exercise ran.
//
// Deleting it was the other honest answer. A test is better here because the oracle is free: git
// creates the objects, `git cat-file` hands over the exact bytes, and `git for-each-ref` says what
// they mean. That is a differential against the real tool rather than against a fixture somebody
// typed, which is the standard the rest of this package is held to.
//
// ## The two shapes a tag object comes in, and what git actually does with the second
//
// `git tag -a` writes a `tagger` line. `parseTag` does not require one, and `commit.wac` said that
// was because "git itself will create a tag without one". Measured on git 2.43, that is not what
// happens:
//
//   - `git mktag` refuses it — `missingTaggerEntry: invalid format - expected 'tagger' line`;
//   - so does `git hash-object -t tag -w`, for the same reason;
//   - `git hash-object -t tag --literally -w` stores it;
//   - `git cat-file tag` then reads it back, and `git fsck` calls it a **warning**, not an error.
//
// So a tagger-less tag is an object git will *read* and will not *write*, which is exactly the
// situation a lenient parser is for: they exist in old repositories and in objects other tools
// produced, and refusing them would make this package stricter than git at reading. The `Tag`
// struct has no tagger field at all, so ignoring it is the whole of the behaviour — what must not
// happen is a tag *with* a tagger failing to parse, or one *without* being refused for a line git
// only warns about.

// Imported for its side effect: retries a spawn that fails with "Text file busy". issues/system 0074.
import "../../../harness/spawnRetry.ts";
import { wacBind } from "../../../harness/wacBind.ts";

const dec = new TextDecoder();

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");

const haveGit = await (async () => {
  try {
    return (await new Deno.Command("git", { args: ["--version"], stdout: "null", stderr: "null" })
      .output()).success;
  } catch {
    return false;
  }
})();
if (!haveGit) console.error("git tag tests: skipped — no `git` on PATH");

// deno-lint-ignore no-explicit-any
const cm = await wacBind("packages/git/src/commit.wac") as any;

/** A repository with one commit and one annotated tag on it. */
async function tagged(): Promise<{
  dir: string;
  git: (a: string[], stdin?: string) => Promise<string>;
  both: (a: string[]) => Promise<string>;
  raw: (a: string[]) => Promise<Uint8Array>;
}> {
  const dir = await Deno.makeTempDir({ prefix: "wac-git-tag-" });
  const env = {
    GIT_AUTHOR_NAME: "Ada L",
    GIT_AUTHOR_EMAIL: "ada@example.com",
    GIT_AUTHOR_DATE: "1700000000 +0000",
    GIT_COMMITTER_NAME: "Ada L",
    GIT_COMMITTER_EMAIL: "ada@example.com",
    GIT_COMMITTER_DATE: "1700000000 +0000",
    PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin",
    HOME: dir,
  };
  const run = async (args: string[], stdin?: string) => {
    const child = new Deno.Command("git", {
      args,
      cwd: dir,
      stdin: stdin === undefined ? "null" : "piped",
      stdout: "piped",
      stderr: "piped",
      env,
      clearEnv: true,
    }).spawn();
    if (stdin !== undefined) {
      const w = child.stdin.getWriter();
      await w.write(new TextEncoder().encode(stdin));
      await w.close();
    }
    return await child.output();
  };
  const git = async (args: string[], stdin?: string) => dec.decode((await run(args, stdin)).stdout).trim();
  // `git fsck` prints its findings on stderr, so a helper that reads only stdout cannot see them.
  const both = async (args: string[]) => {
    const r = await run(args);
    return (dec.decode(r.stdout) + dec.decode(r.stderr)).trim();
  };
  const raw = async (args: string[]) => (await run(args)).stdout;

  await git(["init", "-q", "-b", "main"]);
  await Deno.writeTextFile(`${dir}/a.txt`, "one\n");
  await git(["add", "-A"]);
  await git(["commit", "-qm", "root commit"]);
  // A message with a blank line in it, because the body is everything after the first empty line
  // and a parser that stopped at the first one would pass on a one-line message.
  await git(["tag", "-a", "v1", "-m", "release one\n\nwith a body\n"]);
  return { dir, git, both, raw: raw as (a: string[]) => Promise<Uint8Array> };
}

Deno.test({
  name: "an annotated tag's fields are the ones git prints",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git, raw } = await tagged();
    try {
      const content = await raw(["cat-file", "tag", "v1"]);
      const parsed = cm.parseTag(content);
      assert(
        parsed.tag === "Annotated",
        `git's own tag did not parse: ${parsed.tag === "Unreadable" ? parsed.Unreadable_why : parsed.tag}`,
      );
      const t = parsed.Annotated_tag;

      // Each field against git's answer for the same tag, rather than against the string this test
      // passed to `git tag` — the point is that the bytes were read, not that they were remembered.
      assert(
        hex(Uint8Array.from(t.object)) === await git(["rev-parse", "v1^{commit}"]),
        `object read as ${hex(Uint8Array.from(t.object))}, git says ${await git(["rev-parse", "v1^{commit}"])}`,
      );
      assert(t.kindWord === "commit", `type read as ${JSON.stringify(t.kindWord)}`);
      assert(t.name === "v1", `tag name read as ${JSON.stringify(t.name)}`);
      assert(
        t.message === await git(["for-each-ref", "--format=%(contents)", "refs/tags/v1"]) + "\n",
        `message read as ${JSON.stringify(t.message)}`,
      );
      // The body survived the blank line rather than being cut at it.
      assert(t.message.includes("with a body"), `the body is missing: ${JSON.stringify(t.message)}`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "a tag object with no tagger line is read, because git reads those too",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git, both, raw } = await tagged();
    try {
      const commit = await git(["rev-parse", "HEAD"]);
      // `--literally` because git refuses to *create* this shape — see the header. What is being
      // tested is that we read what git reads, so the object has to get into the store somehow and
      // `cat-file` has to be the thing that hands it over.
      const body = `object ${commit}\ntype commit\ntag bare\n\nno tagger here\n`;
      const sha = await git(["hash-object", "-t", "tag", "--literally", "-w", "--stdin"], body);
      assert(/^[0-9a-f]{40}$/.test(sha), `git would not store the object: ${JSON.stringify(sha)}`);

      // git's own verdict on it, which is the reason this parser is lenient: a warning, not an
      // error. If a future git promotes it, this line is where that shows up.
      const fsck = await both(["fsck", "--tags"]);
      assert(
        fsck.includes("warning in tag") && fsck.includes("missingTaggerEntry"),
        `git fsck no longer calls a missing tagger a warning — it said: ${JSON.stringify(fsck)}`,
      );

      const parsed = cm.parseTag(await raw(["cat-file", "tag", sha]));
      assert(
        parsed.tag === "Annotated",
        `a tag without a tagger was refused: ${parsed.tag === "Unreadable" ? parsed.Unreadable_why : parsed.tag}`,
      );
      const t = parsed.Annotated_tag;
      assert(t.name === "bare", `tag name read as ${JSON.stringify(t.name)}`);
      assert(t.message === "no tagger here\n", `message read as ${JSON.stringify(t.message)}`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test("a tag object that is not one says which part is missing", () => {
  const enc = new TextEncoder();
  const cases: [string, string, string][] = [
    ["no blank line", "object 0000000000000000000000000000000000000000\ntype commit\n", "terminated"],
    ["no object", "type commit\ntag v1\n\nm\n", "no object"],
    ["no type", "object 0000000000000000000000000000000000000000\ntag v1\n\nm\n", "no type"],
    ["a short object", "object beef\ntype commit\n\nm\n", "forty hex"],
    ["a header with no space", "object 0000000000000000000000000000000000000000\nnonsense\n\nm\n", "no space"],
  ];
  for (const [what, text, expect] of cases) {
    const parsed = cm.parseTag(enc.encode(text));
    assert(parsed.tag === "Unreadable", `${what}: parsed as a tag`);
    assert(
      parsed.Unreadable_why.includes(expect),
      `${what}: expected the reason to mention ${JSON.stringify(expect)}, got ${JSON.stringify(parsed.Unreadable_why)}`,
    );
  }
});
