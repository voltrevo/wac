// The site's shared visual vocabulary: palette, CodeMirror theme, the read-only code blocks,
// the style objects and the little inline-token helpers.
//
// Lifted out of `Landing.tsx` verbatim when the landing page grew sections of its own file. It is
// one palette and one set of spacing tokens, in one place, because the alternative is two that
// drift — and this repo's own site had exactly that problem in miniature already: the highlight
// colours were declared once in `Landing.tsx` and again in `editor/InlineDemo.tsx`.

import { useRef, useEffect } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { tags } from "@lezer/highlight";
import { wac as wacLang, wapy as wapyLang } from "./editor/wac-language";

export const GITHUB = "https://github.com/voltrevo/wac";
export const MONO = "https://github.com/voltrevo/wac-mono";

// Reuse the same highlight palette everywhere
export const hl = {
  kw: "#c084fc",
  type: "#22d3ee",
  str: "#4ade80",
  num: "#f0abfc",
  fn: "#60a5fa",
  op: "#fb923c",
  comment: "#6b7280",
  punct: "#9ca3af",
  var: "#e2e8f0",
  def: "#2dd4bf",
  bool: "#fbbf24",
};

const darkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: hl.kw },
  { tag: tags.typeName, color: hl.type },
  { tag: tags.bool, color: hl.bool },
  { tag: tags.string, color: hl.str },
  { tag: tags.number, color: hl.num },
  { tag: tags.comment, color: hl.comment, fontStyle: "italic" },
  { tag: tags.operator, color: hl.op },
  { tag: tags.punctuation, color: hl.punct },
  { tag: tags.variableName, color: hl.var },
  { tag: tags.definition(tags.function(tags.variableName)), color: hl.fn, fontWeight: "bold" },
  { tag: tags.function(tags.variableName), color: hl.fn },
  { tag: tags.definition(tags.variableName), color: hl.def },
  { tag: tags.propertyName, color: hl.var },
]);

const cmTheme = EditorView.theme({
  "&": { backgroundColor: "#181825", fontSize: "13px" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-gutters": { backgroundColor: "#181825", color: "#4a4a5a", borderRight: "1px solid #2e2e3e" },
  ".cm-content": { caretColor: "transparent", padding: "12px 0" },
  ".cm-cursor": { display: "none" },
  ".cm-activeLine": { backgroundColor: "transparent" },
});

/** The three things a code block on this page can be written in. */
/** `text` is program output rather than source — no grammar, so nothing is coloured. */
export type Lang = "wac" | "wapy" | "ts" | "text";

export function CodeBlock({ code, lang }: { code: string; lang: Lang }) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    viewRef.current?.destroy();
    const langExt = lang === "ts"
      ? javascript({ typescript: true })
      : lang === "wapy" ? wapyLang() : lang === "text" ? [] : wacLang();
    const state = EditorState.create({
      doc: code,
      extensions: [
        // Program output has no lines worth numbering, and a gutter makes it read as source.
        ...(lang === "text" ? [] : [lineNumbers()]),
        langExt,
        syntaxHighlighting(darkHighlight),
        EditorView.lineWrapping,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        cmTheme,
      ],
    });
    const view = new EditorView({ state, parent: ref.current });
    viewRef.current = view;
    return () => view.destroy();
  }, [code, lang]);

  return (
    <div
      ref={ref}
      style={{
        border: "1px solid #2e2e3e",
        borderRadius: 6,
        overflow: "hidden",
      }}
    />
  );
}

export function SideBySide({ left, right, leftLabel, rightLabel, leftLang, rightLang }: {
  left: string; right: string;
  leftLabel: string; rightLabel: string;
  leftLang: Lang; rightLang: Lang;
}) {
  // Equalize heights by padding the shorter code block
  const leftLines = left.split("\n").length;
  const rightLines = right.split("\n").length;
  const maxLines = Math.max(leftLines, rightLines);
  const padLeft = left + "\n".repeat(maxLines - leftLines);
  const padRight = right + "\n".repeat(maxLines - rightLines);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
      <div>
        <div style={s.codeLabel}>{leftLabel}</div>
        <CodeBlock code={padLeft} lang={leftLang} />
      </div>
      <div>
        <div style={s.codeLabel}>{rightLabel}</div>
        <CodeBlock code={padRight} lang={rightLang} />
      </div>
    </div>
  );
}

export function Solo({ code, label, lang }: { code: string; label?: string; lang: Lang }) {
  return (
    <div style={{ marginBottom: 16 }}>
      {label && <div style={s.codeLabel}>{label}</div>}
      <CodeBlock code={code} lang={lang} />
    </div>
  );
}


export const s = {
  page: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#e2e8f0",
    maxWidth: 820,
    margin: "0 auto",
    padding: "3rem 2rem 6rem",
    lineHeight: 1.7,
  } as const,
  h1: { fontSize: 48, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" } as const,
  tagline: { fontSize: 20, color: "#9ca3af", marginTop: 12, marginBottom: 32 } as const,
  buttons: { display: "flex", gap: 12, marginBottom: 56 } as const,
  btnPrimary: {
    background: "#2563eb", color: "#fff", border: "none", borderRadius: 6,
    padding: "10px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer", textDecoration: "none",
  } as const,
  /** The demo call-to-action: reads as a live thing rather than a page. */
  btnDemo: {
    background: "none", color: "#2dd4bf", border: "1px solid #2dd4bf", borderRadius: 6,
    padding: "10px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer", textDecoration: "none",
  } as const,
  btnSecondary: {
    background: "none", color: "#9ca3af", border: "1px solid #2e2e3e", borderRadius: 6,
    padding: "10px 24px", fontSize: 15, cursor: "pointer", textDecoration: "none",
  } as const,
  section: { marginBottom: 48 } as const,
  h2: { fontSize: 24, fontWeight: 600, marginBottom: 12, color: "#e2e8f0" } as const,
  h3: { fontSize: 17, fontWeight: 600, marginBottom: 8, color: "#e2e8f0" } as const,
  p: { color: "#9ca3af", fontSize: 15, marginBottom: 12 } as const,
  codeLabel: {
    fontSize: 11, color: "#6b7280", textTransform: "uppercase" as const,
    letterSpacing: "0.05em", marginBottom: 6,
  } as const,
  inline: {
    backgroundColor: "#181825", border: "1px solid #2e2e3e",
    padding: "1px 5px", borderRadius: 3, fontSize: 13,
    fontFamily: "monospace", color: hl.type,
  } as const,
  ul: { color: "#9ca3af", fontSize: 15, paddingLeft: 20, marginBottom: 12 } as const,
};

export const kw = (c: string) => <span style={{ ...s.inline, color: hl.kw }}>{c}</span>;
export const tp = (c: string) => <span style={{ ...s.inline, color: hl.type }}>{c}</span>;
export const fn_ = (c: string) => <span style={{ ...s.inline, color: hl.fn }}>{c}</span>;
export const op = (c: string) => <span style={{ ...s.inline, color: hl.op }}>{c}</span>;

