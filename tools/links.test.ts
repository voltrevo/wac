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
// This said, for good reasons: "a `#fragment` is stripped rather than verified. Checking that a
// heading exists is a different and much fussier job — GitHub's slugging rules are its own — and the
// failure it would catch (a renamed heading) is far less costly than the one this catches (a moved
// file)."
//
// **What changed is the cost, not the fussiness.** Several package READMEs now open by routing the
// reader — "[What it does](#what-it-does) and [What it does not do](#what-it-does-not-do) for the
// edges" — because the complaint about them was that they were books with no path through. A dead
// anchor now breaks the path itself, on the first screen, for exactly the reader the routing is for.
//
// So **same-file anchors are checked** and cross-file ones are still stripped. Same-file is where the
// routing lives and where the slug rule is safe to approximate: lowercase, drop everything that is
// not a letter, digit, space, underscore or hyphen, then spaces to hyphens. That reproduced every
// one of the anchors in this repository the day it was written, which is 333 files and not a sample
// — and where it cannot, the answer is to write a plainer heading rather than a cleverer rule.
import { docTest } from "./docCheck.ts";


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

docTest("every relative link points at a file that exists", async () => {
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

docTest("the check has something to check", () => {
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

/**
 * GitHub's heading slug, near enough for headings written in this repository.
 *
 * Not a general implementation: no duplicate-heading disambiguation (`-1`, `-2`), and no attempt at
 * the emoji rules. Both would matter for a public site generator and neither has come up here.
 */
function slug(heading: string): string {
  return heading.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/ /g, "-");
}

docTest("every same-file anchor names a heading in that file", async () => {
  const files = (await tracked()).filter((f) => f.endsWith(".md") && !f.startsWith("site/"));
  const broken: string[] = [];
  for (const f of files) {
    const text = await Deno.readTextFile(f);
    const headings = new Set([...text.matchAll(/^#{1,6} +(.*)$/gm)].map((m) => slug(m[1])));
    for (const m of text.matchAll(/\]\(#([^)\s]+)\)/g)) {
      if (!headings.has(m[1])) broken.push(`${f}: #${m[1]}`);
    }
  }
  assertEquals(broken.join("\n"), "", "an anchor names no heading in its own file");
});

docTest("the slug rule is the one the anchors were written against", () => {
  // The canary for the check above: a rule that dropped too much would map every heading to the
  // same string and pass everything, and a rule that dropped too little would have failed on the
  // day it was written rather than being committed.
  assertEquals(slug("What it does not do"), "what-it-does-not-do");
  assertEquals(slug("`^C` ends a running command in a page, and not over ssh"), "c-ends-a-running-command-in-a-page-and-not-over-ssh");
  assertEquals(slug("## The oracle is bash".replace(/^#+ /, "")), "the-oracle-is-bash");
  assertEquals(slug("Side channels"), "side-channels");
});

docTest("the corpus is the whole repository, not a sample", async () => {
  // Without this, a `git ls-files` that answered nothing — wrong directory, no git, a flag that
  // changed meaning — would make the check above pass with no files at all. It is the same shape as
  // the canary above and it is here because that has happened to this repository before.
  const all = await tracked();
  assertEquals(all.filter((f) => f.endsWith(".md")).length > 100, true, "too few markdown files");
  assertEquals(all.filter((f) => f.endsWith(".wac")).length > 100, true, "too few wac files");
  assertEquals(all.includes("README.md"), true, "the root README is not in the corpus");
});

// ---------------------------------------------------------------------------------------------
// A backticked repository path, which is a link with no `](…)` around it.
//
// The test above walks `](…)`, so it sees every markdown link and the handful of source comments
// written as links. What it has never seen is the way a path is *usually* written in this repo's
// prose — in backticks, inside a comment: "`packages/box/test/backings.test.ts` drives every one of
// them against the real filesystem". That is a pointer, a reader follows it, and nothing checked it.
//
// Seventeen of them named nothing on 2026-08-11, most of them shaped by the two-repository merge that
// moved `packages/sh`'s tests into `packages/box` and every `tools/x.ts` into the package that owns
// it. `d3d713dd` fixed the sixty-nine *markdown* links that same merge broke; these are the same
// breakage in the same commit's blind spot, and one of them — `packages/fs/cov.ts`'s reason for
// exempting a host mount — was copied out twenty-five times.
//
// Only root-shaped paths are checked (`packages/…`, `tools/…`, `spec/…`), because those are
// unambiguous: a relative one like `example/wc.wac` is relative to whichever file mentions it, and
// resolving that guesses. `issues/` is left out for the same reason `readmeFigures.test.ts` leaves it
// out — a closed issue is what was true on a day, and rewriting its paths would be rewriting the
// record. A name with `NNNN` in it is a template's placeholder rather than a path. And prose that
// names something deliberately no longer in the tree — a file this code was moved out of, a repro
// that was deleted, the two repositories MERGE.md exists to describe — goes in `GONE` with what it
// was.

/** Prose that names a path deliberately no longer in the tree, and what it was. */
const GONE: { file: string; path: string; why: string }[] = [
  {
    file: "packages/fmt/src/itoa.wac",
    path: "packages/box/src/lib/num.wac",
    why: "where this code was moved from, which is the point of the sentence",
  },
  {
    file: "tools/deadexports.ts",
    path: "packages/zstd/src/castrepro.wac",
    why: "a repro file this check's false negatives were measured against, since deleted",
  },
  {
    file: "tools/discovery.test.ts",
    path: "tools/test.ts",
    why: "the wrapper whose top level the runner collected — wac-mono 0077 is why it is gone",
  },
  {
    file: "tools/deadexports.ts",
    path: "packages/a/src/x.wac",
    why: "an illustration of the import-matching rule, not a file",
  },
  {
    file: "tools/deadexports.ts",
    path: "packages/a/b.wac",
    why: "the same illustration",
  },
  {
    file: "compiler/wacResolve.ts",
    path: "packages/a/b.wac",
    why: "an illustration of how an import path resolves, not a file",
  },
  {
    file: "MERGE.md",
    path: "tools/wacPin.ts",
    why: "the pin the two repositories needed and the merge removed — MERGE.md exists to describe that world",
  },
  {
    file: "MERGE.md",
    path: "harness/wacVersion.ts",
    why: "the other half of the same pin, gone with it",
  },
  {
    file: "design/lang/0001-import-resolution-core-and-what-packages-inherit.md",
    path: "packages/bytes/src/read.wac",
    why: "deleted when `Read` moved into `core`, which is what that row records",
  },
  {
    file: "tools/jobsSweep.sh",
    path: "tools/test.ts",
    why: "the wrapper wac-mono 0077 removed — see `tools/discovery.test.ts`",
  },
  {
    file: "tools/links.test.ts",
    path: "tools/x.ts",
    why: "this file's own example of a path shape",
  },
  {
    file: "packages/bls/tools/genfips-experiment.py",
    path: "packages/bls/test/wac/fips.wac",
    why: "what that generator *writes*, and its next line says the file is not checked in",
  },
  // The three places that name `atoms/` on purpose, because saying what a thing *was* is how a
  // reader with an old checkout finds out what happened to it. Everything else naming that
  // directory is describing a repository that stopped existing on 2026-08-09.
  {
    file: "CLAUDE.md",
    path: "atoms/wac/",
    why: "the layout table's own note that `compiler/` was `atoms/wac/`",
  },
];

/**
 * The two files allowed to name a departed root anywhere in them, rather than at one path.
 *
 * `MERGE.md`'s subject *is* the rename and its table is a column of departed paths beside what each
 * became; this file names every one of them in order to refuse them. Kept apart from `GONE` above
 * because that list means "this path, in this file", and an entry meaning "any path, in this file"
 * would read as the first while behaving as the second.
 */
const DEPARTED_FILES = ["MERGE.md", "tools/links.test.ts"];

/** A path in backticks that starts at a directory the repository root has. */
const ROOTED = /`((?:packages|tools|harness|compiler|spec|design|issues|native|site)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|wac|md|rs|json|sh|py))`/g;


/**
 * A path under a directory this repository **used to have**, which `ROOTED` cannot see.
 *
 * `atoms/wac/` was the compiler until 2026-08-09, when the two repositories became one and it
 * became `compiler/` ([MERGE.md](../MERGE.md)); `wac-mono/`, `wac/issues/` and `wac/design/` went
 * the same way. Fourteen references survived in `CONTRIBUTING`, two design notes, both trackers'
 * own READMEs and this project's `CLAUDE.md` — including the sentence telling a reader where to
 * file a compiler bug — and none of them could fail the check above:
 * it matches a path only if it *starts* with a directory the tree has now, so a path naming a
 * directory that is gone is invisible to it — the one case where being wrong is certain rather than
 * likely.
 *
 * Kept as its own rule rather than added to `ROOTED`, because the message is different. A path under
 * `packages/` that names nothing is probably a typo or a move; a path under `atoms/` is a document
 * describing a repository that no longer exists, and the reader wants to be told that.
 */
const DEPARTED = /`((?:atoms|wac-mono|wac\/(?:atoms|issues|design|src|tools))\/[A-Za-z0-9_./-]*)`/g;
/**
 * The repository's *name*, which the departed-path rule cannot see.
 *
 * `wac` and `wac-mono` became one repository called `wac` on 2026-08-09, and eight package READMEs
 * still opened with "A package of [wac-mono]" three days later — a name, not a path, so nothing
 * checked it. `WASM-WISHLIST.md` linked to `github.com/voltrevo/wac-mono` for the same reason.
 *
 * **Two spellings stay, and they are why this is a rule rather than a search-and-replace.** An issue
 * reference is `wac-mono 0103`, which `CLAUDE.md` defines and every commit message uses — the
 * numbers collide across the two trackers, so the prefix is load-bearing. And the documents whose
 * subject is the merge say the old name in order to explain it.
 */
// `wac-mono 0103` and `wac-mono issue 0103` are **issue references**, which `CLAUDE.md` defines and
// every commit message uses: both trackers number from 0001 and 79 numbers collide, so the prefix
// says which. The number may be wrapped onto the next line of a comment, which is why this looks
// past whitespace and comment markers rather than requiring a single space.
const OLD_REPO = /wac-mono(?!(?:'s)?(?: issue)?[\s*/#]{0,14}\d{4})(?! upstream #)(?<!@wac-mono)/g;
const OLD_REPO_FILES = ["MERGE.md", "CLAUDE.md", "README.md", "tools/links.test.ts"];

docTest("no current document calls this repository wac-mono", async () => {
  const listed = new Deno.Command("git", { args: ["ls-files", "*.md", "*.ts", "*.wac"] });
  const files = new TextDecoder().decode((await listed.output()).stdout).split("\n").filter((f) =>
    f !== "" && !f.startsWith("issues/") && !f.startsWith("site/blog/") &&
    !OLD_REPO_FILES.includes(f)
  );
  const said: string[] = [];
  for (const f of files) {
    const text = await Deno.readTextFile(f);
    for (const m of text.matchAll(OLD_REPO)) {
      // `wac-mono/…` is a departed *path* and the rule above owns it; this one is about the name.
      if (text.slice(m.index, m.index + 10).includes("/")) continue;
      // A GitHub reference is a citation of something that still exists over there — the external
      // tracker several notes quote an issue from, as `voltrevo/wac-mono#38` or `wac-mono#4`.
      // Renaming those would break the citation; they are about somebody else's issue number, not
      // about what this repository is called.
      const around = text.slice(Math.max(0, m.index - 40), m.index + 20);
      if (around.includes("github.com/") || /wac-mono#\d/.test(around)) continue;
      // And `"wac-mono needs a newer compiler"` is quoted output from a check that no longer
      // exists, in the paragraph explaining that it does not. Quoted words are evidence.
      if (around.includes('"wac-mono needs')) continue;
      said.push(`${f}: ${text.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\n/g, " ")}`);
    }
  }
  assertEquals(
    said,
    [],
    "this repository is called `wac`; `wac-mono NNNN` is an issue reference and stays:\n  " +
      said.join("\n  "),
  );
});

docTest("every backticked repository path names a file that exists", async () => {
  const all = await tracked();
  const present = new Set(all);
  // **`.tsx` and `.py` too, which it did not read.** The Python is `packages/bls`'s generators,
  // and one of them cited a sibling generator as if it were at the repository root's tools/ rather
  // than the package's own, which is where every one of these lived.
  // The website is `.tsx` and it names repository paths in
  // its own prose — and three of them were the tools the merge moved into `site/tools/`, on a page
  // that is published. The site is excluded from the Deno *walks* because its imports are
  // extensionless; this check reads files rather than importing them, so that exclusion never
  // applied to it and nobody had noticed.
  const files = all.filter((f) => /\.(md|wac|ts|tsx|rs|sh|py)$/.test(f) && !f.startsWith("issues/"));
  const broken: string[] = [];
  let checked = 0;

  for (const f of files) {
    for (const m of (await Deno.readTextFile(f)).matchAll(ROOTED)) {
      const path = m[1];
      if (path.includes("NNNN")) continue;
      if (GONE.some((g) => g.file === f && g.path === path)) continue;
      checked++;
      if (!nameable(present, path)) broken.push(`${f}: \`${path}\``);
    }
  }

  // And the departed directories, which the pattern above is structurally unable to see.
  //
  // **Over a wider file set than the check above**, which skips `issues/` entirely because a closed
  // issue is a record of what somebody ran and should not be edited to follow a rename. That is
  // right for the numbered files and wrong for the trackers' own READMEs: `issues/system/README.md`
  // is live documentation — it is the page that says where to file a compiler bug — and it was
  // still sending readers to `wac/issues/`. So: everything except the numbered issues themselves.
  const departedFiles = all.filter((f) =>
    /\.(md|wac|ts|tsx|rs|sh|py)$/.test(f) && !/^issues\/[a-z]+\/(open|closed)\//.test(f)
  );
  const departed: string[] = [];
  for (const f of departedFiles) {
    for (const m of (await Deno.readTextFile(f)).matchAll(DEPARTED)) {
      if (DEPARTED_FILES.includes(f)) continue;
      // …and the same per-path exemption list the check above uses, so a deliberate mention
      // elsewhere is recorded once with its reason rather than as a filename in a condition.
      if (GONE.some((g) => g.file === f && m[1].startsWith(g.path))) continue;
      departed.push(`${f}: \`${m[1]}\``);
    }
  }
  assertEquals(
    departed,
    [],
    "a path under `atoms/` names the layout this repository had before 2026-08-09 — see MERGE.md " +
      "for what each became:\n  " + departed.join("\n  "),
  );

  // Hundreds, across the tree. Zero would mean the pattern stopped matching and this test had gone
  // back to checking nothing, which is the state it was written to end.
  if (checked < 100) {
    throw new Error(`only ${checked} backticked paths found — has the pattern stopped matching?`);
  }
  assertEquals(broken, [], `a backticked path names nothing:\n  ${broken.join("\n  ")}`);
});
