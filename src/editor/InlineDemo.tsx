import { useState, useRef, useEffect, useMemo } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, bracketMatching, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { linter } from "@codemirror/lint";
import { wac as wacLang, wapy as wapyLang } from "./wac-language";
import { wacLintSource } from "./wac-lint";
import { compile, runFunction, placeholderFor, type EditorCompileResult } from "./wac-compile";
import type { WacExport } from "../../atoms/wac/wacCompile.ts";

const highlight = HighlightStyle.define([
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
]);

/**
 * The demo file's name, which is not cosmetic: the extension selects the frontend, so a `.wapy`
 * demo compiles through `wapyParse` and a `.wac` one through `wacParse`. Same `wacCompile` call
 * either way — the runner below does not know which surface it just ran.
 */
const FILE_FOR = { wac: "/demo/main.wac", wapy: "/demo/main.wapy" } as const;

export type Surface = keyof typeof FILE_FOR;

function CompactRunner({ func, code, file }: { func: WacExport; code: string; file: string }) {
  const [args, setArgs] = useState<string[]>(() => func.params.map(() => ""));
  const [output, setOutput] = useState<{ success: boolean; output: string } | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const files = { [file]: code };
      const r = await runFunction(files, file, func.name, args);
      setOutput(r);
    } catch (e) {
      setOutput({ success: false, output: (e as Error).message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontFamily: "monospace", fontSize: 13, color: "#60a5fa" }}>{func.name}({func.params.length === 0 && ")"}</span>
      {func.params.map((p, i) => (
        <input
          key={p.name}
          type="text"
          value={args[i]}
          onChange={(e) => { const n = [...args]; n[i] = e.target.value; setArgs(n); }}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          placeholder={`${p.name}: ${placeholderFor(p.type)}`}
          style={{
            width: Math.max(80, placeholderFor(p.type).length * 8 + 40),
            background: "#181825",
            border: "1px solid #2e2e3e",
            borderRadius: 4,
            color: "#e2e8f0",
            padding: "3px 6px",
            fontSize: 12,
            fontFamily: "monospace",
            outline: "none",
          }}
        />
      ))}
      {func.params.length > 0 && <span style={{ fontFamily: "monospace", fontSize: 13, color: "#60a5fa" }}>)</span>}
      <button
        onClick={run}
        disabled={running}
        style={{
          background: "#2563eb",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          padding: "3px 12px",
          fontSize: 12,
          cursor: "pointer",
          opacity: running ? 0.6 : 1,
        }}
      >
        Run
      </button>
      {output && (
        <span style={{
          fontFamily: "monospace",
          fontSize: 13,
          color: output.success ? "#4ade80" : "#f87171",
        }}>
          {func.params.length > 0 ? "= " : ""}{output.output}
        </span>
      )}
    </div>
  );
}

interface Props {
  initialCode: string;
  /** Which surface the code is written in. Defaults to wac. */
  surface?: Surface;
}

export default function InlineDemo({ initialCode, surface = "wac" }: Props) {
  const FILE = FILE_FOR[surface];
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [code, setCode] = useState(initialCode);
  const codeRef = useRef(code);
  codeRef.current = code;

  const result: EditorCompileResult = useMemo(() => {
    const files = { [FILE]: code };
    return compile(files, FILE);
  }, [code]);

  useEffect(() => {
    if (!containerRef.current) return;

    const filesRef = { current: () => ({ [FILE]: codeRef.current }) };
    const fileNameRef = { current: () => FILE };

    const state = EditorState.create({
      doc: initialCode,
      extensions: [
        lineNumbers(),
        history(),
        bracketMatching(),
        syntaxHighlighting(highlight),
        surface === "wapy" ? wapyLang() : wacLang(),
        linter(wacLintSource(filesRef.current, fileNameRef.current), { delay: 300 }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) setCode(update.state.doc.toString());
        }),
        EditorView.theme({
          "&": { fontSize: "13px", backgroundColor: "#181825" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": { caretColor: "#f8fafc" },
          ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#f8fafc" },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "#334155" },
          ".cm-gutters": { backgroundColor: "#181825", color: "#4a4a5a", borderRight: "1px solid #2e2e3e" },
          ".cm-activeLine": { backgroundColor: "#1e293b" },
          ".cm-diagnostic-error": { borderLeft: "3px solid #f87171", color: "#e2e8f0", backgroundColor: "#1a1a2e", padding: "4px 8px" },
          ".cm-tooltip-lint": { backgroundColor: "#1a1a2e", border: "1px solid #2e2e3e" },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => view.destroy();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const exports = result.ok ? result.exports : [];

  return (
    <div style={{ border: "1px solid #2e2e3e", borderRadius: 6, overflow: "hidden", marginBottom: 16 }}>
      <div ref={containerRef} />
      {exports.length > 0 && (
        <div style={{ borderTop: "1px solid #2e2e3e", padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6, backgroundColor: "#1e1e2e" }}>
          {exports.map((f) => (
            <CompactRunner key={f.name} func={f} code={code} file={FILE} />
          ))}
        </div>
      )}
      {!result.ok && (
        <div style={{ borderTop: "1px solid #2e2e3e", padding: "8px 12px", fontSize: 12, color: "#f87171", fontFamily: "monospace", backgroundColor: "#1e1e2e", whiteSpace: "pre-wrap" }}>
          {result.errors[0]}
        </div>
      )}
    </div>
  );
}
