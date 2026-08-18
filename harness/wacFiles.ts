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
  const dir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : ".";
  const joined = `${dir}/${spec}`;
  // Collapse `a/./b` and `a/b/../c` so the same file is never keyed two ways.
  // An absolute path keeps its leading slash — normalising it away silently turns
  // it into a relative path and the read fails somewhere far from the cause.
  const absolute = joined.startsWith("/");
  const parts: string[] = [];
  for (const part of joined.split("/")) {
    if (part === "." || part === "") continue;
    if (part === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
    else parts.push(part);
  }
  return (absolute ? "/" : "") + parts.join("/");
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
type Walked = { files: Map<string, string>; stamps: Map<string, string> };
const walked = new Map<string, Walked>();

async function stampOf(path: string): Promise<string> {
  try {
    const s = await Deno.stat(path);
    return `${s.mtime?.getTime() ?? 0}:${s.size}`;
  } catch {
    return "gone";
  }
}

async function stillTrue(stamps: Map<string, string>): Promise<boolean> {
  const paths = [...stamps.keys()];
  const now = await Promise.all(paths.map(stampOf));
  for (let i = 0; i < paths.length; i++) {
    if (now[i] !== stamps.get(paths[i])) return false;
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

export async function wacFiles(entry: string): Promise<Map<string, string>> {
  calls++;
  const began = performance.now();
  const hit = walked.get(entry);
  // A copy, because a caller that adds a generated file to what it was handed must not write into the
  // memo — `packages/wacc`'s drivers do exactly that.
  if (hit !== undefined && await stillTrue(hit.stamps)) { hits++; return new Map(hit.files); }

  const files = new Map<string, string>();
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
      for (const spec of importPaths(texts[i])) next.push(resolveFrom(fresh[i], spec));
    }
    wave = next.filter((p) => !files.has(p));
  }

  const stamps = new Map<string, string>();
  const paths = [...files.keys()];
  const now = await Promise.all(paths.map(stampOf));
  for (let i = 0; i < paths.length; i++) stamps.set(paths[i], now[i]);
  walked.set(entry, { files, stamps });
  readMs += performance.now() - began;
  return new Map(files);
}
