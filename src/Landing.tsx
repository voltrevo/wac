import { useRef, useEffect } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { tags } from "@lezer/highlight";
import { wac as wacLang } from "./editor/wac-language";

const GITHUB = "https://github.com/voltrevo/wac";

// Reuse the same highlight palette everywhere
const hl = {
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

function CodeBlock({ code, lang }: { code: string; lang: "wac" | "ts" }) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    viewRef.current?.destroy();
    const langExt = lang === "ts" ? javascript({ typescript: true }) : wacLang();
    const state = EditorState.create({
      doc: code,
      extensions: [
        lineNumbers(),
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

function SideBySide({ left, right, leftLabel, rightLabel, leftLang, rightLang }: {
  left: string; right: string;
  leftLabel: string; rightLabel: string;
  leftLang: "wac" | "ts"; rightLang: "wac" | "ts";
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

function Solo({ code, label, lang }: { code: string; label?: string; lang: "wac" | "ts" }) {
  return (
    <div style={{ marginBottom: 16 }}>
      {label && <div style={s.codeLabel}>{label}</div>}
      <CodeBlock code={code} lang={lang} />
    </div>
  );
}

function Inline({ children }: { children: string }) {
  return <span style={s.inline}>{children}</span>;
}

const s = {
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

const kw = (c: string) => <span style={{ ...s.inline, color: hl.kw }}>{c}</span>;
const tp = (c: string) => <span style={{ ...s.inline, color: hl.type }}>{c}</span>;
const fn_ = (c: string) => <span style={{ ...s.inline, color: hl.fn }}>{c}</span>;
const op = (c: string) => <span style={{ ...s.inline, color: hl.op }}>{c}</span>;

// ── Example code ─────────────────────────────────────────────────────────────

const EX_HELLO = `export string hello() {
  return "Hello, world!";
}`;

const EX_MATH = `export i32 gcd(i32 a, i32 b) {
  while (b != 0) {
    i32 t = b;
    b = a % b;
    a = t;
  }
  return a;
}`;

const EX_ERROR = `// What if you write while(b) instead of while(b != 0)?
//
// error: condition must be bool
//   --> main.wac:2:10
//    |
//  2 |   while (b) {
//    |          ^ expected bool, found i32
//    = help: use a comparison: if (b != 0) { ... }`;

const EX_STRUCT = `export struct Point {
  f64 x;
  f64 y;

  Point create(f64 x, f64 y) {
    return Point(x, y);
  }

  f64 distanceSq(const this, Point other) {
    f64 dx = this.x - other.x;
    f64 dy = this.y - other.y;
    return dx * dx + dy * dy;
  }
}`;

const EX_NULLABLE = `struct Node {
  i32 val;
  Node? next;
}

export i32 sum(Node? head) {
  i32 total = 0;
  Node? cur = head;
  while (cur is not null) {
    total += cur!.val;
    cur = cur!.next;
  }
  return total;
}`;

const EX_ARRAYS = `export i32 sumArray(i32[] arr) {
  i32 total = 0;
  for (i32 i = 0; i < arr.len(); i++) {
    total += arr[i];
  }
  return total;
}`;

const EX_IMPORTS_MAIN = `import { gcd, pow } from "./math.wac";

export i32 test() {
  return gcd(48, 18) * pow(2, 3);
  // 6 * 8 = 48
}`;

const EX_IMPORTS_MATH = `export i32 gcd(i32 a, i32 b) {
  while (b != 0) {
    i32 t = b;
    b = a % b;
    a = t;
  }
  return a;
}

export i32 pow(i32 base, i32 exp) {
  i32 result = 1;
  while (exp > 0) {
    if (exp % 2 == 1) {
      result = result * base;
    }
    base = base * base;
    exp = exp / 2;
  }
  return result;
}`;

const EX_BINDGEN = `// Generated by wacBindgen — zero dependencies
const _wasm = Uint8Array.from(
  atob("AGFzbQEAAAA..."),
  (c) => c.charCodeAt(0),
);

const _instance =
  await WebAssembly.instantiate(_wasm);
const _exports =
  _instance.instance.exports;

export function sumArray(
  arr: Int32Array,
): number {
  const _w_arr = _arrayToWasm_i32(arr);
  return (_exports.sumArray as
    CallableFunction)(_w_arr) as number;
}`;

// ── Component ────────────────────────────────────────────────────────────────

export default function Landing() {
  return (
    <div style={s.page}>
      {/* Gradient glow */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, height: 500,
        background: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(192,132,252,0.12) 0%, transparent 100%)",
        pointerEvents: "none", zIndex: 0,
      }} />

      {/* Hero */}
      <div style={{ textAlign: "center" }}>
        <h1 style={{
          display: "inline-block",
          fontSize: 110,
          fontWeight: 700,
          fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
          margin: 0,
          background: "linear-gradient(135deg, #d8b4fe 0%, #a855f7 30%, #6366f1 60%, #22d3ee 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          letterSpacing: "-0.03em",
        }}>wac</h1>
      </div>
      <div style={{ ...s.tagline, textAlign: "center" as const }}>
        A C-family language for WebAssembly GC. Structs, methods, arrays,
        nullable refs, subtyping.
      </div>

      <div style={{ ...s.buttons, justifyContent: "center" }}>
        <a href="#/playground" style={s.btnPrimary}>Playground</a>
        <a href={GITHUB} target="_blank" rel="noopener" style={s.btnSecondary}>GitHub</a>
      </div>

      {/* Zero deps */}
      <div style={{ ...s.section, backgroundColor: "#181825", border: "1px solid #2e2e3e", borderRadius: 8, padding: "20px 24px" }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: "#e2e8f0", marginBottom: 8 }}>
          Pure TypeScript. Zero dependencies.
        </div>
        <p style={{ ...s.p, marginBottom: 0 }}>
          The entire compiler — lexer, parser, resolver, type checker, WasmGC
          emitter, and binary builder — is pure TypeScript with no native code,
          no LLVM, no binaryen, no wasm toolchain. It runs in the browser (the
          playground compiles everything client-side) and in Deno/Node. The
          compiler, runtime, and bindgen total ~6,000 lines.
        </p>
      </div>

      {/* Language tour */}
      <div style={s.section}>
        <h2 style={s.h2}>Language tour</h2>

        <h3 style={s.h3}>Hello world</h3>
        <p style={s.p}>
          Functions have explicit return types. {kw("export")} makes them
          available to the host and other {tp(".wac")} files.
        </p>
        <Solo code={EX_HELLO} lang="wac" />

        <h3 style={s.h3}>Primitives and control flow</h3>
        <p style={s.p}>
          Types: {tp("i32")} {tp("i64")} {tp("f32")} {tp("f64")} {tp("bool")} {tp("string")}.
          Full control flow: {kw("if")}/{kw("else")}, {kw("while")}, {kw("for")}, {kw("do")}-{kw("while")}, {kw("switch")}, ternary.
        </p>
        <Solo code={EX_MATH} lang="wac" />

        <h3 style={s.h3}>Error diagnostics</h3>
        <p style={s.p}>
          No implicit conversions — write {fn_("while (b != 0)")} not {fn_("while (b)")}.
          The compiler tells you exactly what went wrong:
        </p>
        <Solo code={EX_ERROR} lang="wac" />

        <h3 style={s.h3}>Structs and methods</h3>
        <p style={s.p}>
          Structs compile to WasmGC struct types. Methods use {kw("this")} (mutable)
          or {kw("const")} {kw("this")} (readonly). Static methods omit {kw("this")}.
        </p>
        <Solo code={EX_STRUCT} lang="wac" />

        <h3 style={s.h3}>Nullable references</h3>
        <p style={s.p}>
          {op("?")} makes a type nullable. {op("!")} unwraps (traps on null).
          Test with {kw("is")} {kw("null")} / {kw("is")} {kw("not")} {kw("null")}.
        </p>
        <Solo code={EX_NULLABLE} lang="wac" />

        <h3 style={s.h3}>Arrays</h3>
        <p style={s.p}>
          GC-managed arrays with {fn_(".len()")} and bounds checking.
          Construct with {tp("i32[5]()")} (sized) or {tp("i32[](1,2,3)")} (fixed).
        </p>
        <Solo code={EX_ARRAYS} lang="wac" />

        <h3 style={s.h3}>Multi-file imports</h3>
        <p style={s.p}>
          File-based imports with {kw("import")} / {kw("from")}. Diamond
          imports resolve correctly. Rename with {kw("as")} to avoid collisions.
        </p>
        <SideBySide
          leftLabel="main.wac" rightLabel="math.wac"
          left={EX_IMPORTS_MAIN} right={EX_IMPORTS_MATH}
          leftLang="wac" rightLang="wac"
        />

        <p style={s.p}>
          Also: four cast modes ({op("as")} lossless, {op("as!")} checked, {op("as~")} lossy, {op("as@")} raw),
          struct subtyping via {kw("struct")} {tp("Rect")} : {tp("Shape")},
          and function references ({tp("fn[i32(i32, i32)]")}).
        </p>
      </div>

      {/* Bindgen */}
      <div style={s.section}>
        <h2 style={s.h2}>TypeScript bindgen</h2>
        <p style={s.p}>
          {fn_("wacBindgen")} produces a self-contained {tp(".ts")} file
          with the wasm binary base64-encoded inline and typed wrapper functions.
          Zero runtime dependencies. Primitive arrays automatically marshal between
          JS typed arrays and WasmGC arrays.
        </p>
        <SideBySide
          leftLabel="wac source" rightLabel="generated typescript"
          left={EX_ARRAYS} right={EX_BINDGEN}
          leftLang="wac" rightLang="ts"
        />
      </div>

      {/* How it was built */}
      <div style={s.section}>
        <h2 style={s.h2}>How it was built</h2>
        <p style={s.p}>
          The language spec (~15 markdown files covering types, structs, control
          flow, imports, errors, etc.) was written collaboratively by a human and
          AI. Then the compiler was implemented autonomously by Claude Sonnet
          from the spec alone, with zero user intervention.
        </p>
        <p style={s.p}>
          The initial unsupervised run took <strong>6 hours</strong> and produced
          the core compiler pipeline — lex, parse, resolve, typecheck, WasmGC
          emit, binary builder, instantiation (139 tests). A follow-up run where
          the only instruction was "you missed some things, reread the spec" took{" "}
          <strong>1 hour 8 minutes</strong> and added bindgen, structured
          diagnostics, and string support (734 tests). A final pass after
          updating the spec took <strong>25 minutes</strong> and fixed all
          identified bugs (749 tests). In each case the agent was not told what
          was wrong — it figured it out from the spec.
        </p>
        <p style={s.p}>
          Grand total: <strong>~7.5 hours</strong> of Claude Sonnet compute —
          18% of the weekly quota on Claude Max 5x ($18).
        </p>
        <p style={s.p}>
          The first pass had a few bugs — null as a constructor argument emitted
          untyped refs, struct methods broke when mixing nullable reference and
          primitive fields, and the parser didn't support unwrap ({op("!")}) on
          the left side of assignment. All were caught by adding spec tags for
          the expected behavior, then telling the agent "spec updated, update
          the implementation." It fixed all of them without being told what was
          wrong.
        </p>
        <p style={s.p}>
          The compiler now produces rich structured diagnostics with span,
          annotation, and help text — matching the spec's error format exactly.
        </p>
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid #2e2e3e", paddingTop: 24, display: "flex", gap: 24, fontSize: 13, color: "#6b7280" }}>
        <a href="#/playground" style={{ color: "#9ca3af", textDecoration: "none" }}>Playground</a>
        <a href={GITHUB} target="_blank" rel="noopener" style={{ color: "#9ca3af", textDecoration: "none" }}>GitHub</a>
      </div>
    </div>
  );
}
