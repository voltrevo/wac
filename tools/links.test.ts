// Every relative link in every markdown file **and every source comment** points at something there.
//
// The merge of `wac` and `wac-mono` moved almost every path in the repository, and it moved them by
// *depth* as well as by name: `wac-mono/issues/` became `issues/system/`, so a link written
// `../../design/0001-…` from inside `issues/closed/` needs three dots' worth of climbing now and one
// more directory on the end. **Sixty-nine links were left pointing at nothing**, in thirty-seven
// files, and nothing said so — a broken link in a markdown file is invisible until somebody follows it
// and finds a 404 on the website or a dead reference in a design document.
//
// The rewrite itself was mechanical: every issue and design file has a distinctive basename, so the
// right target could be found by basename and the relative path recomputed. What was missing was
// anything that would have *noticed*, which is what this is.
//
// ## What counts as a link, and why the filter is what it is
//
// A markdown link target in this repository is a path: it has a `/` in it, or it ends in a known
// extension. Anything else in that position is a code fragment the regex misread — `[E.A(1)](…)`,
// `[1,2,3]` followed by a parenthesis, `${r.id}`. Twenty-seven of the first ninety-six "failures"
// were exactly that, and a check that reported them would be a check nobody could keep green.
//
// External links are not followed. This is a check that the repository is internally consistent, not a
// link checker for the internet — the second needs the network and goes stale on somebody else's
// schedule.
//
// ## Source files too, and the filter that costs
//
// A `.wac` or `.ts` comment cites an issue or a design document the same way a markdown file does, and
// four of them still pointed at the pre-merge layout after the markdown sweep — including
// `packages/fs/src/fs.wac` citing `issues/open/0065-…` for an issue that has been *closed* since
// before the merge. Same class, different corpus, and the first version of this file excluded it.
//
// The cost is that source is not prose: `](…)` also matches things that are code.
// `str("<b>hi</b>")`, a template literal `packages/${p.name}/`, and this file's own example strings all
// look like links. So a source target must additionally have no `${`, no quote and no angle bracket —
// which is not a heuristic about English but a statement that a repository path contains none of them.
//
// ## Anchors
//
// A `#fragment` is stripped rather than verified. Checking that a heading exists is a different and
// much fussier job — GitHub's slugging rules are its own — and the failure it would catch (a renamed
// heading) is far less costly than the one this catches (a moved file).

/**
 * POSIX path arithmetic, by hand.
 *
 * `jsr:@std/path` would do this and is one import away, and this repository has **no third-party
 * dependencies** — a rule that costs six lines here and buys a checkout that builds with no network,
 * which is what this container has. Every path in git is POSIX and relative, so the general cases
 * those libraries handle — drive letters, absolute roots, UNC — cannot arise.
 */
function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

/** `a/b` + `../c` → `a/c`. Leading `..` that climbs past the root is kept, so it fails visibly. */
function resolve(dir: string, rel: string): string {
  const out: string[] = [];
  for (const part of (dir === "" ? [] : dir.split("/")).concat(rel.split("/"))) {
    if (part === "" || part === ".") continue;
    if (part === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

/** Every file git tracks, which is the set a link may point into. */
async function tracked(): Promise<string[]> {
  const r = await new Deno.Command("git", { args: ["ls-files"], stdout: "piped" }).output();
  return new TextDecoder().decode(r.stdout).split("\n").filter((l) => l.length > 0);
}

const EXT = /\.(md|ts|wac|json|html|txt|sh|rs|toml)$/;
const SKIP = /^(https?:|mailto:|data:|#|\/)/;
/** What a repository path never contains, and what code in a `](…)` position usually does. */
const CODE = /[$"'<>`\\]/;

/** The link targets in one file: everything in a `](…)`, minus any anchor. */
function targets(text: string, source = false): string[] {
  return [...text.matchAll(/\]\(([^)\s]+?)\)/g)]
    .map((m) => m[1].split("#")[0])
    .filter((t) => t.length > 0 && !SKIP.test(t))
    // A path, not a code fragment the regex misread. See the header.
    .filter((t) => t.includes("/") || EXT.test(t))
    // In source, `](…)` also matches code. A repository path has no quote, no `$`, no angle bracket.
    .filter((t) => !source || !CODE.test(t));
}

/** Whether `target` names a tracked file, or a directory something tracked lives under. */
function nameable(present: Set<string>, target: string): boolean {
  if (present.has(target)) return true;
  for (const p of present) if (p.startsWith(target + "/")) return true;
  return false;
}

Deno.test("every relative link points at a file that exists", async () => {
  const all = await tracked();
  const present = new Set(all);
  // `site/` is a vite subtree with its own conventions and its own checker; everything else.
  const files = all.filter((f) =>
    !f.startsWith("site/") && /\.(md|wac|ts|rs|py|sh)$/.test(f)
  );
  const broken: string[] = [];
  for (const f of files) {
    const dir = dirname(f);
    for (const t of targets(await Deno.readTextFile(f), !f.endsWith(".md"))) {
      if (!nameable(present, resolve(dir, t))) broken.push(`${f}: ${t}`);
    }
  }
  assertEquals(
    broken.join("\n"),
    "",
    `${broken.length} markdown link(s) point at nothing. Most often this is a moved file: find the ` +
      `target by basename and recompute the relative path from the linking file's directory.`,
  );
});

Deno.test("the check has something to check", () => {
  // The canary, and it is not decoration. The filter above discards anything that does not look like
  // a path, and a filter that discarded *everything* would leave this file green and useless — which
  // is exactly the failure the repository keeps finding in its own measurements. So: a fragment is
  // rejected, a path is kept, and a real file's real link survives the whole pipeline.
  const found = targets("see [it](../design/system/0001-a-self-contained-system.md) and [E.A(1)](x) and [n](3)");
  assertEquals(found, ["../design/system/0001-a-self-contained-system.md"]);
  // **The examples are real paths, relative to this file**, so the check above sees them and they have
  // to resolve. The alternative was excluding this file from its own corpus, and a checker with an
  // exemption for itself is the shape nobody ever revisits.
  // And that the extension arm works on its own, without a slash to help it.
  assertEquals(targets("[a](../MAP.md)"), ["../MAP.md"]);
  // In source, the same three plus what code looks like. `packages/${p.name}/` is `tools/map.ts`,
  // `str("<b>hi</b>")` is `platform/test/browser.test.ts`, and both sat in a `](…)` position.
  assertEquals(targets("x](packages/${p.name}/)", true), []);
  assertEquals(targets('a](str("<b>hi</b>")', true), []);
  // …without the source filter swallowing a real one, which is the way this could go quietly wrong.
  assertEquals(
    targets("[d](../design/system/0001-a-self-contained-system.md)", true),
    ["../design/system/0001-a-self-contained-system.md"],
  );
});

Deno.test("the corpus is the whole repository, not a sample", async () => {
  // Without this, a `git ls-files` that answered nothing — wrong directory, no git, a flag that
  // changed meaning — would make the check above pass with no files at all. It is the same shape as
  // the canary above and it is here because that has happened to this repository before.
  const all = await tracked();
  assertEquals(all.filter((f) => f.endsWith(".md")).length > 100, true, "too few markdown files");
  assertEquals(all.filter((f) => f.endsWith(".wac")).length > 100, true, "too few wac files");
  assertEquals(all.includes("README.md"), true, "the root README is not in the corpus");
});
