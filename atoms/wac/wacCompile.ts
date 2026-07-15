// Top-level wac compiler pipeline — lex → parse → resolve → typecheck → emit.
//
// Accepts a map of file paths to source strings and an entry file path.
// Returns either a WacCompiled result (wasm bytes + export metadata) or errors.
// Each phase runs in order; later phases are skipped on earlier errors.

import { wacLex } from "./wacLex.ts";
import { wacParse, type Program } from "./wacParse.ts";
import { wacResolve, funcParams, funcReturnType, type ResolveResult } from "./wacResolve.ts";
import { wacTypeCheck } from "./wacTypeCheck.ts";
import { wasmBuildBin } from "./wasmBuildBin.ts";
import type { WacType } from "./wacParse.ts";

// ── Public types ──────────────────────────────────────────────────────────────

export type WacParam    = { name: string; type: string };
export type WacExport   = { name: string; params: WacParam[]; ret: string };
export type WacCompiled = { wasm: Uint8Array; exports: WacExport[] };

export type CompileDiagnostic = {
  message: string;
  file: string;
  line: number;
  col: number;
  phase: "lex" | "parse" | "resolve" | "typecheck";
  severity: "error" | "warning";
  span: number;
  annotation?: string;
  hint?: string;
  /** First line of leading context for multi-line spans */
  contextStart?: number;
};

// `ok` is false iff at least one diagnostic has severity "error" — warnings
// alone never fail a compile [see errors.md].
export type CompileResult =
  | { ok: true;  compiled: WacCompiled; diagnostics: CompileDiagnostic[] }
  | { ok: false; diagnostics: CompileDiagnostic[] };

// ── Type name serialization ───────────────────────────────────────────────────

/** Serialize a WacType to a human-readable type name string. */
export function typeStr(t: WacType): string {
  switch (t.kind) {
    case "prim":     return t.name;
    case "struct":   return t.name;
    case "array":    return `${typeStr(t.elem)}[]`;
    case "nullable": return `${typeStr(t.inner)}?`;
    case "funcref": {
      const ps = t.params.map(typeStr).join(", ");
      return `fn[${typeStr(t.ret)}(${ps})]`;
    }
  }
}

// ── Export metadata extraction ────────────────────────────────────────────────

function extractExports(result: ResolveResult): WacExport[] {
  const out: WacExport[] = [];
  for (const f of result.funcs) {
    if (!f.exportName) continue;
    if (f.filePath !== result.entryPath) continue;
    const ps = funcParams(f).map(p => ({ name: p.name, type: typeStr(p.type) }));
    out.push({ name: f.exportName, params: ps, ret: typeStr(funcReturnType(f)) });
  }
  return out;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

/**
 * Compile a set of wac source files to a wasm binary with export metadata.
 *
 * @param files   Map from file path to source text; must include entry + all imports.
 * @param entry   The file path to use as the compilation entry point.
 */
export function wacCompile(
  files: Map<string, string>,
  entry: string,
): CompileResult {
  const diagnostics: CompileDiagnostic[] = [];
  const programs = new Map<string, Program>();
  const hasError = () => diagnostics.some(d => d.severity === "error");

  // Phase 1 & 2: lex + parse every file (these phases only produce errors)
  for (const [path, src] of files) {
    const { tokens, errors: lexErrs } = wacLex(src);
    for (const e of lexErrs) {
      diagnostics.push({ span: 1, ...e, file: path, phase: "lex", severity: "error" });
    }
    // Parse even if there were lex errors (best-effort recovery)
    const { program, errors: parseErrs } = wacParse(tokens, path);
    for (const e of parseErrs) {
      diagnostics.push({ span: 1, ...e, phase: "parse", severity: "error" });
    }
    programs.set(path, program);
  }

  if (hasError()) return { ok: false, diagnostics };

  // Phase 3: resolve import graph and build flat symbol table
  const resolveResult = wacResolve(entry, programs);
  for (const e of resolveResult.errors) {
    diagnostics.push({ span: 1, ...e, phase: "resolve", severity: "error" });
  }

  if (hasError()) return { ok: false, diagnostics };

  // Phase 4: type check all functions and methods (may also produce warnings)
  const typeDiags = wacTypeCheck(resolveResult, programs);
  for (const e of typeDiags) {
    diagnostics.push({ span: 1, severity: "error", ...e, phase: "typecheck" });
  }

  if (hasError()) return { ok: false, diagnostics };

  // Phase 5: emit wasm binary (cannot fail after successful typecheck)
  const wasm = wasmBuildBin(resolveResult, programs);
  const exports = extractExports(resolveResult);
  return { ok: true, compiled: { wasm, exports }, diagnostics };
}
