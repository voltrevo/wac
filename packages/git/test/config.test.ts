// The configuration parser against `git config --list --file`, line for line.
//
//     deno test -A packages/git/test/config.test.ts
//
// That command prints one `name=value` per setting, in file order, with the names already folded the way
// git folds them — so the comparison is a diff of two texts rather than a reading of a specification. It is
// the same shape of oracle as `git check-ignore` for the ignore rules, and it is what makes a parser like
// this checkable at all: the format has a dozen small rules and every one of them is a place to be wrong.
//
// **The file is built from the awkward cases, not the tidy ones.** A parser handles `[user] name = x` on
// its first attempt; what it gets wrong is the key that is lowercased while the subsection beside it is
// not, the value with a `#` inside quotes, the bare key that means true, the same name set twice, and the
// spaces that are trimmed outside quotes and kept inside them.

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
if (!haveGit) console.error("git config tests: skipped — no `git` on PATH");

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const cfg = await wacBind("packages/git/src/config.wac") as any;

/** Every rule worth getting wrong, in one file. */
const CONFIG = [
  "# a comment, and the next line is the other kind",
  "; semicolon",
  "",
  "[user]",
  "\tname = Ada Lovelace",
  "\temail = ada@example.com",
  "[core]",
  "\tbare = false",
  // The key is folded to lower case and the value is not.
  "\texcludesFile = ~/.gitignore_Global",
  '[remote "origin"]',
  "\turl = https://example.com/x.git",
  "\tfetch = +refs/heads/*:refs/remotes/origin/*",
  // A subsection keeps its case, so this is a different section from the one above.
  '[remote "Upstream"]',
  "\turl = https://example.com/y.git",
  "[alias]",
  "\tlg = log --oneline --graph",
  "[flag]",
  // No `=` at all: present, and true to whatever reads it.
  "\ton",
  "[quoting]",
  // A `#` inside quotes is not a comment, and the spaces inside are kept.
  '\thash = "a # b"',
  '\tspaces = "  padded  "',
  "\ttrailing = value with spaces   ",
  "\tescape = a\\tb",
  "[user]",
  // The same name again: the last one wins.
  "\temail = later@example.com",
  "",
].join("\n");

Deno.test({
  name: "every setting is the one `git config --list` reports, in order",
  ignore: !haveGit,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-git-cfg-" });
    try {
      await Deno.writeTextFile(`${dir}/c.ini`, CONFIG);
      const r = await new Deno.Command("git", {
        args: ["config", "--list", "--file", `${dir}/c.ini`],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(r.success, `git config refused the file: ${dec.decode(r.stderr).trim()}`);
      const theirs = dec.decode(r.stdout).replace(/\n$/, "").split("\n");

      // **The fixture's own shape**, asserted in git's answer before ours is compared to it. Each of these
      // is a rule this parser could get wrong while still passing a tidy file.
      assert(theirs.includes("core.excludesfile=~/.gitignore_Global"), `the key was not folded: ${theirs.join(" | ")}`);
      assert(theirs.includes("remote.Upstream.url=https://example.com/y.git"), "the subsection lost its case");
      assert(theirs.includes("flag.on"), "the bare key did not survive");
      assert(theirs.includes("quoting.hash=a # b"), "a hash inside quotes was taken as a comment");
      assert(theirs.includes("quoting.spaces=  padded  "), "quoted spaces were trimmed");
      assert(theirs.includes("quoting.trailing=value with spaces"), "unquoted trailing spaces were kept");
      assert(
        theirs.filter((l) => l.startsWith("user.email=")).length === 2,
        "the repeated name is not repeated in git's own listing, so last-wins is untested",
      );

      const ours: string[] = [];
      const settings = cfg.parseConfig(new TextEncoder().encode(CONFIG));
      for (let i = 0; i < settings.len(); i++) {
        const s = settings.get(i);
        ours.push(s.valued ? `${s.name}=${s.value}` : s.name);
      }
      assert(
        ours.join("\n") === theirs.join("\n"),
        `we say:\n${ours.join("\n")}\ngit says:\n${theirs.join("\n")}`,
      );

      // And the lookup, which is what callers actually use: the *last* setting of a name.
      assert(
        cfg.configOf(settings, "user.email") === "later@example.com",
        `configOf returned ${JSON.stringify(cfg.configOf(settings, "user.email"))}, not the last one`,
      );
      assert(cfg.configOf(settings, "user.name") === "Ada Lovelace", "user.name did not come back");
      assert(cfg.hasConfig(settings, "flag.on") === true, "a valueless key is not reported as present");
      assert(cfg.hasConfig(settings, "nothing.here") === false, "a name that is not set reported as present");
      assert(cfg.configOf(settings, "nothing.here") === "", "an unset name did not answer empty");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test("a file with no sections yields nothing rather than a crash", () => {
  const settings = cfg.parseConfig(new TextEncoder().encode("# only a comment\n\n   \n"));
  assert(settings.len() === 0, `expected nothing, got ${settings.len()}`);
});
