// The squiggles in the margin.
//
// **The same compiler the page compiles and runs with**, which it was not until the TypeScript
// reference was deleted: this called `wacCompile` while everything else asked wacc, so the gutter
// could be red about a program that built and ran, or silent about one that did not. That is
// `issues/lang/0105` — checked with one compiler, run with the other — in the one place a reader
// looks first.

import { type Diagnostic } from "@codemirror/lint";
import { type EditorView } from "@codemirror/view";
import { diagnose } from "./wac-compile";
import type { WaccDiagnostic } from "./wacc-compile";
import type { FileMap } from "./file-store";

/** Convert a wacc diagnostic (1-indexed line/col) to a CM Diagnostic (char offset). */
function errorToCM(err: WaccDiagnostic, doc: string, fileName: string): Diagnostic | null {
  // Only show errors from the current file
  if (err.file !== fileName) return null;

  const lines = doc.split("\n");
  let offset = 0;
  for (let i = 0; i < err.line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }
  const from = offset + Math.max(0, err.col - 1);
  const to = Math.min(doc.length, from + err.width);
  let message = err.phase === "" ? err.message : `[${err.phase}] ${err.message}`;
  if (err.hint !== "") message += `\nHelp: ${err.hint}`;
  // wacc's `diagnoseFiles` reports what stops a program compiling, so everything it says is an
  // error. The reference carried a severity because it also emitted warnings; nothing here does.
  return { from, to, severity: "error", message };
}

/**
 * Creates a CM6 lint source for wac files.
 */
export function wacLintSource(
  getFiles: () => FileMap,
  getFileName: () => string,
) {
  return (view: EditorView): Diagnostic[] => {
    const doc = view.state.doc.toString();
    const fileName = getFileName();

    // Live editor content for the current file, which is the whole point of linting as you type.
    const files = { ...getFiles(), [fileName]: doc };

    const diagnostics: Diagnostic[] = [];
    for (const err of diagnose(files, fileName)) {
      const d = errorToCM(err, doc, fileName);
      if (d) diagnostics.push(d);
    }
    return diagnostics;
  };
}
