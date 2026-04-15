// wacCompile — single-call entry point for the wac compiler pipeline.
// Chains wacResolve → wacTypeCheck → wasmBuildBin and returns either
// a compiled wasm binary with export metadata, or a list of errors.

import { wacResolve, type CompileError } from "./wacResolve.ts";
import { wacTypeCheck } from "./wacTypeCheck.ts";
import { wasmBuildBin, type WacExport } from "./wasmBuildBin.ts";

// ---- Exported types ----

export type { CompileError };

export type Cap = {
  readFile(path: string): string;
};

export type WacCompileResult =
  | { ok: true;  wasm: Uint8Array; exports: WacExport[] }
  | { ok: false; errors: CompileError[] };

// ---- Main export ----

export function wacCompile(cap: Cap, entryPath: string): WacCompileResult {
  const resolved = wacResolve(cap, entryPath);
  if (resolved.errors.length > 0) return { ok: false, errors: resolved.errors };

  const typed = wacTypeCheck(resolved);
  if (typed.errors.length > 0) return { ok: false, errors: typed.errors };

  const { wasm, exports } = wasmBuildBin(typed);
  return { ok: true, wasm, exports };
}
