// Content-addressed caching for the two slow things this repo does: compiling a wac program, and
// bundling one into an application.
//
// The suite spends nearly all of its time on work it has already done. `packages/box`'s tests build
// fifteen binaries from the same `box.wac`, differing only in which grants are baked in; the shell's
// differential test builds `sh.wac`; four other files build the same programs again. Every one of
// those ran `wacCompile` over the whole import graph and `deno bundle` twice, from scratch, on every
// run — so a full sequential pass took ten minutes and a single package took thirty seconds, which is
// long enough that nobody runs one package while working on it.
//
// **The key is content, never a timestamp.** An mtime cache is wrong in the direction that costs a
// day: `git checkout` of an older file is a *new* input with an *older* mtime, and a cache that
// believed the timestamp would hand back the newer build and report a pass for code that is not
// there. Everything that can change the output goes into a SHA-256, and anything this file cannot
// hash — a compiler it cannot locate — disables the cache rather than being assumed unchanged.
//
// What goes in, and why each one is not optional:
//
//   - every reachable `.wac` file, by content — the program itself
//   - every `.ts` file of the wac compiler — a compiler fix must not be served a stale wasm, and
//     this is the case that would waste the most time, since the symptom would be "my fix did
//     nothing" (wac issues 0001 and 0008 are the same lesson, one layer up)
//   - the harness and, for an application, `packages/platform`'s host — the bundle *is* that code
//   - `Deno.version.deno` — the bundler's output is the bundler's business
//   - the arguments: entry, grants, target, whether the worker half alone was asked for
//
// Deleting `.cache` is always safe and always correct. It is the whole of the invalidation story.

const CACHE_DIR = ".cache";

/** How many artifacts to keep in a cache directory before the oldest are dropped. */
const KEEP = 120;

const enc = new TextEncoder();

/**
 * SHA-256 of these parts, hex.
 *
 * Length-prefixed rather than joined by a separator, because a separator is a claim about what the
 * inputs cannot contain and these inputs are whole source files. With a NUL, a file holding one
 * makes two different programs hash alike; with a space, `["a b", "c"]` and `["a", "b", "c"]`
 * already do. A length in front of each part cannot be mistaken for the part.
 */
export async function contentKey(parts: string[]): Promise<string> {
  const framed = parts.map((p) => `${p.length}:${p}`).join("");
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(framed));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A `Map` of path to source, flattened in a fixed order so two runs agree. */
export function filesParts(files: Map<string, string>): string[] {
  return [...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).flat();
}

export async function hashDir(dir: string, suffix: string): Promise<string[]> {
  const parts: string[] = [];
  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile && e.name.endsWith(suffix)) names.push(e.name);
  }
  names.sort();
  for (const name of names) {
    parts.push(`${dir}/${name}`, await Deno.readTextFile(`${dir}/${name}`));
  }
  return parts;
}

let waccParts: string[] | null | undefined;

/**
 * The compiler's own sources — `packages/wacc/src`, which is the whole of the compiler.
 *
 * **There was a second half of this until 2026-08-28.** `compilerKeyParts` hashed `compiler/*.ts`,
 * the TypeScript reference, and every key in this file was the two together. The reference is
 * deleted, so that function resolved a module that is not there and answered `null` — which this
 * file spells "do not cache" — and every build cache in the repository was off, silently, for every
 * caller. A key that cannot be computed looks exactly like a cache that is working.
 *
 * It covers more than it looks: `coretext.wac` there is the generated
 * embedding of `std/platform.wac` and `core/*.wac`, so **a capability added to `Cli` changes no file
 * a build walks and no file this key covered**. A module compiled against the old `Cli` was served
 * for the new one, its import count no longer matched its manifest, and instantiating it from that
 * manifest failed with two missing imports and nothing pointing at a cache. `issues/system/0241c`.
 *
 * `.wac` rather than every extension: the seed's `.wasm` is an output of these files, and hashing it
 * would key on the build rather than the source.
 */
export async function waccKeyParts(): Promise<string[] | null> {
  if (waccParts !== undefined) return waccParts;
  const root = decodeURIComponent(new URL("../packages/wacc/src", import.meta.url).pathname);
  try {
    waccParts = await hashDir(root.replace(/\/$/, ""), ".wac");
  } catch {
    waccParts = null;
  }
  return waccParts;
}

let harnessParts: string[] | null | undefined;

/**
 * This harness's own sources: it decides what is generated and how.
 *
 * **And the Deno version**, which was in `compilerKeyParts` until that went. It belongs here rather
 * than there: it is the runtime that bundles, transpiles and drives the compiler, so an upgrade
 * changes what every key here stands for even when no source under this directory moved.
 */
export async function harnessKeyParts(): Promise<string[] | null> {
  if (harnessParts !== undefined) return harnessParts;
  const here = decodeURIComponent(new URL(".", import.meta.url).pathname);
  try {
    harnessParts = [Deno.version.deno, ...await hashDir(here.replace(/\/$/, ""), ".ts")];
  } catch {
    harnessParts = null;
  }
  return harnessParts;
}

/**
 * A cached artifact, produced on first ask.
 *
 * `produce` is given a path to write and is called only when the key is new. The write is atomic
 * because `--parallel` runs test files in separate processes: two of them can want the same
 * artifact at the same moment, and both will compute identical bytes, so a lost rename race is a
 * duplicate of work rather than a corrupt file. Reading a half-written cache entry is the failure
 * this avoids, and it looks like a syntax error in generated code — see the note in `wacBind.ts`,
 * where it cost an afternoon.
 */
export async function cached(
  kind: string,
  key: string,
  suffix: string,
  produce: (path: string) => Promise<void>,
): Promise<string> {
  const dir = `${CACHE_DIR}/${kind}`;
  const path = `${dir}/${key}${suffix}`;
  try {
    await Deno.stat(path);
    // Touched so that pruning drops what is genuinely unused rather than what was built first.
    await Deno.utime(path, new Date(), new Date()).catch(() => {});
    return path;
  } catch {
    // Not there yet.
  }
  await Deno.mkdir(dir, { recursive: true });
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  await produce(tmp);
  try {
    await Deno.rename(tmp, path);
  } catch {
    // Someone else won. Their bytes are ours, since the key is the content of every input.
    await Deno.remove(tmp).catch(() => {});
  }
  await prune(dir);
  return path;
}

/**
 * A directory to build in whose *path* is a function of what is being built.
 *
 * Deno keys its transpile cache on the source's absolute path, so a build staged in a fresh
 * `/tmp` directory leaves an entry that can never be hit again — 6.5 GB of them by 2026-08-12, and
 * 23 GB the first time anyone looked (`issues/system/0068`, and `0140` for why that was closed too
 * early). Staging at a path derived from the content key means the second build of the same program
 * lands on the same paths and *reuses* those entries instead of orphaning them.
 *
 * **It is deliberately not removed afterwards.** Removing it is precisely what orphans the entry, so
 * the directory has to outlive the build for the cache to be worth anything; `sweepStage` below is
 * what bounds it, on the same rule the artifact cache uses.
 */
export async function stageDir(key: string): Promise<string> {
  const dir = `${CACHE_DIR}/stage/${key}`;
  await Deno.mkdir(dir, { recursive: true });
  await Deno.utime(dir, new Date(), new Date()).catch(() => {});
  await sweepStage();
  // **Absolute**, because the caller hands these paths to `deno bundle`, which resolves an import
  // specifier rather than a file name and refuses a bare relative one. The temp directory this
  // replaces was absolute by construction, so the first build after the change failed with
  // `Import ".cache/stage/…/app.gen.ts"` and nothing else about it was wrong.
  return await Deno.realPath(dir);
}

/** Where Deno mirrors a transpiled source: `gen/file/` followed by the source's absolute path. */
const transpileMirror = (denoDir: string, absSource: string) => `${denoDir}/gen/file${absSource}`;

/** Deno's cache root, which `DENO_DIR` moves. */
const denoCacheDir = () =>
  Deno.env.get("DENO_DIR") ?? `${Deno.env.get("HOME")}/.cache/deno`;

/**
 * Bound the staging directories, oldest first — **and drop the transpile entries they leave.**
 *
 * `prune` below skips anything that is not a file — it was written for artifacts, which are single
 * files — so these need their own pass rather than a shared one. Same `KEEP`, same "touched on use
 * so the oldest is genuinely the least used" rule.
 *
 * **Evicting one is what orphans a transpile entry, so evicting one is where it gets cleaned up.**
 * `stageDir` above exists because Deno keys its transpile cache on the source's absolute path, and a
 * build staged somewhere transient leaves an entry nothing can ever hit again. Staging at a stable
 * path fixed that for as long as the directory lives — and this function is what ends its life, so
 * without the removal below the fix only moves the leak from "one per run" to "one per eviction".
 * Measured 2026-08-15: 2,615 mirrored staging directories against 120 that still existed, 5.7 GB in
 * this agent's share alone.
 *
 * That is the *rate* `issues/system/0068` asked to change and `0140` said was still unchanged when
 * it closed — "neither tool changes the rate at which the cache refills". The sweeps in
 * `tools/runTests.wac` and `tools/prune-deno-cache.sh` stay as the backstop for entries this misses:
 * a run killed between the two removals, and everything orphaned before this existed.
 *
 * The real path is taken **before** the removal, because there is nothing left to resolve after it.
 */
export async function sweepStage(
  dir = `${CACHE_DIR}/stage`,
  denoDir = denoCacheDir(),
): Promise<void> {
  const entries: { path: string; at: number }[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      const st = await Deno.stat(`${dir}/${e.name}`).catch(() => null);
      if (st === null) continue;
      entries.push({ path: `${dir}/${e.name}`, at: st.mtime?.getTime() ?? 0 });
    }
  } catch {
    return;
  }
  if (entries.length <= KEEP) return;
  entries.sort((a, b) => a.at - b.at);
  for (const e of entries.slice(0, entries.length - KEEP)) {
    const real = await Deno.realPath(e.path).catch(() => null);
    await Deno.remove(e.path, { recursive: true }).catch(() => {});
    if (real !== null) {
      await Deno.remove(transpileMirror(denoDir, real), { recursive: true }).catch(() => {});
    }
  }
}

/**
 * Keep the cache from growing without bound.
 *
 * Cheap and approximate on purpose: it runs only when an entry was actually built, and a directory
 * under the limit costs one `readDir`. This container filled its disk once already — for an unrelated
 * reason, a `finally` that never ran — and an unbounded cache of half-megabyte binaries is the obvious
 * way to do it again on purpose.
 *
 * Stale *temp* files are dropped here too. A run killed between producing one and renaming it leaves it
 * behind by definition, so nothing else can: an interrupted process has no `finally` that runs.
 */
async function prune(dir: string): Promise<void> {
  const entries: { path: string; at: number }[] = [];
  const now = Date.now();
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile) continue;
      const st = await Deno.stat(`${dir}/${e.name}`).catch(() => null);
      if (st === null) continue;
      const at = st.mtime?.getTime() ?? 0;
      if (e.name.endsWith(".tmp")) {
        // A build that was *interrupted* between producing its temp file and renaming it cannot clean
        // up after itself — a killed test run, a cancelled suite — so 184 of these had accumulated
        // here. Ten minutes is far longer than any build takes and far shorter than a session, so a
        // live one is never touched.
        if (now - at > 600_000) await Deno.remove(`${dir}/${e.name}`).catch(() => {});
        continue;
      }
      entries.push({ path: `${dir}/${e.name}`, at });
    }
  } catch {
    return;
  }
  if (entries.length <= KEEP) return;
  entries.sort((a, b) => a.at - b.at);
  for (const e of entries.slice(0, entries.length - KEEP)) {
    await Deno.remove(e.path).catch(() => {});
  }
}
