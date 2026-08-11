// `.gitignore` matching against `git check-ignore`, decision by decision.
//
//     deno test -A packages/git/test/ignore.test.ts
//
// This is the best oracle in the package. `git check-ignore --no-index` answers exactly the question
// `ignored` answers — is this path ignored — for any path, without needing the file to exist or the
// repository to be in any particular state. So correctness here is not argued from the documentation; it is
// a table of paths where git's answer and ours are compared one at a time, and the failure message says
// which path and which way round.
//
// **The patterns are the ones that are easy to get wrong**, not a sample of easy ones: `*` stopping at a
// separator where `**` crosses it, a leading slash anchoring, a trailing slash restricting to directories,
// a slash in the middle anchoring implicitly, last-match-wins between a rule and its negation, and the
// rule that surprises people — a negation *inside* an ignored directory does not bring a file back,
// because git never looks in there.

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
if (!haveGit) console.error("git ignore tests: skipped — no `git` on PATH");

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ig = await wacBind("packages/git/src/ignore.wac") as any;

/** The `.gitignore` every case below is judged against. */
const IGNORE = [
  "# a comment, and the blank line under it",
  "",
  "build",                 // any depth, file or directory
  "//root-only.txt".slice(1), // "/root-only.txt" — anchored to the top
  "*.o",
  "!keep.o",               // last match wins over *.o
  "logs/",                 // directories only
  "doc/*.md",              // a slash in the middle anchors it
  "**/deep",               // any depth, explicitly
  "vendor/**",             // everything under vendor
  "a/**/z",                // any number of directories between
  "sp[abc]ce",             // a character class
  "q?ery",                 // a single character, never a separator
  "dist",
  "!dist/keep.txt",        // a negation inside an ignored directory: git does not look in there
].join("\n") + "\n";

/**
 * The paths to decide, generated rather than listed.
 *
 * A hand-written table is only as wide as what its author thought of, and the first version of this test
 * held 38 cases chosen to exercise the patterns above — which is the same person guessing twice. Crossing
 * a set of interesting names with itself gives 441 paths and, asked as both a file and a directory, **882
 * decisions**; every one is compared. Two of the original 38 would have passed while wrong, because the
 * question was being asked without a trailing slash.
 */
const NAMES = [
  "build", "logs", "doc", "vendor", "dist", "a", "b", "z", "deep", "keep.o", "x.o",
  "root-only.txt", "space", "spzce", "query", "qery", "other", "keep.txt", "sub", "x.md", "file",
];
const CASES: [string, boolean][] = [];
for (const a of NAMES) {
  for (const isDir of [false, true]) CASES.push([a, isDir]);
  for (const b of NAMES.slice(0, 10)) {
    for (const isDir of [false, true]) {
      CASES.push([`${a}/${b}`, isDir]);
      CASES.push([`${a}/${b}/z`, isDir]);
    }
  }
}

Deno.test({
  name: "every ignore decision is the one `git check-ignore` makes",
  ignore: !haveGit,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-git-ign-" });
    try {
      await new Deno.Command("git", { args: ["init", "-q"], cwd: dir, stdout: "null", stderr: "null" })
        .output();
      await Deno.writeTextFile(`${dir}/.gitignore`, IGNORE);

      // git's answer for every path at once. `--no-index` so a path need not exist, and `-z` so a name
      // containing a newline could not split a record — none here do, but a test that would break on one
      // is a test with an assumption in it.
      const r = await new Deno.Command("git", {
        args: ["check-ignore", "--no-index", "-z", "--stdin"],
        cwd: dir,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const w = r.stdin.getWriter();
      // **A directory has to be spelled with its slash.** With `--no-index` the path need not exist, so
      // git cannot tell a directory from a file and treats a bare name as a file — which makes a
      // `logs/` rule not match `logs`. Asking without the slash produced two disagreements that were the
      // question's fault and not the matcher's, and that is exactly the kind of difference a differential
      // is supposed to attribute correctly.
      const askAs = ([path, isDir]: [string, boolean]) => (isDir ? path + "/" : path);
      await w.write(new TextEncoder().encode(CASES.map(askAs).join("\0") + "\0"));
      await w.close();
      const out = await r.output();
      // Exit 1 means "nothing matched", which is a legitimate answer rather than a failure; anything else
      // is git refusing the question.
      assert(out.code === 0 || out.code === 1, `git check-ignore failed: ${dec.decode(out.stderr).trim()}`);
      const theirs = new Set(dec.decode(out.stdout).split("\0").filter((s) => s !== ""));

      // **The corpus has to contain both answers**, or a matcher that said "no" to everything would pass.
      assert(CASES.length > 800, `only ${CASES.length} decisions; the corpus shrank`);
      assert(
        theirs.size > CASES.length / 5 && theirs.size < (CASES.length * 4) / 5,
        `git ignores ${theirs.size} of ${CASES.length}; a corpus that lopsided would pass a matcher ` +
          `that answered the same way every time`,
      );

      const rules = ig.parseIgnore(new TextEncoder().encode(IGNORE));
      const wrong: string[] = [];
      for (const [path, isDir] of CASES) {
        const ours = ig.ignored(rules, path, isDir) as boolean;
        const gits = theirs.has(askAs([path, isDir]));
        if (ours !== gits) {
          wrong.push(`${path}${isDir ? "/" : ""}: we say ${ours ? "ignored" : "not ignored"}, git says ${gits ? "ignored" : "not ignored"}`);
        }
      }
      assert(wrong.length === 0, `${wrong.length} of ${CASES.length} disagree with git:\n  ${wrong.join("\n  ")}`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test("a comment, a blank line and a trailing space are not patterns", () => {
  const rules = ig.parseIgnore(new TextEncoder().encode("# nope\n\n  \nreal\ntrailing   \n"));
  assert(rules.len() === 2, `expected two rules, got ${rules.len()}`);
  assert(rules.get(0).pat === "real", `first rule is ${JSON.stringify(rules.get(0).pat)}`);
  // Trailing spaces are stripped, which is git's rule and the reason a stray keystroke does not silently
  // stop a pattern matching.
  assert(rules.get(1).pat === "trailing", `second rule is ${JSON.stringify(rules.get(1).pat)}`);
});

Deno.test("the last matching rule wins, and reversing the two reverses the answer", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const keep = ig.parseIgnore(enc("*.o\n!keep.o\n"));
  assert(ig.ignored(keep, "keep.o", false) === false, "!keep.o after *.o did not keep it");
  assert(ig.ignored(keep, "other.o", false) === true, "*.o did not ignore other.o");
  // The same two the other way round: the negation is overruled by what follows it.
  const drop = ig.parseIgnore(enc("!keep.o\n*.o\n"));
  assert(ig.ignored(drop, "keep.o", false) === true, "*.o after !keep.o did not overrule it");
});
