import { useRef, useEffect } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { linter, lintGutter } from "@codemirror/lint";
import { wac, trapTag } from "./wac-language";
import { wacLintSource } from "./wac-lint";
import type { FileMap } from "./file-store";

const wacHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#c084fc" },
  { tag: tags.typeName, color: "#22d3ee" },
  { tag: tags.bool, color: "#fbbf24" },
  { tag: tags.string, color: "#4ade80" },
  { tag: tags.number, color: "#f0abfc" },
  { tag: tags.comment, color: "#6b7280", fontStyle: "italic" },
  { tag: tags.operator, color: "#fb923c" },
  { tag: tags.punctuation, color: "#9ca3af" },
  { tag: tags.variableName, color: "#e2e8f0" },
  { tag: tags.definition(tags.function(tags.variableName)), color: "#60a5fa", fontWeight: "bold" },
  { tag: tags.function(tags.variableName), color: "#60a5fa" },
  { tag: tags.definition(tags.variableName), color: "#2dd4bf" },
  { tag: trapTag, color: "#f87171", fontWeight: "bold" },
]);

interface Props {
  value: string;
  onChange: (value: string) => void;
  files: FileMap;
  fileName: string;
}

export default function WacEditor({ value, onChange, files, fileName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const filesRef = useRef(files);
  filesRef.current = files;
  const fileNameRef = useRef(fileName);
  fileNameRef.current = fileName;

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        highlightSelectionMatches(),
        syntaxHighlighting(wacHighlight),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        wac(),
        lintGutter(),
        linter(wacLintSource(
          () => filesRef.current,
          () => fileNameRef.current,
        ), { delay: 300 }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        updateListener,
        EditorView.theme({
          "&": { height: "100%", fontSize: "14px", backgroundColor: "#1e1e2e" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": { caretColor: "#f8fafc" },
          ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#f8fafc" },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "#334155" },
          ".cm-gutters": { backgroundColor: "#181825", color: "#6b7280", borderRight: "1px solid #2e2e3e" },
          ".cm-activeLineGutter": { backgroundColor: "#1e293b" },
          ".cm-activeLine": { backgroundColor: "#1e293b" },
          ".cm-matchingBracket": { backgroundColor: "#3b3b5c", outline: "1px solid #6366f1" },
          ".cm-diagnostic-error": { borderLeft: "3px solid #f87171", color: "#e2e8f0", backgroundColor: "#1a1a2e", padding: "4px 8px" },
          ".cm-lint-marker-error": { content: "'!'", color: "#f87171" },
          ".cm-tooltip-lint": { backgroundColor: "#1a1a2e", border: "1px solid #2e2e3e" },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => view.destroy();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      style={{
        height: "100%",
        border: "1px solid #2e2e3e",
        borderRadius: 4,
      }}
    />
  );
}
