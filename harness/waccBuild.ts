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
import {
  generate, parseAliases, parseBindTypes, parseCallbacks, parseOutRefs, parseSigs, unsupported,
} from "../packages/wacc/tools/waccBindgen.ts";

/** The half of wacc's API a build uses. */
type WaccApi = {
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
  describeSeparator: () => string;
  covTableFiles: (paths: string[], sources: string[], entry: string) => string;
  /** Trace instrumentation — an ordered journal of branches *and array indices*. `harness/ctTrace.ts`. */
  emitFilesTraced: (paths: string[], sources: string[], entry: string) => Uint8Array;
  traceTableFiles: (paths: string[], sources: string[], entry: string) => string;
  /** The same with the journal sized by the caller — `issues/lang/0059`. */
  emitFilesTracedSlots: (paths: string[], sources: string[], entry: string, slots: number) => Uint8Array;
};

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
      cached = (await wacBind("packages/wacc/src/api.wac", {
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
export async function waccArtifacts(
  files: Map<string, string>,
  entry: string,
  opts: { coverage?: boolean; optimize?: (wasm: Uint8Array) => Promise<Uint8Array> } = {},
): Promise<WaccArtifacts> {
  const api = await waccApi();
  const paths = [...files.keys()];
  const sources = paths.map((p) => files.get(p)!);

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
  const diagnostics = api.diagnoseGraph(paths, sources, entry);
  if (diagnostics !== "") {
    const lines = diagnostics.split("\n").filter((l) => l !== "").map((l) => {
      const [file, line, col, phase, message, , hint] = l.split("\t");
      return `  ${file}:${line}:${col} [${phase}] ${message}${hint ? ` — ${hint}` : ""}`;
    });
    throw new Error(`${entry} did not compile:\n${lines.join("\n")}`);
  }


  const raw = opts.coverage
    ? api.emitFilesCovered(paths, sources, entry)
    : api.emitFiles(paths, sources, entry);

  // **One call for both.** Asking separately rebuilt the whole front end twice — link, lex, parse,
  // and `settleEmittable`'s fixed point over every declaration — to produce two strings that are
  // always wanted together. About 10% off a build: `packages/box` went 4561ms to 4081ms and
  // `packages/wacc` 1830ms to 1589ms. `issues/lang/0129` has the rest, which is still there.
  // `packages/wacc/test/describe_wac.test.ts` holds the one call against the two it replaced.
  const described = api.describeFiles(paths, sources, entry).split(api.describeSeparator());
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
  const covPoints: CovPoint[] = [];
  if (opts.coverage) {
    for (const line of api.covTableFiles(paths, sources, entry).split("\n")) {
      if (line === "") continue;
      const cells = line.split("\t");
      covPoints.push({
        index: Number(cells[0]),
        file: cells[4] ?? entry,
        line: Number(cells[1]),
        col: Number(cells[2]),
        kind: cells[3] ?? "",
      });
    }
  }
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
