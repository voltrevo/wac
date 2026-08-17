// Where a fetched commit lives — `design/lang/0009` D11's cache layout.
//
// A cache key is written into people's home directories and is the one part of a package system
// that cannot be changed later without a migration or orphaning what is already downloaded. So the
// test is a **property** rather than a table of paths I happened to like: escaping a repository URL
// into a directory name must be reversible, which is a claim a machine can check over any corpus.
// "These look different enough" is not.

import { wacBind } from "../../../harness/wacBind.ts";

type Mod = {
  cacheOf(wacHome: string, git: string, commit: string): string;
  cacheDir(wacHome: string): string;
  repoDirName(url: string): string;
  repoUrlOf(name: string): string;
};

let cached: Mod | null = null;
async function mod(): Promise<Mod> {
  if (cached === null) cached = await wacBind("packages/wacpkg/src/wacpkg.wac") as unknown as Mod;
  return cached;
}

const SHA = "3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a";

/** Repository URLs, and the shapes that make a naive escaper wrong. */
const URLS = [
  "https://github.com/voltrevo/wac",
  "https://github.com/voltrevo/wac.git",
  "http://example.invalid/x",
  "https://example.invalid:8443/a/b",
  "https://user@example.invalid/a",
  // Case. On a case-insensitive filesystem these are one directory unless the escaping says so.
  "https://github.com/Voltrevo/Wac",
  "https://github.com/voltrevo/wac",
  // The pair a slugifier collides: a slash and a dash are not the same character.
  "https://example.invalid/a/b",
  "https://example.invalid/a-b",
  // Things that would escape the cache directory if they were passed through.
  "https://example.invalid/../../etc/passwd",
  "https://example.invalid/a/./b",
  // Non-ASCII, which is where a byte-versus-codepoint mistake shows.
  "https://exämple.invalid/ünï/çode",
  "https://example.invalid/日本語",
  // Already-escaped-looking input, so the escaping has to escape its own markers.
  "https://example.invalid/%41/!b",
  "%!%!%!",
  "",
];

Deno.test("escaping a repository name is reversible", async () => {
  const m = await mod();
  const wrong: string[] = [];
  for (const url of URLS) {
    const name = m.repoDirName(url);
    const back = m.repoUrlOf(name);
    if (back !== url) wrong.push(`${JSON.stringify(url)} -> ${JSON.stringify(name)} -> ${JSON.stringify(back)}`);
  }
  if (wrong.length > 0) throw new Error(`${wrong.length} did not round-trip:\n  ` + wrong.join("\n  "));
});

Deno.test("distinct repositories get distinct directories, case included", async () => {
  const m = await mod();
  const seen = new Map<string, string>();
  const wrong: string[] = [];
  for (const url of URLS) {
    const name = m.repoDirName(url);
    const first = seen.get(name);
    if (first !== undefined && first !== url) {
      wrong.push(`${JSON.stringify(first)} and ${JSON.stringify(url)} both become ${JSON.stringify(name)}`);
    }
    seen.set(name, url);
    // Case-insensitively too: a macOS or Windows checkout must not merge two of them.
    const lowered = name.toLowerCase();
    for (const [other, otherUrl] of seen) {
      if (other !== name && other.toLowerCase() === lowered) {
        wrong.push(`${JSON.stringify(otherUrl)} and ${JSON.stringify(url)} differ only in case: ${other} / ${name}`);
      }
    }
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("a directory name is one path component, whatever the URL had in it", async () => {
  const m = await mod();
  const wrong: string[] = [];
  for (const url of URLS) {
    const name = m.repoDirName(url);
    if (name.includes("/")) wrong.push(`${JSON.stringify(url)} -> ${name} contains a slash`);
    if (name === "." || name === "..") wrong.push(`${JSON.stringify(url)} -> ${name}`);
    if (name.includes("\0")) wrong.push(`${JSON.stringify(url)} -> a NUL`);
  }
  // The one that matters: `..` in the URL must not climb out of the cache.
  const escape = m.cacheOf("/home/x/.wac", "https://example.invalid/../../etc/passwd", SHA);
  if (!escape.startsWith("/home/x/.wac/cache/git/")) {
    throw new Error(`a URL with .. left the cache: ${escape}`);
  }
  if (escape.includes("/../")) throw new Error(`the path still has a .. component: ${escape}`);
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("the path is a function of the home, the repository and the commit", async () => {
  const m = await mod();
  const home = "/home/x/.wac";
  const a = m.cacheOf(home, "https://example.invalid/r", SHA);
  if (a !== m.cacheOf(home, "https://example.invalid/r", SHA)) throw new Error("not deterministic");
  if (!a.startsWith(m.cacheDir(home) + "/")) throw new Error(`${a} is not under ${m.cacheDir(home)}`);
  if (!a.endsWith(`/${SHA}`)) throw new Error(`${a} does not end with the commit`);
  // Two commits of one repository are siblings — what lets the cache deduplicate by repository.
  const b = m.cacheOf(home, "https://example.invalid/r", "b".repeat(40));
  const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/"));
  if (dirOf(a) !== dirOf(b)) throw new Error(`two commits of one repository are not siblings:\n  ${a}\n  ${b}`);
  // And two repositories are not.
  if (dirOf(a) === dirOf(m.cacheOf(home, "https://example.invalid/s", SHA))) {
    throw new Error("two repositories share a directory");
  }
});

Deno.test("an absolute home stays absolute, and a trailing slash does not double", async () => {
  const m = await mod();
  const wrong: string[] = [];
  // The bug this exists for: trimming both ends of `$WAC_HOME` turns `/home/x/.wac` into a
  // relative path, and the cache is then written wherever the command was run from.
  for (const home of ["/home/x/.wac", "/home/x/.wac/", "/home/x/.wac///"]) {
    const got = m.cacheDir(home);
    if (got !== "/home/x/.wac/cache/git") wrong.push(`${JSON.stringify(home)} -> ${got}`);
  }
  if (m.cacheDir("rel/.wac") !== "rel/.wac/cache/git") wrong.push(`relative: ${m.cacheDir("rel/.wac")}`);
  // A missing repository or commit is not a path under the cache root.
  if (m.cacheOf("/home/x/.wac", "", SHA) !== "") wrong.push("an empty repository gave a path");
  if (m.cacheOf("/home/x/.wac", "https://example.invalid/r", "") !== "") wrong.push("an empty commit gave a path");
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("a name that is not something the escaper produced is refused", async () => {
  const m = await mod();
  // The inverse has to be able to say no, or "it round-trips" is satisfied by a function that
  // passes everything through.
  const wrong: string[] = [];
  for (const bad of ["a/b", "A", "a%", "a%zz", "a!", "a!B", "a:b", "%"]) {
    if (m.repoUrlOf(bad) !== "") wrong.push(`${JSON.stringify(bad)} -> ${JSON.stringify(m.repoUrlOf(bad))}`);
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});
