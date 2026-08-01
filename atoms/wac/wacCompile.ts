// Top-level wac compiler pipeline — lex → parse → resolve → typecheck → emit.
//
// Accepts a map of file paths to source strings and an entry file path.
// Returns either a WacCompiled result (wasm bytes + export metadata) or errors.
// Each phase runs in order; later phases are skipped on earlier errors.

import { wacLex } from "./wacLex.ts";
import { wacParse, type Program } from "./wacParse.ts";
import { wacResolve, funcParams, funcReturnType, type ResolveResult } from "./wacResolve.ts";
import { wacTypeCheck } from "./wacTypeCheck.ts";
import { wasmBuildBin, wasmBindStructs } from "./wasmBuildBin.ts";
import type { CoveragePoint } from "./wacEmitFunc.ts";
import type { WacType } from "./wacParse.ts";

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Compile options.
 *
 * `coverage` instruments every branch point with a counter and exports
 * `__cov_init` / `__cov_len` / `__cov_get` to drive them. Instrumented modules
 * are larger and slower, so this is off by default and should never be what
 * ships. With it off the output is byte-for-byte what it was before.
 */
export type WacCompileOptions = { coverage?: boolean };

export type WacParam    = { name: string; type: string };
export type WacExport   = { name: string; params: WacParam[]; ret: string };
/** A struct a JS caller can reach, with its fields and methods as type *strings*. */
export type WacStruct = {
  /** The `__bind_s_<this>_…` component of its accessors, and a legal TS identifier. */
  bind: string;
  /** The name a *type* refers to it by, which is what `typeStr` produces for a field or parameter. */
  wac: string;
  /** What to call it — a generic instantiation reads as `Vec<i32>` rather than its mangled name. */
  display: string;
  fields: { name: string; type: string; isConst: boolean }[];
  methods: { name: string; params: { name: string; type: string }[]; ret: string }[];
};

export type WacCompiled = {
  wasm: Uint8Array;
  exports: WacExport[];
  /**
   * The structs reachable from an exported signature.
   *
   * A struct is not a value JavaScript can hold, so it crosses as an opaque reference and its
   * contents are reached through generated accessors. This is what tells `wacBindgen` which classes
   * to write.
   */
  structs: WacStruct[];
  /**
   * The instrumented branch points, index-aligned with the counter array, when
   * compiled with `coverage`. A counter index means nothing without this — it is
   * what turns counts into per-file, per-line coverage.
   */
  coverage?: CoveragePoint[];
};

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
  options: WacCompileOptions = {},
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
  const coverage = options.coverage ? { points: [], file: entry } : undefined;
  const wasm = wasmBuildBin(resolveResult, programs, { coverage });
  const exports = extractExports(resolveResult);
  const structs: WacStruct[] = wasmBindStructs(resolveResult, programs).map((s) => ({
    bind: s.bind,
    wac: s.wac,
    display: s.display,
    fields: s.fields.map((f) => ({ name: f.name, type: typeStr(f.type), isConst: f.isConst })),
    methods: s.methods.map((m) => ({
      name: m.name,
      params: m.params.map((p) => ({ name: p.name, type: typeStr(p.type) })),
      ret: typeStr(m.ret),
    })),
  }));
  return {
    ok: true,
    compiled: { wasm, exports, structs, coverage: coverage?.points },
    diagnostics,
  };
}
