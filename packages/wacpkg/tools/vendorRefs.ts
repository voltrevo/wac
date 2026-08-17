// Generates `test/vendor/refs.json` from real `git`, the oracle for `src/refs.wac`.
//
//     deno run -A packages/wacpkg/tools/vendorRefs.ts > packages/wacpkg/test/vendor/refs.json
//
// Run by hand. The corpus is committed, so the tests need neither `git` nor a network and cannot
// start passing because a command was missing. `packages/ens/tools/vendor.ts` is the pattern.
//
// **The repository is built here rather than described.** A ref table typed out by hand would be a
// table of what I believe `git ls-remote` prints, and the interesting rows are exactly the ones
// where that belief is wrong — an annotated tag advertising two lines, a name that is both a
// branch and a tag. So this makes the refs with `git`, reads the advertisement with
// `git ls-remote`, and asks `git rev-parse <ref>^{commit}` what each query means.
//
// `^{commit}` and not plain `rev-parse`: the question is which commit a fetcher would check out,
// and for an annotated tag plain `rev-parse` answers with the tag object.
//
// **Committed with fixed identities and dates**, so two runs of this produce the same object names
// and re-vendoring is a no-op diff rather than a wall of changed hashes.

const enc = new TextDecoder();

async function git(cwd: string, ...args: string[]): Promise<string> {
  const c = new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
    env: {
      GIT_AUTHOR_NAME: "wac", GIT_AUTHOR_EMAIL: "wac@example.invalid",
      GIT_COMMITTER_NAME: "wac", GIT_COMMITTER_EMAIL: "wac@example.invalid",
      GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
  const out = await c.output();
  if (!out.success) {
    return `!${enc.decode(out.stderr).trim().split("\n")[0]}`;
  }
  return enc.decode(out.stdout).trim();
}

const dir = await Deno.makeTempDir({ prefix: "wacpkg-refs-" });
await git(dir, "init", "-q", "-b", "main", ".");
await Deno.writeTextFile(`${dir}/a.txt`, "one\n");
await git(dir, "add", "a.txt");
await git(dir, "commit", "-q", "-m", "one");
await git(dir, "branch", "feature/x");
await git(dir, "tag", "light");
await git(dir, "tag", "-a", "v1", "-m", "release one");
// The shape the rule refuses: one name that is both a branch and a tag.
await git(dir, "branch", "dup");
await git(dir, "tag", "dup");
// A second commit, so `main` and the tags are not all the same object and a wrong answer shows.
await Deno.writeTextFile(`${dir}/a.txt`, "two\n");
await git(dir, "commit", "-q", "-am", "two");

const advertised: { name: string; commit: string }[] = [];
for (const line of (await git(dir, "ls-remote", ".")).split("\n")) {
  const [commit, name] = line.split("\t");
  if (commit && name) advertised.push({ name, commit });
}

const head = await git(dir, "rev-parse", "HEAD");
const QUERIES = [
  "main", "feature/x", "light", "v1", "dup", "HEAD",
  "refs/heads/main", "refs/tags/v1", "refs/tags/v1^{}", "refs/heads/feature/x",
  head, "nope", "refs/heads/nope", "",
];
const queries = [];
for (const q of QUERIES) {
  const answer = q === "" ? "!empty" : await git(dir, "rev-parse", `${q}^{commit}`);
  queries.push({ ref: q, git: answer.startsWith("!") ? null : answer, why: answer.startsWith("!") ? answer.slice(1) : null });
}

await Deno.remove(dir, { recursive: true });
console.log(JSON.stringify({
  source: `real git — ${(await git(".", "--version")) || "git"}`,
  note: "advertised is `git ls-remote .`; queries are `git rev-parse <ref>^{commit}`, null when git refused",
  advertised,
  queries,
}, null, 2));
