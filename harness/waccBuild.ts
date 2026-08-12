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
  generate, parseBindTypes, parseCallbacks, parseOutRefs, parseSigs, unsupported,
} from "../packages/wacc/tools/waccBindgen.ts";

/** The half of wacc's API a build uses. */
type WaccApi = {
  emitFiles: (paths: string[], sources: string[], entry: string) => Uint8Array;
  emitFilesCovered: (paths: string[], sources: string[], entry: string) => Uint8Array;
  blockedFiles: (paths: string[], sources: string[], entry: string) => string;
  exportSigsFiles: (paths: string[], sources: string[], entry: string) => string;
  bindTypesFiles: (paths: string[], sources: string[], entry: string) => string;
  covTableFiles: (paths: string[], sources: string[], entry: string) => string;
};

let cached: WaccApi | null = null;

/** wacc, built by the reference. */
export async function waccApi(): Promise<WaccApi> {
  if (cached === null) {
    const saved = Deno.env.get("WAC_BIND_FROM");
    // **Set, not deleted**: unset means the default, and the default is wacc — which would be wacc
    // built by wacc, a seed built by the thing it seeds.
    Deno.env.set("WAC_BIND_FROM", "reference");
    try {
      cached = (await wacBind("packages/wacc/src/api.wac")) as unknown as WaccApi;
    } finally {
      if (saved === undefined) Deno.env.delete("WAC_BIND_FROM");
      else Deno.env.set("WAC_BIND_FROM", saved);
    }
  }
  return cached;
}

export type WaccArtifacts = {
  wasm: Uint8Array;
  /** The TypeScript that calls it — the same shape `wacBindgen` writes. */
  glue: string;
  /** `file:line` per coverage counter, empty unless `coverage` was asked for. */
  covLines: string[];
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

  const blocked = api.blockedFiles(paths, sources, entry);
  if (blocked !== "") throw new Error(`wacc cannot compile ${entry} yet — ${blocked}`);

  const raw = opts.coverage
    ? api.emitFilesCovered(paths, sources, entry)
    : api.emitFiles(paths, sources, entry);

  const wire = api.bindTypesFiles(paths, sources, entry);
  const sigs = parseSigs(api.exportSigsFiles(paths, sources, entry));
  const types = parseBindTypes(wire);
  const cbs = parseCallbacks(wire);
  const outs = parseOutRefs(wire);
  const declined = unsupported(sigs, types, cbs, outs);
  if (declined.length > 0) {
    throw new Error(`wacc's bindgen declined ${entry}: ${declined.join("; ")}`);
  }

  // `index\tline\tcol\tkind\tfile` per counter, in counter order. The caller gets `file:line` so the
  // dump carries lines rather than indices and nothing needs a second copy of this table.
  const covLines: string[] = [];
  if (opts.coverage) {
    for (const line of api.covTableFiles(paths, sources, entry).split("\n")) {
      if (line === "") continue;
      const cells = line.split("\t");
      covLines.push(`${cells[4] ?? entry}:${cells[1]}`);
    }
  }

  // **Optimised before the glue is written**, because the glue embeds the bytes: generating first and
  // optimising after would leave a module inside the glue that is not the module that runs.
  let bytes = Uint8Array.from(raw as unknown as number[]);
  if (opts.optimize) bytes = Uint8Array.from(await opts.optimize(bytes));

  return {
    wasm: bytes,
    glue: generate(bytes, sigs, types, cbs, outs),
    covLines,
    exports: sigs.map((s) => s.name),
  };
}
