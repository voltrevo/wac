// The front page: the claim, one thing running, and the way in to everything else.
//
// It used to be the whole site — a dozen screens with a contents list two screens down, which is a
// shape that asks a first-time reader to scroll past four subsystems to find out whether they care.
// Everything here is meant to be read; the pages it points at are meant to be chosen.

import InlineDemo from "./editor/InlineDemo";
import { GITHUB, s, tp } from "./theme";
import { PAGES, Page } from "./chrome";
import { TOTALS } from "./data/built";

// The shortest program that shows what the language is for: a struct with a method, an array, and
// a loop, compiled in the reader's own browser by the same `wacCompile` the playground calls.
const EX_FRONT = `export struct Histogram {
  i32[] bins;

  /// A histogram with \`n\` empty bins.
  Histogram of(i32 n) { return Histogram(i32[n]()); }

  void add(this, i32 v) {
    this.bins[v % this.bins.len()]++;
  }

  i32 peak(const this) {
    i32 best = 0;
    for (i32 i = 0; i < this.bins.len(); i++) {
      if (this.bins[i] > best) { best = this.bins[i]; }
    }
    return best;
  }
}

export i32 busiest(i32[] hours) {
  Histogram h = Histogram.of(24);
  for (i32 i = 0; i < hours.len(); i++) { h.add(hours[i]); }
  return h.peak();
}`;

export default function Landing() {
  return (
    <Page current="home">
      <div style={{ textAlign: "center", marginTop: 8 }}>
        <h1
          style={{
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
          }}
        >
          wac
        </h1>
      </div>
      <div style={{ ...s.tagline, textAlign: "center" as const }}>
        A C-family language for WebAssembly GC. Structs, methods, subtyping,
        generics, enums with payloads, nullable refs — and WebAssembly&rsquo;s own
        collector owns the heap, so there is no allocator to write.
      </div>
      <div style={{ ...s.tagline, textAlign: "center" as const, fontSize: 16, marginTop: -18 }}>
        Braces or indentation —{" "}
        <a href="#/language/surfaces" style={{ color: "#2dd4bf", textDecoration: "none" }}>
          {tp(".wac")} and {tp(".wapy")}
        </a>{" "}
        are one language, and compile to the same bytes.
      </div>

      <div style={{ ...s.buttons, justifyContent: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <a href="#/playground" style={s.btnPrimary}>Playground</a>
        <a href="shell.html" style={s.btnDemo}>Shell in your browser →</a>
        <a href={GITHUB} target="_blank" rel="noopener" style={s.btnSecondary}>GitHub</a>
      </div>
      <div style={{ textAlign: "center", fontSize: 13, color: "#6b7280", marginBottom: 40 }}>
        also running here:{" "}
        <a href="hash.html" style={{ color: "#9ca3af" }}>hash &amp; compress</a>,{" "}
        <a href="pixels.html" style={{ color: "#9ca3af" }}>pixels</a> — whole wac applications on a
        worker, <a href="#/built/demos" style={{ color: "#9ca3af" }}>how they work here</a>
      </div>

      {/* Numbers from wac-mono's generated map; rounded, because this repo's Pages build has no
          wac-mono beside it to check them. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 1,
          background: "#2e2e3e",
          border: "1px solid #2e2e3e",
          borderRadius: 6,
          overflow: "hidden",
          marginBottom: 48,
        }}
      >
        {[
          ["packages", String(TOTALS.packages)],
          ["lines of wac", `~${Math.round(TOTALS.lines / 1000)}k`],
          // Both suites — the compiler's and wac-mono's. The package table on "what is built"
          // shows the packages' own figure, which is the smaller half.
          ["tests", `~${Math.round(TOTALS.testsAll / 100) * 100}`],
          ["programs", String(TOTALS.programs)],
          ["compiler", "~16k TS"],
          ["ts in packages", "0"],
        ].map(([label, value]) => (
          <div key={label} style={{ background: "#181825", padding: "12px 14px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {label}
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 20, color: "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* One thing running, rather than a description of things running. It compiles in this tab. */}
      <div style={{ ...s.section, marginBottom: 40 }}>
        <h2 style={s.h2}>This compiles in your browser</h2>
        <p style={s.p}>
          Edit it and press run. The compiler is pure TypeScript with no dependencies — no LLVM, no
          binaryen, no toolchain — so the same ~16,000 lines that build a Tor relay on a command line
          are the ones answering here.
        </p>
        <InlineDemo initialCode={EX_FRONT} />
      </div>

      <div style={{ marginBottom: 48 }}>
        <h2 style={{ ...s.h2, marginBottom: 16 }}>Where to go</h2>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {PAGES.map(({ href, label, blurb }) => (
            <a
              key={href}
              href={href}
              style={{
                display: "block",
                background: "#181825",
                border: "1px solid #2e2e3e",
                borderRadius: 8,
                padding: "16px 18px",
                textDecoration: "none",
              }}
            >
              <div style={{ color: "#2dd4bf", fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                {label} →
              </div>
              <div style={{ color: "#9ca3af", fontSize: 14, lineHeight: 1.5 }}>{blurb}</div>
            </a>
          ))}
        </div>
      </div>

      <div
        style={{
          ...s.section,
          backgroundColor: "#181825",
          border: "1px solid #2e2e3e",
          borderRadius: 8,
          padding: "20px 24px",
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 600, color: "#e2e8f0", marginBottom: 8 }}>
          Pure TypeScript. Zero dependencies.
        </div>
        <p style={{ ...s.p, marginBottom: 0 }}>
          The entire compiler — lexer, parser, resolver, type checker, WasmGC emitter, and binary
          builder — is pure TypeScript with no native code, no LLVM, no binaryen, no wasm toolchain.
          It runs in the browser and in Deno or Node. The compiler, runtime and bindgen total
          ~16,000 lines: 14,780 from lexer to emitter, and 1,286 more for the runtime and bindgen.
        </p>
      </div>
    </Page>
  );
}
