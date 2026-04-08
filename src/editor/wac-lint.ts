import { type Diagnostic } from "@codemirror/lint";
import { type EditorView } from "@codemirror/view";
import { wacCompile, type CompileError } from "../../atoms/wac/wacCompile.ts";
import type { FileMap } from "./file-store";

/** Convert a CompileError (1-indexed line/col) to a CM Diagnostic (char offset). */
function errorToCM(err: CompileError, doc: string, fileName: string): Diagnostic | null {
  // Only show errors from the current file
  if (err.file !== fileName) return null;

  const lines = doc.split("\n");
  let offset = 0;
  for (let i = 0; i < err.line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }
  const from = offset + Math.max(0, err.col - 1);
  // Extend highlight to end of current token (word or operator)
  let to = from;
  if (to < doc.length && /\w/.test(doc[to])) {
    while (to < doc.length && /\w/.test(doc[to])) to++;
  } else {
    to = Math.min(doc.length, from + 1);
  }
  return { from, to, severity: "error", message: `[${err.phase}] ${err.message}` };
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
    const files = getFiles();

    const fileMap = new Map<string, string>();
    for (const [k, v] of Object.entries(files)) fileMap.set(k, v);
    // Use live editor content for current file
    fileMap.set(fileName, doc);

    const result = wacCompile(fileMap, fileName);
    if (result.ok) return [];

    const diagnostics: Diagnostic[] = [];
    for (const err of result.errors) {
      const d = errorToCM(err, doc, fileName);
      if (d) diagnostics.push(d);
    }
    return diagnostics;
  };
}
