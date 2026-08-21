// Everything a build needs from wacc, in one place.
//
// Two callers want the same four things — the module's bytes, the glue that calls it, the coverage
// table when there is one, and what the module exports. `harness/wacBind.ts` wants them to bind a
// package into a Deno test; `packages/platform/build.ts` wants them to build an application. Both
// used to ask the reference compiler, which cannot be asked once a program uses a feature only wacc
// has (design/lang/0003), so both ask wacc here.
//
// wacc itself is built by the reference — the bootstrap has to start somewhere, and that somewhere is
// `wacBind` with `WAC_BIND_FROM=reference`.

import { wacBind } from "./wacBind.ts";
import { ROOT } from "./programs.ts";
import { cached as cacheFile, compilerKeyParts, contentKey, filesParts } from "./buildCache.ts";
import {
  generate, parseAliases, parseBindTypes, parseCallbacks, parseOutRefs, parseSigs, unsupported,
} from "../packages/wacc/tools/waccBindgen.ts";

/** The half of wacc's API a build uses. */
export type WaccApi = {
  emitFiles: (paths: string[], sources: string[], entry: string) => Uint8Array;
  emitFilesCovered: (paths: string[], sources: string[], entry: string) => Uint8Array;
  blockedFiles: (paths: string[], sources: string[], entry: string) => string;
  /** What the checker says, which a caller wants before it asks what the emitter declined. */
  diagnoseFiles: (paths: string[], sources: string[], entry: string) => string;
  /** The same for every file in the graph, each checked as an entry — `issues/lang/0118`. */
  diagnoseGraph: (paths: string[], sources: string[], entry: string) => string;
  exportSigsFiles: (paths: string[], sources: string[], entry: string) => string;
  bindTypesFiles: (paths: string[], sources: string[], entry: string) => string;
  /** Both of the above from one front end, split on `describeSeparator()` — `issues/lang/0129`. */
  describeFiles: (paths: string[], sources: string[], entry: string) => string;
  /** The module *and* that description, from one front end. The whole of a build's compiler work. */
  buildFiles: (
    paths: string[],
    sources: string[],
    entry: string,
  ) => { wasm: Uint8Array; described: string };
  describeSeparator: () => string;
  covTableFiles: (paths: string[], sources: string[], entry: string) => string;
  /** Trace instrumentation — an ordered journal of branches *and array indices*. `wac ctcompare`. */
  emitFilesTraced: (paths: string[], sources: string[], entry: string) => Uint8Array;
  traceTableFiles: (paths: string[], sources: string[], entry: string) => string;
  /** The same with the journal sized by the caller — `issues/lang/0059`. */
  emitFilesTracedSlots: (paths: string[], sources: string[], entry: string, slots: number) => Uint8Array;

  /**
   * **The resolution context, and the entry points that read it.**
   *
   * The variants above build an empty `Res`, which resolves `./a.wac` and nothing else: a `@/`
   * specifier lands on a key no supplied file has, so the file contributes no declarations and the
   * emitter declines the program. Every one of these has been exported by `api.wac` the whole time,
   * and this type declared only the root-less half — so a host reading the type could not see there
   * was a choice. GitHub issue 22 finding 4.
   */
  Res: {
    empty: () => WaccRes;
    of: (roots: string[]) => WaccRes;
    /** All five fields — mappings and the base included. `$`-prefixed because it is the constructor. */
    $of: (
      roots: string[],
      mapFrom: string[],
      mapSpec: string[],
      mapTo: string[],
      base: string,
    ) => WaccRes;
  };
  diagnoseGraphIn: (paths: string[], sources: string[], res: WaccRes, entry: string) => string;
  diagnoseFilesIn: (paths: string[], sources: string[], res: WaccRes, entry: string) => string;
  buildFilesIn: (
    paths: string[],
    sources: string[],
    res: WaccRes,
    entry: string,
  ) => { wasm: Uint8Array; described: string };
  describeFilesIn: (paths: string[], sources: string[], res: WaccRes, entry: string) => string;
  bindTypesFilesIn: (paths: string[], sources: string[], res: WaccRes, entry: string) => string;
  exportSigsFilesIn: (paths: string[], sources: string[], res: WaccRes, entry: string) => string;
  emitFilesCoveredIn: (paths: string[], sources: string[], res: WaccRes, entry: string) => Uint8Array;
  covTableFilesIn: (paths: string[], sources: string[], res: WaccRes, entry: string) => string;
};

/** wacc's `Res`, held by reference on the wac side — opaque here, built by `Res.$of`. */
export type WaccRes = { readonly $ref?: unknown };

/**
 * The resolution context as wacc wants it, from what `wacFilesWithRoots` found.
 *
 * **`roots` is parallel to `paths`, not a map**, because `Res.rootAt` looks a file's root up by
 * position — so a file with no project gets `""` and resolves the ordinary way. `base` is the
 * directory relative keys are measured from, and dropping it is its own silence: a project reached by
 * an *absolute* root whose graph is keyed *relatively* resolves back through it, so honouring the root
 * alone gives `/abs/p/src/lib.wac` for a file keyed `src/lib.wac`, which is not the file.
 */
export function waccRes(
  api: WaccApi,
  paths: string[],
  roots: Map<string, string>,
  base: string,
): WaccRes {
  if (roots.size === 0) return api.Res.empty();
  return api.Res.$of(paths.map((p) => roots.get(p) ?? ""), [], [], [], base);
}

let cached: WaccApi | null = null;

/** wacc, built by the reference. */
export async function waccApi(): Promise<WaccApi> {
  if (cached === null) {
    try {
      // **As a tool.** Everything below is the compiler compiling something else; under
      // `WAC_PROFILE` a bound module is instrumented and attributed, and profiling the compiler
      // buries the program the profile is about.
      // **Pinned as arguments rather than set in the environment**: tests share one process, and a
      // `WAC_BIND_FROM=reference` set for the duration of this build was read by every other bind
      // running at the same time — which compiled a package with the seed and refused a wacc-only
      // feature nobody had opted out of. `harness/wacBind.ts`'s `bindFrom` carries the whole story.
      cached = (await wacBind(`${ROOT}/packages/wacc/src/api.wac`, {
        asTool: true,
        from: "reference",
        wasmFrom: "reference",
      })) as unknown as WaccApi;
    } finally {
    }
  }
  return cached;
}

/** One instrumented branch point, in counter order. */
export type CovPoint = { index: number; file: string; line: number; col: number; kind: string };

/**
 * wacc's coverage table, `index\tline\tcol\tkind\tfile` per row, in the shape the reference's
 * `CoveragePoint` already has.
 *
 * **Exported because two callers need it and a second copy would drift silently.** A coverage point
 * table is how a counter index becomes a `file:line`; parse it wrongly and attribution is wrong
 * everywhere while every count stays plausible. `harness/wacBind.ts` needs it to profile with wacc
 * rather than the reference — `issues/system/0163`.
 */
export function parseCovTable(text: string, entry: string): CovPoint[] {
  const out: CovPoint[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const cells = line.split("\t");
    out.push({
      index: Number(cells[0]),
      file: cells[4] ?? entry,
      line: Number(cells[1]),
      col: Number(cells[2]),
      kind: cells[3] ?? "",
    });
  }
  return out;
}

export type WaccArtifacts = {
  wasm: Uint8Array;
  /** The TypeScript that calls it — the same shape `wacBindgen` writes. */
  glue: string;
  /** `file:line` per coverage counter, empty unless `coverage` was asked for. */
  covLines: string[];
  /** The same table with its columns kept apart, for a reader that wants more than a label. */
  covPoints: CovPoint[];
  /** The names a host can call. */
  exports: string[];
};

/**
 * Compile `entry` with wacc and generate its glue.
 *
 * Throws with what is wrong rather than returning half an answer: a module the emitter declined and
 * a signature the generator declined are different failures, and a caller handed an empty artifact
 * for either would report neither.
 */
/**
 * The compile, cached on what it actually depends on — **and grants are not among them**.
 *
 * `buildApp` caches the finished application, whose key includes the grants because they are baked into
 * the launcher. The *compile* underneath it does not take grants at all: `packages/box`'s tests ask for
 * the same program with seven different sets, and each one paid a full whole-program compile — 5.4 s of
 * the same 180 files, seven times, in one test file. Two builds differing only in grants are byte
 * identical up to the manifest section, which is appended.
 *
 * So the wasm, the glue and the coverage table are cached here, keyed on the sources, the entry, and
 * whether this is a coverage or an optimised build. `wacTestRun` and `wacCoverage` call this too, so
 * they get the same reuse. `issues/system/0193`.
 */
export async function waccArtifacts(
  files: Map<string, string>,
  entry: string,
  opts: {
    coverage?: boolean;
    optimize?: (wasm: Uint8Array) => Promise<Uint8Array>;
    /** See `compileArtifacts`. `wacFilesWithRoots` is what produces both of these. */
    roots?: Map<string, string>;
    base?: string;
  } = {},
): Promise<WaccArtifacts> {
  const cacheKey = await compileKey(
    files,
    entry,
    opts.coverage === true,
    opts.optimize !== undefined,
    opts.roots,
    opts.base,
  );
  if (cacheKey !== null) {
    const hit = await readCompiled(cacheKey);
    if (hit !== null) return hit;
  }
  const made = await compileArtifacts(files, entry, opts);
  if (cacheKey !== null) await writeCompiled(cacheKey, made);
  return made;
}

/** The key: everything the compile reads, and nothing it does not. Null when the compiler is unknown. */
async function compileKey(
  files: Map<string, string>,
  entry: string,
  coverage: boolean,
  optimize: boolean,
  roots: Map<string, string> | undefined,
  base: string | undefined,
): Promise<string | null> {
  const compiler = await compilerKeyParts();
  if (compiler === null) return null;
  return await contentKey([
    // **2, because the roots below changed what a key means.** An entry written before them holds a
    // build whose `@/` imports resolved to nothing; served against a key that now includes them it
    // would answer a correctly-resolved question with the declined artefact. `filesParts` covers file
    // *contents*, and a project's root is not in any of them.
    "wacc-artifacts 2",
    entry,
    coverage ? "coverage" : "plain",
    optimize ? "optimized" : "asis",
    // Sorted: a `Map`'s order follows insertion, so one project walked from two entries would
    // otherwise key differently and each would miss the other's artefact.
    ...[...(roots ?? new Map<string, string>())]
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([p, r]) => `root ${p} ${r}`),
    `base ${base ?? ""}`,
    ...compiler,
    ...filesParts(files),
  ]);
}

/** Everything but the module, which is kept beside it as bytes rather than encoded into this. */
type Stored = {
  glue: string;
  covLines: string[];
  covPoints: CovPoint[];
  exports: string[];
};

/**
 * The module is its own file.
 *
 * Base64 in the JSON would be the obvious shape and costs a third more bytes, a dependency this
 * container cannot reach — jsr.io is not on the proxy's allowlist, as `harness/deadline.test.ts` says —
 * and an encode and decode of 900 KB on every hit.
 */
async function readCompiled(key: string): Promise<WaccArtifacts | null> {
  try {
    const meta = `.cache/wacc-artifacts/${key}.json`;
    const wasmPath = `.cache/wacc-artifacts/${key}.wasm`;
    const stored = JSON.parse(await Deno.readTextFile(meta)) as Stored;
    const wasm = await Deno.readFile(wasmPath);
    // Touched so pruning drops what is unused rather than what was built first.
    await Deno.utime(meta, new Date(), new Date()).catch(() => {});
    await Deno.utime(wasmPath, new Date(), new Date()).catch(() => {});
    return { ...stored, wasm };
  } catch {
    return null;
  }
}

async function writeCompiled(key: string, a: WaccArtifacts): Promise<void> {
  const stored: Stored = {
    glue: a.glue,
    covLines: a.covLines,
    covPoints: a.covPoints,
    exports: a.exports,
  };
  // Through `cached`, which writes to a temporary name and renames: two runs missing the same key
  // write the same path at once, and the bytes are identical by construction so the only hazard is a
  // reader seeing half a file. The module goes first, so a reader that finds the metadata finds both.
  await cacheFile("wacc-artifacts", key, ".wasm", async (tmp) => {
    await Deno.writeFile(tmp, a.wasm);
  }).catch(() => {});
  await cacheFile("wacc-artifacts", key, ".json", async (tmp) => {
    await Deno.writeTextFile(tmp, JSON.stringify(stored));
  }).catch(() => {});
}

async function compileArtifacts(
  files: Map<string, string>,
  entry: string,
  opts: {
    coverage?: boolean;
    optimize?: (wasm: Uint8Array) => Promise<Uint8Array>;
    /**
     * The project root each path sits in, keyed by path — `wacFilesWithRoots` computes it.
     *
     * Without it a `@/` specifier cannot resolve through this path: the root-less API variants build
     * an empty `Res`, and an outsider compiling their own project got "an import of a file that was
     * not supplied" where `wac build` compiled it. GitHub issue 21.
     *
     * **And for a year of commits this option was declared and never read.** Its name appeared once
     * in this file — in the type above — while every call below went to the root-less variant, so the
     * paragraph explaining what breaks without it described what happened *with* it. Both compilers
     * failed, in different words, which is what sent GitHub issue 22 looking for two loaders instead
     * of one unread parameter. An option a caller cannot make a difference with is worse than none:
     * `packages/platform/test/project.test.ts` is the test that would have said so.
     */
    roots?: Map<string, string>;
    /** The directory relative keys are measured from — `Deno.cwd()` for a caller that walked from it. */
    base?: string;
  } = {},
): Promise<WaccArtifacts> {
  const api = await waccApi();
  const paths = [...files.keys()];
  const sources = paths.map((p) => files.get(p)!);
  const res = waccRes(api, paths, opts.roots ?? new Map(), opts.base ?? "");

  // **The checker first.** This asked only what the *emitter* declined, so a program with type
  // errors was built and run as long as the emitter could guess its way through: an example here
  // imported two names `platform.wac` does not export, was reported by `diagnoseFiles`, and shipped
  // anyway. The reference path never had this hole — `wacCompile` answers `ok: false` and
  // `build.ts` throws — so flipping the default carried it in. `issues/lang/0105`.
  //
  // **Every file, not just the entry.** One checking pass walks only the entry's bodies, so a type
  // error in an imported file was silent and the emitter — which compiles every body — wrote a module
  // that failed validation at instantiation with a wasm-level mismatch in place of a source line
  // (`issues/lang/0118`). The cost is bounded by checking each file against *its own* closure rather
  // than the whole graph: box's 179 files go from 61ms to 1.6s, and a build is cached, so that is
  // once per program rather than once per test. Swept over all 73 programs here before switching:
  // nothing was hiding.
  const diagnostics = api.diagnoseGraphIn(paths, sources, res, entry);
  if (diagnostics !== "") {
    const lines = diagnostics.split("\n").filter((l) => l !== "").map((l) => {
      const [file, line, col, phase, message, , hint] = l.split("\t");
      return `  ${file}:${line}:${col} [${phase}] ${message}${hint ? ` — ${hint}` : ""}`;
    });
    throw new Error(`${entry} did not compile:\n${lines.join("\n")}`);
  }


  // **One call for the whole build.** `describeFiles` and `emitFiles` each build their own front —
  // link, lex, parse, and `settleEmittable`'s fixed point over every declaration — so asking
  // separately paid for two. `buildFiles` does both from one. A coverage build still takes the old
  // pair: it needs `emitFilesCovered`, whose front carries different flags, and it is rare enough
  // that a second front costs nobody anything. `issues/lang/0129`.
  const built = opts.coverage
    ? null
    : api.buildFilesIn(paths, sources, res, entry);

  const raw = built === null
    ? api.emitFilesCoveredIn(paths, sources, res, entry)
    : built.wasm;

  // **One call for both.** Asking separately rebuilt the whole front end twice — link, lex, parse,
  // and `settleEmittable`'s fixed point over every declaration — to produce two strings that are
  // always wanted together. About 10% off a build: `packages/box` went 4561ms to 4081ms and
  // `packages/wacc` 1830ms to 1589ms. `issues/lang/0129` has the rest, which is still there.
  // `packages/wacc/test/wac/describewac_test.wac` holds the one call against the two it replaced.
  const described = (built === null ? api.describeFilesIn(paths, sources, res, entry) : built.described)
    .split(api.describeSeparator());
  const blocked = described[0] ?? "";
  if (blocked !== "") throw new Error(`wacc cannot compile ${entry} yet — ${blocked}`);
  const sigs = parseSigs(described[1] ?? "");
  const wire = described[2] ?? "";
  const types = parseBindTypes(wire);
  const cbs = parseCallbacks(wire);
  const outs = parseOutRefs(wire);
  const declined = unsupported(sigs, types, cbs, outs);
  if (declined.length > 0) {
    throw new Error(`wacc's bindgen declined ${entry}: ${declined.join("; ")}`);
  }

  // `index\tline\tcol\tkind\tfile` per counter, in counter order. The caller gets `file:line` so the
  // dump carries lines rather than indices and nothing needs a second copy of this table.
  const covPoints: CovPoint[] = opts.coverage
    ? parseCovTable(api.covTableFilesIn(paths, sources, res, entry), entry)
    : [];
  const covLines = covPoints.map((p) => `${p.file}:${p.line}`);

  // **Optimised before the glue is written**, because the glue embeds the bytes: generating first and
  // optimising after would leave a module inside the glue that is not the module that runs.
  let bytes = Uint8Array.from(raw as unknown as number[]);
  if (opts.optimize) bytes = Uint8Array.from(await opts.optimize(bytes));

  return {
    wasm: bytes,
    glue: generate(bytes, sigs, types, cbs, outs, parseAliases(wire), { coverage: !!opts.coverage }),
    covLines,
    covPoints,
    exports: sigs.map((s) => s.name),
  };
}
