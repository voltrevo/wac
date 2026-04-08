// wacDiag — pretty-prints compile errors as structured diagnostics.
//
// Each error gets:
//   error: <message>
//     --> file:line:col
//      |
//   L  | source line
//      |   ^^^ annotation
//      = help: hint
//
// Gutter width scales with the number of digits in the line number.

import type { CompileError } from "./wacCompile.ts";

export type DiagError = CompileError & {
  /** Number of characters to underline (default: 1). */
  span?: number;
  /** Annotation text placed after the underline carets. */
  annotation?: string;
  /** Help text shown as `= help: ...` after the underline. */
  hint?: string;
  /** If set, show source lines from this line through e.line (for multi-line spans). */
  contextStart?: number;
};

/**
 * Format an array of compile errors as a human-readable diagnostic string.
 * `sources` maps file paths to their source text.
 */
export function wacDiag(
  errors: DiagError[],
  sources: Map<string, string>,
): string {
  return errors.map(e => formatDiag(e, sources)).join("\n\n");
}

function formatDiag(e: DiagError, sources: Map<string, string>): string {
  const src = sources.get(e.file) ?? "";
  const srcLines = src.split("\n");

  const lineNum = e.line;
  const digits = Math.max(String(lineNum).length, 1);
  const gutter = digits + 2; // 1 for space after digits, 1 for the leading space
  const pad = " ".repeat(gutter);
  const arrowPad = " ".repeat(gutter - 1);

  const lineText = srcLines[lineNum - 1] ?? "";

  let out = `error: ${e.message}\n`;
  out += `${arrowPad}--> ${e.file}:${lineNum}:${e.col}\n`;
  out += `${pad}|\n`;

  // Context lines (for multi-line spans)
  const contextStart = e.contextStart ?? lineNum;
  for (let ln = contextStart; ln < lineNum; ln++) {
    const text = srcLines[ln - 1] ?? "";
    out += ` ${String(ln).padStart(digits)} | ${text}\n`;
  }

  // The error line
  out += ` ${String(lineNum).padStart(digits)} | ${lineText}\n`;

  // Underline
  const underlineStart = Math.max(0, e.col - 1);
  const underlineLen = e.span ?? 1;
  let underlineLine = `${pad}| ${" ".repeat(underlineStart)}${"^".repeat(underlineLen)}`;
  if (e.annotation) underlineLine += ` ${e.annotation}`;
  out += underlineLine;

  if (e.hint) {
    out += `\n${pad}= help: ${e.hint}`;
  }

  return out;
}
