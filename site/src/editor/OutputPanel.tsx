import { useState, useMemo, useRef, useEffect } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import type { FileMap } from "./file-store";
import type { WacExport } from "../../atoms/wac/wacCompile.ts";
import { compile, wasmHex, runFunction, generateBindgen, placeholderFor, type EditorCompileResult } from "./wac-compile";

interface Props {
  files: FileMap;
  fileName: string;
}

function WasmView({ result }: { result: EditorCompileResult }) {
  if (!result.ok) {
    return (
      <div style={{ padding: 12, color: "#f87171", fontSize: 13, whiteSpace: "pre-wrap" }}>
        {result.errors.join("\n")}
      </div>
    );
  }

  const hex = wasmHex(result.wasm);
  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 16, overflow: "auto", height: "100%" }}>
      <div>
        <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
          wasm binary ({result.wasm.length} bytes)
        </div>
        <div style={{
          fontFamily: "monospace",
          fontSize: 12,
          color: "#a5b4fc",
          backgroundColor: "#181825",
          padding: 8,
          borderRadius: 4,
          wordBreak: "break-all",
          lineHeight: 1.6,
        }}>
          {hex || "(empty)"}
        </div>
      </div>
      {result.exports.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>exports</div>
          {result.exports.map((e) => (
            <div key={e.name} style={{ fontSize: 12, fontFamily: "monospace", color: "#60a5fa", marginBottom: 2 }}>
              {e.ret} {e.name}({e.params.map((p) => `${p.type} ${p.name}`).join(", ")})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BindgenView({ result }: { result: EditorCompileResult }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const code = useMemo(() => {
    if (!result.ok) return null;
    try {
      return generateBindgen(result.compiled);
    } catch {
      return null;
    }
  }, [result]);

  useEffect(() => {
    if (!containerRef.current) return;
    viewRef.current?.destroy();

    if (!code) {
      viewRef.current = null;
      return;
    }

    const tsHighlight = HighlightStyle.define([
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
      { tag: tags.propertyName, color: "#e2e8f0" },
    ]);

    const state = EditorState.create({
      doc: code,
      extensions: [
        lineNumbers(),
        javascript({ typescript: true }),
        syntaxHighlighting(tsHighlight),
        EditorView.lineWrapping,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px", backgroundColor: "#1e1e2e" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-gutters": { backgroundColor: "#181825", color: "#6b7280", borderRight: "1px solid #2e2e3e" },
          ".cm-content": { caretColor: "transparent" },
          ".cm-cursor": { display: "none" },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => view.destroy();
  }, [code]);

  if (!result.ok) {
    return (
      <div style={{ padding: 12, color: "#f87171", fontSize: 13, whiteSpace: "pre-wrap" }}>
        {result.errors.join("\n")}
      </div>
    );
  }

  if (!code) {
    return <div style={{ padding: 12, color: "#6b7280", fontSize: 13 }}>No bindgen output</div>;
  }

  return <div ref={containerRef} style={{ height: "100%" }} />;
}

function FuncRunner({ func, files, fileName }: { func: WacExport; files: FileMap; fileName: string }) {
  const [args, setArgs] = useState<string[]>(() => func.params.map(() => ""));
  const [output, setOutput] = useState<{ success: boolean; output: string } | null>(null);
  const [running, setRunning] = useState(false);

  const setArg = (i: number, v: string) => {
    const next = [...args];
    next[i] = v;
    setArgs(next);
  };

  const run = async () => {
    setRunning(true);
    try {
      const r = await runFunction(files, fileName, func.name, args);
      setOutput(r);
    } catch (e) {
      setOutput({ success: false, output: (e as Error).message });
    } finally {
      setRunning(false);
    }
  };

  const sig = `${func.ret} ${func.name}(${func.params.map((p) => `${p.type} ${p.name}`).join(", ")})`;

  return (
    <div style={{ padding: 12, borderBottom: "1px solid #2e2e3e" }}>
      <div style={{ fontSize: 12, color: "#60a5fa", fontFamily: "monospace", marginBottom: 8 }}>
        {sig}
      </div>
      {func.params.map((p, i) => (
        <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <label style={{ fontSize: 12, color: "#9ca3af", minWidth: 60 }}>{p.name}</label>
          <input
            type="text"
            value={args[i]}
            onChange={(e) => setArg(i, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(); }}
            placeholder={placeholderFor(p.type)}
            style={{
              flex: 1,
              background: "#181825",
              border: "1px solid #2e2e3e",
              borderRadius: 4,
              color: "#e2e8f0",
              padding: "4px 8px",
              fontSize: 13,
              fontFamily: "monospace",
              outline: "none",
            }}
          />
        </div>
      ))}
      <button
        onClick={run}
        disabled={running}
        style={{
          marginTop: 6,
          background: "#2563eb",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          padding: "5px 16px",
          fontSize: 13,
          cursor: "pointer",
          opacity: running ? 0.6 : 1,
        }}
      >
        {running ? "Running..." : "Run"}
      </button>
      {output && (
        <div style={{
          marginTop: 8,
          padding: "6px 10px",
          borderRadius: 4,
          fontSize: 13,
          fontFamily: "monospace",
          backgroundColor: output.success ? "#052e16" : "#2a0a0a",
          color: output.success ? "#4ade80" : "#f87171",
        }}>
          {output.output}
        </div>
      )}
    </div>
  );
}

function RunView({ result, files, fileName }: { result: EditorCompileResult; files: FileMap; fileName: string }) {
  if (!result.ok) {
    return (
      <div style={{ padding: 12, color: "#f87171", fontSize: 13, whiteSpace: "pre-wrap" }}>
        {result.errors.join("\n")}
      </div>
    );
  }

  if (!result.exports.length) {
    return <div style={{ padding: 12, color: "#6b7280", fontSize: 13 }}>No exported functions</div>;
  }

  return (
    <div style={{ overflow: "auto", height: "100%" }}>
      {result.exports.map((f) => (
        <FuncRunner key={f.name} func={f} files={files} fileName={fileName} />
      ))}
    </div>
  );
}

type Tab = "run" | "wasm" | "ts";

export default function OutputPanel({ files, fileName }: Props) {
  const [tab, setTab] = useState<Tab>("run");

  const result = useMemo(() => compile(files, fileName), [files, fileName]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#1e1e2e", borderRadius: 4, border: "1px solid #2e2e3e" }}>
      <div style={{ display: "flex", borderBottom: "1px solid #2e2e3e", flexShrink: 0, backgroundColor: "#181825" }}>
        {(["run", "wasm", "ts"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "6px 16px",
              background: "none",
              border: "none",
              borderBottom: tab === t ? "2px solid #c084fc" : "2px solid transparent",
              color: tab === t ? "#e2e8f0" : "#6b7280",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {t === "ts" ? "TypeScript" : t}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === "wasm" && <WasmView result={result} />}
        {tab === "run" && <RunView result={result} files={files} fileName={fileName} />}
        {tab === "ts" && <BindgenView result={result} />}
      </div>
    </div>
  );
}
