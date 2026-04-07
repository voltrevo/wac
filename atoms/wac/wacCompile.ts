// Top-level wac compiler pipeline — lex → parse → resolve → typecheck → emit.
//
// Accepts a map of file paths to source strings and an entry file path.
// Returns either a compiled wasm binary or a list of structured errors.
// Each phase runs in order; later phases are skipped on earlier errors.

import { wacLex } from "./wacLex.ts";
import { wacParse, type Program } from "./wacParse.ts";
import { wacResolve } from "./wacResolve.ts";
import { wacTypeCheck } from "./wacTypeCheck.ts";
import { wasmBuildBin } from "./wasmBuildBin.ts";

// ── Public types ──────────────────────────────────────────────────────────────

export type CompileError = {
  message: string;
  file: string;
  line: number;
  col: number;
  phase: "lex" | "parse" | "resolve" | "typecheck";
};

export type CompileResult =
  | { ok: true;  bytes: Uint8Array }
  | { ok: false; errors: CompileError[] };

// ── Pipeline ──────────────────────────────────────────────────────────────────

/**
 * Compile a set of wac source files to a wasm binary.
 *
 * @param files   Map from file path to source text; must include entry + all imports.
 * @param entry   The file path to use as the compilation entry point.
 */
export function wacCompile(
  files: Map<string, string>,
  entry: string,
): CompileResult {
  const errors: CompileError[] = [];
  const programs = new Map<string, Program>();

  // Phase 1 & 2: lex + parse every file
  for (const [path, src] of files) {
    const { tokens, errors: lexErrs } = wacLex(src);
    for (const e of lexErrs) {
      errors.push({ ...e, file: path, phase: "lex" });
    }
    // Parse even if there were lex errors (best-effort recovery)
    const { program, errors: parseErrs } = wacParse(tokens, path);
    for (const e of parseErrs) {
      errors.push({ ...e, phase: "parse" });
    }
    programs.set(path, program);
  }

  if (errors.length) return { ok: false, errors };

  // Phase 3: resolve import graph and build flat symbol table
  const resolveResult = wacResolve(entry, programs);
  for (const e of resolveResult.errors) {
    errors.push({ ...e, phase: "resolve" });
  }

  if (errors.length) return { ok: false, errors };

  // Phase 4: type check all functions and methods
  const typeErrors = wacTypeCheck(resolveResult, programs);
  for (const e of typeErrors) {
    errors.push({ ...e, phase: "typecheck" });
  }

  if (errors.length) return { ok: false, errors };

  // Phase 5: emit wasm binary (cannot fail after successful typecheck)
  const bytes = wasmBuildBin(resolveResult, programs);
  return { ok: true, bytes };
}
