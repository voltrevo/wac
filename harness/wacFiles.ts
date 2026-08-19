import { isBuiltinSpecifier } from "wac/wacCore.ts";
// wacFiles — read a .wac entry file and everything it imports, transitively.
//
// wacCompile takes a path -> source map and does no I/O of its own, so someone
// has to walk the import graph. That someone is here rather than in a test, so
// the tests stay about gzip.
//
// The walk lexes rather than pattern-matching the raw text. A regex found import
// specifiers inside comments and string literals too, which meant a file that merely
// *described* an import — `// import { a } from "./m.wac"` in a doc comment — sent
// the walker off to read a file that does not exist, with an error pointing at the
// missing file rather than at the comment. Using the real lexer makes that class of
// mistake impossible instead of merely unlikely.

import { wacLex } from "wac/wacLex.ts";
import { isProjectSpecifier, resolvePath, resolveSpecifier } from "wac/wacResolve.ts";

/** Resolve `spec` relative to the directory of `fromPath`. */
/**
 * `spec` against the directory `fromPath` sits in, `.` and `..` collapsed.
 *
 * Exported because `packages/wacc/test/corpus.ts` had its own copy whose comment claimed it
 * resolved "the way the emitter's linker does" and did not: `from.slice(0, from.lastIndexOf("/"))`
 * drops the last *character* when there is no slash, so `c.wac` + `d.wac` was `c.wa/d.wac`, and its
 * `..` popped unconditionally so a path could climb above the root and come back looking local.
 * One rule with one caller is the fix; `issues/lang/0150` is the same shape on the wac side.
 */
export function resolveFrom(fromPath: string, spec: string): string {
  // A built-in is already the key it is looked up by. Joining it to the importing file's directory
  // would make `core/option.wac` into packages/json/src/core/option.wac — a path, and a missing one.
  if (isBuiltinSpecifier(spec)) return spec;
  // **The compiler's own, rather than a copy that matches it.** This had its own body until
  // 2026-08-19, and the two agreed: over the 4232 real import specifiers in the repository, and over
  // 27 hand-written spellings, one case apart — a `..` climbing above an absolute root, where the
  // compiler's dropped the leading slash and produced a *relative* key. That is the shape
  // `design/lang/0009` D8 is about, so it was fixed there rather than tolerated here, and once the
  // two answers were identical keeping two bodies bought nothing. What it cost was the possibility
  // of a program the harness gathers under one key and the compiler files under another.
  //
  // The direction is forced: the compiler must not import the harness. `design/lang/0009` asks for
  // this consolidation *before* the manifest lookups land, on the grounds that two lines agreeing is
  // not evidence that a provider table and a mapping table will.
  return resolvePath(fromPath, spec);
}

/**
 * The path of every `import ... from "..."` in `src`.
 *
 * Comments and string literals cannot contribute, because the lexer has already
 * classified them. A malformed import contributes nothing and is left for the
 * compiler to report properly.
 *
 * `import { Read } from core;` contributes nothing either, and deliberately: `core` ships inside
 * the compiler, so there is no file to read and `wacCompile` supplies it. The `string` test below
 * is what excludes it — a bare word after `from` is not a path.
 */
export function importPaths(src: string): string[] {
  const { tokens } = wacLex(src);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== "import") continue;
    // Scan to this import's `from`. Stopping at `;` keeps a malformed import from
    // consuming the one after it.
    let j = i + 1;
    // `from` is contextual as of wac 2026-08-02: it lexes as an ordinary identifier so
    // that `slice(a, from, to)` can name its argument, and only an import clause can put
    // one here. Matched by text for that reason.
    const isFrom = (t: { kind: string; text: string } | undefined) =>
      t !== undefined && t.kind === "ident" && t.text === "from";
    while (j < tokens.length && !isFrom(tokens[j]) && tokens[j].kind !== ";") j++;
    if (j < tokens.length && isFrom(tokens[j]) && tokens[j + 1]?.kind === "string") {
      out.push(tokens[j + 1].text);
      i = j + 1;
    }
  }
  return out;
}

/**
 * The same walk over sources already in memory, with no I/O.
 *
 * For callers holding a whole tree — the mutation harness holds every `.wac` file in the repo,
 * and patches them in place — handing all of it to `wacCompile` is both slower and *wrong*: one
 * unrelated file that does not parse then fails every compilation, whatever the entry was. This
 * narrows the map to what the entry actually imports, so a broken file matters only to the
 * entries that reach it.
 *
 * A missing import is left out rather than thrown on, so the compiler reports it against the
 * import that asked for it instead of this walk failing somewhere less useful.
 */
export function wacFilesIn(all: Map<string, string>, entry: string): Map<string, string> {
  const files = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (files.has(path)) continue;
    if (isBuiltinSpecifier(path)) continue;
    const src = all.get(path);
    if (src === undefined) continue;
    files.set(path, src);
    for (const spec of importPaths(src)) queue.push(resolveFrom(path, spec));
  }
  return files;
}

/**
 * The graph read for an entry, and the stamps that say whether it is still true.
 *
 * **Because every build re-read the whole graph, cache hit or not.** `buildApp` keys its artefact on
 * the content of every file it reads, so a repeat build is served from `.cache` — but it called this
 * first, and this read 171 files one at a time: 157ms, against 9ms to hash them and about nothing to
 * fetch the artefact. `packages/box/test/box.test.ts` makes twenty-eight build or runner calls, so it
 * paid four seconds to read the same graph twenty-eight times.
 *
 * A stamp is `mtime:size` per file. Validating one costs a `stat`, and 171 of them concurrently is
 * **4ms** — so the memo is checked rather than trusted, and a file edited between two builds in one
 * process invalidates it. That matters: `tools/testCli.test.ts` and friends write a `.wac` and build
 * it, and a memo that answered from before the write would hand the compiler yesterday's source.
 */
type Walked = { files: Map<string, string>; roots: Map<string, string>; stamps: Map<string, string>; readAt: number };
const walked = new Map<string, Walked>();

async function stampOf(path: string): Promise<string> {
  try {
    const s = await Deno.stat(path);
    return `${s.mtime?.getTime() ?? 0}:${s.size}`;
  } catch {
    return "gone";
  }
}

/**
 * Whether every file still has the stamp it had when it was read.
 *
 * **`readAt` is the half that a stamp alone cannot do, and leaving it out was a real bug.** A stamp is
 * `mtime:size` and an mtime is milliseconds, so a file rewritten to the *same length* inside the same
 * millisecond as the walk that read it has an identical stamp — and was served stale. Measured before
 * the fix, over a loop that wrote, walked, rewrote and walked again: **167 of 400 walks answered with
 * the previous version.** It is not a corner: generated corpora are written in loops, and a test that
 * rewrites a file and re-walks does it in microseconds.
 *
 * So a file whose mtime is close to the moment the read *began* is distrusted, because a write in that
 * window could have landed after the read. That costs one re-read for a file being actively written
 * and nothing at all for a source that has sat there for a minute.
 *
 * **`SLACK` is not padding, it is the two clocks disagreeing.** A file's mtime comes from the kernel's
 * *coarse* clock, which is updated on a timer tick, while `Date.now()` reads the fine one — so a write
 * that genuinely happened after the read can be stamped a few milliseconds *before* it, and a strict
 * `mtime >= readAt` misses it. Measured with the comparison written strictly: still 349 of 800 walks
 * stale, with traces showing hits whose stored mtime was a millisecond below the read that followed
 * the write. Fifty milliseconds is far past a tick and far below the age of anything not being
 * generated right now.
 */
const SLACK_MS = 50;

async function stillTrue(stamps: Map<string, string>, readAt: number): Promise<boolean> {
  const paths = [...stamps.keys()];
  const now = await Promise.all(paths.map(stampOf));
  for (let i = 0; i < paths.length; i++) {
    if (now[i] !== stamps.get(paths[i])) return false;
    const mtime = Number(now[i].split(":")[0]);
    if (mtime >= readAt - SLACK_MS) return false;
  }
  return true;
}

let calls = 0, hits = 0, readMs = 0;
/**
 * Whether to report the counters, asked in a way that works without the permission.
 *
 * **Reading an environment variable is a capability, and this module is imported by programs that were
 * not given it.** `packages/wacc/test/wac/files_test.wac` runs this walk as an oracle under
 * `wac test`, which grants what a test declares and no more, so a bare `Deno.env.get` at module scope
 * failed the whole file with `NotCapable: Requires env access to "WAC_FILES_STATS"` — an instrument
 * taking a capability away from its subject.
 */
function wantsStats(): boolean {
  try {
    return Deno.env.get("WAC_FILES_STATS") !== undefined;
  } catch {
    return false;
  }
}
if (wantsStats()) {
  globalThis.addEventListener("unload", () => {
    console.error(`  wacFiles: ${calls} call(s), ${hits} served from the memo, ${Math.round(readMs)}ms reading`);
  });
}

/**
 * The project root `path` sits in — the nearest directory at or above it holding a `wac.json5` —
 * or `undefined` when there is none. `design/lang/0009` D6 and D7.
 *
 * **This is the I/O half of `@/`, which is why it is here and not in the compiler.**
 * `compiler/wacResolve.ts` does no reading by design — "a compiler that reads files is a compiler
 * that cannot run in a browser" — and D7 defines `@/` by *searching upwards for the nearest
 * manifest*. So the search lives with the walk that already opens files, and the answer is handed to
 * `wacCompile` as `options.roots`.
 *
 * It finds a manifest and never reads one. That keeps `packages/json` and the manifest parser out of
 * this path entirely: what a `wac.json5` *says* matters for mappings (D9-D11), and `@/` needs only
 * that it is there.
 *
 * Memoised per directory, because a graph is wide and shallow — `packages/box` is 171 files across a
 * handful of directories, so the uncached version would `stat` the same three parents 171 times.
 */
const rootCache = new Map<string, string | undefined>();

async function projectRootOf(path: string): Promise<string | undefined> {
  let dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
  const asked: string[] = [];
  for (;;) {
    if (rootCache.has(dir)) {
      const seen = rootCache.get(dir);
      for (const d of asked) rootCache.set(d, seen);
      return seen;
    }
    asked.push(dir);
    let here = false;
    try {
      here = (await Deno.stat(`${dir}/wac.json5`)).isFile;
    } catch { /* not there, keep climbing */ }
    if (here) {
      for (const d of asked) rootCache.set(d, dir);
      return dir;
    }
    // `.` and `/` are fixed points of "the directory above", so they are where the climb stops.
    const up = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) || "/" : (dir === "." ? "" : ".");
    if (up === "" || up === dir) {
      for (const d of asked) rootCache.set(d, undefined);
      return undefined;
    }
    dir = up;
  }
}

/**
 * The same walk, with the project root of each file that needed one — what a caller passes as
 * `wacCompile`'s `options.roots`.
 *
 * **Only files that actually write `@/` get an entry, and that is not an optimisation.** The walk
 * has to resolve a `@/` specifier to *follow* it, so the search happens there or the graph is short
 * a file; and `resolveSpecifier` consults the map only for a `@/`, so a file without one has nothing
 * to say. Searching for every file instead would `stat` its way up the tree once per file to answer
 * a question nobody asks — `packages/box` is 171 files — and would let a manifest somewhere above
 * the repository change what the repository's own imports mean.
 */
export async function wacFilesWithRoots(
  entry: string,
): Promise<{ files: Map<string, string>; roots: Map<string, string> }> {
  const files = await wacFiles(entry);
  return { files, roots: new Map(walked.get(entry)?.roots ?? []) };
}

export async function wacFiles(entry: string): Promise<Map<string, string>> {
  calls++;
  const began = performance.now();
  const hit = walked.get(entry);
  // A copy, because a caller that adds a generated file to what it was handed must not write into the
  // memo — `packages/wacc`'s drivers do exactly that.
  if (hit !== undefined && await stillTrue(hit.stamps, hit.readAt)) { hits++; return new Map(hit.files); }

  const files = new Map<string, string>();
  const roots = new Map<string, string>();
  // **Taken before the first read, not after the last stat**, which is the difference between a rule
  // that holds and one that mostly holds. A write after this instant has an mtime of at least this
  // millisecond, so a recorded mtime strictly below it cannot belong to a write we missed. Stamping
  // afterwards and comparing against *that* leaves the case where the walk crosses a millisecond
  // boundary: the stamp reads 684, the walk finishes at 685, and a second write still inside 684 is
  // invisible. Measured: that window alone was 174 of 400 walks.
  const readAt = Date.now();
  // **Read in waves rather than one at a time.** The graph is wide — `packages/box` is 171 files and
  // only a few deep — so a level's worth of reads goes out together and the walk costs about as much
  // as its depth rather than its size.
  let wave = [entry];
  while (wave.length > 0) {
    // A built-in has no file to read, and does not go in the map: `wacCompile` injects the tree's
    // modules from the copy embedded in the compiler, so what the caller is handed stays a map of
    // the caller's own files.
    const fresh = wave.filter((p, i) =>
      !files.has(p) && wave.indexOf(p) === i && !isBuiltinSpecifier(p)
    );
    const texts = await Promise.all(fresh.map((p) => Deno.readTextFile(p)));
    const next: string[] = [];
    for (let i = 0; i < fresh.length; i++) {
      files.set(fresh[i], texts[i]);
      for (const spec of importPaths(texts[i])) {
        // **A `@/` is resolved here or the graph is short a file.** The root is the project the
        // *importing* file is in, so it is looked up per file — and only when one of its specifiers
        // asks, which is what keeps a graph with no `@/` in it paying nothing for the feature.
        // A specifier with no project resolves to "", which no file is keyed by, so the import goes
        // unread and `wacResolve` reports it as D7's compile error rather than this walk throwing.
        if (isProjectSpecifier(spec)) {
          let root = roots.get(fresh[i]);
          if (root === undefined) {
            root = await projectRootOf(fresh[i]);
            if (root !== undefined) roots.set(fresh[i], root);
          }
          next.push(resolveSpecifier(fresh[i], spec, root));
          continue;
        }
        next.push(resolveFrom(fresh[i], spec));
      }
    }
    wave = next.filter((p) => p !== "" && !files.has(p));
  }

  const stamps = new Map<string, string>();
  const paths = [...files.keys()];
  const now = await Promise.all(paths.map(stampOf));
  for (let i = 0; i < paths.length; i++) stamps.set(paths[i], now[i]);
  walked.set(entry, { files, roots, stamps, readAt });
  readMs += performance.now() - began;
  return new Map(files);
}
