import InlineDemo from "./editor/InlineDemo";
import { CodeBlock, fn_, GITHUB, hl, kw, MONO, op, s, SideBySide, Solo, tp } from "./theme";
import Built from "./sections/Built";
import { TOTALS } from "./data/built";
import CaseStudies from "./sections/CaseStudies";


// Enums and generics: the two features the tour did not have and the tagline did not mention.
// Both compile and run in the browser through `InlineDemo`, and both were run through `wacx`
// before being put here — the generic one twice, because `Pair.of(x, y)` in a return position
// has nothing to infer the type argument from and the spec's form is a typed declaration.

const EX_ENUM = `enum Shape {
  Circle(f64 r), Rect(f64 w, f64 h)

  f64 area(const this) {
    return match (this) {
      case Circle(r): 3.14159 * r * r,
      case Rect(w, h): w * h
    };
  }
}

export f64 circle(f64 r) { return Shape.Circle(r).area(); }
export f64 rect(f64 w, f64 h) { return Shape.Rect(w, h).area(); }`;

const EX_GENERIC = `struct Pair<T> {
  T a;
  T b;

  Pair<T> of(T a, T b) { return Pair<T>(a, b); }
  T left(const this) { return this.a; }
}

export i32 leftInt(i32 x, i32 y) {
  Pair<i32> p = Pair.of(x, y);
  return p.left();
}

export string leftStr(string x, string y) {
  Pair<string> p = Pair.of(x, y);
  return p.left();
}`;

// ── The two surfaces ─────────────────────────────────────────────────────────
//
// `EX_SURFACE_WAPY` is not hand-written. It is what `wapyPrint.ts` emits for `EX_SURFACE_WAC`,
// pasted here — so the pair cannot drift into a claim the compiler would not make. Both were
// compiled through `wacx` before being put here, and the two binaries are byte-identical, which
// `wapySpec.test.ts` asserts so the sentence below stays true.

const EX_SURFACE_WAC = `export struct Histogram {
  i32[] bins;

  /// A histogram with \`n\` empty bins.
  Histogram of(i32 n) { return Histogram(i32[n]()); }

  void add(this, i32 v) {
    i32 i = v < 0 ? 0 : v;
    this.bins[i % this.bins.len()]++;
  }

  i32 peak(const this) {
    i32 best = 0;
    for (i32 i = 0; i < this.bins.len(); i++) {
      if (this.bins[i] > best) { best = this.bins[i]; }
    }
    return best;
  }
}`;

const EX_SURFACE_WAPY = `@export
class Histogram:
    bins: i32[]

    ## A histogram with \`n\` empty bins.
    def of(n: i32) -> Histogram:
        return Histogram(i32[n]())

    def add(self, v: i32) -> void:
        i: i32 = 0 if v < 0 else v
        self.bins[i % self.bins.len()]++

    def peak(const self) -> i32:
        best: i32 = 0
        for i in range(0, self.bins.len()):
            if self.bins[i] > best:
                best = self.bins[i]
        return best`;

// Editable and runnable, in wapy, compiled by the same `wacCompile` call as every other demo on
// the page — the only difference is that the file is called `.wapy`. Run through `wacx` first;
// `fizzbuzz(15)` gives `1 2 Fizz 4 Buzz Fizz 7 8 Fizz Buzz 11 Fizz 13 14 FizzBuzz`.
const EX_WAPY_LIVE = `@export
def fizzbuzz(n: i32) -> string:
    out: string = ""
    for i in range(1, n + 1):
        if i % 15 == 0:
            out = out + "FizzBuzz "
        elif i % 3 == 0:
            out = out + "Fizz "
        elif i % 5 == 0:
            out = out + "Buzz "
        else:
            out = out + itoa(i) + " "
    return out

def itoa(v: i32) -> string:
    if v == 0:
        return "0"
    s: string = ""
    n: i32 = v
    while n > 0:
        s = DIGITS[n % 10] + s
        n = n / 10
    return s

const DIGITS: string[] = string[]("0", "1", "2", "3", "4", "5", "6", "7", "8", "9")`;

const EX_MIXED_WAC = `import { Histogram } from "./hist.wapy";

export i32 tallest(i32[] xs, i32 n) {
  Histogram h = Histogram.of(n);
  for (i32 i = 0; i < xs.len(); i++) {
    h.add(xs[i]);
  }
  return h.peak();
}`;

// From packages/crypto/src/layout.wac, unabridged. On the page because it is the shortest
// illustration of the per-word tax entry 2 of the wishlist describes.
const EX_BEWORD = `// packages/crypto/src/layout.wac
export u32 beWord32(u8[] b, i32 i) {
  return ((b[i] << 24) | (b[i + 1] << 16)
        | (b[i + 2] << 8) | b[i + 3]) as@ u32;
}`;

const EX_MIXED_WAPY = `from "./stats.wac" import tallest

@export
def busiest(xs: i32[]) -> i32:
    return tallest(xs, 24)`;

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

// `core` is the one import that is not a file. Two files that never mention each other, meeting
// through a type neither declares — which is the whole point, and is why the pair is checked by
// tools/site.test.ts rather than being prose.
const EX_CORE_MAIN = `import { Read } from core;
import { describe } from "./report.wac";

export string demo() {
  return describe(Read.Data(u8[](1, 2, 3)))
    + " | " + describe(Read.End)
    + " | " + describe(Read.Failed("disk went away"));
}`;

const EX_CORE_LIB = `import { Read } from core;

export string describe(Read r) {
  match (r) {
    case Data(bytes): return "read some bytes";
    case End:         return "finished";
    case Failed(why): return "failed: " + why;
  }
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
        A C-family language for WebAssembly GC. Structs, methods, subtyping,
        generics, enums with payloads, nullable refs — and WebAssembly's own
        collector owns the heap, so there is no allocator to write.
      </div>
      {/* The second surface is the newest thing here and the easiest to miss twelve screens
          down, so it gets one line at the top with the claim that makes it not a transpiler. */}
      <div style={{ ...s.tagline, textAlign: "center" as const, fontSize: 16, marginTop: -18 }}>
        Braces or indentation —{" "}
        <a href="#surfaces" style={{ color: "#2dd4bf", textDecoration: "none" }}>
          {tp(".wac")} and {tp(".wapy")}
        </a>{" "}
        are one language, and compile to the same bytes.
      </div>

      <div style={{ ...s.buttons, justifyContent: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <a href="#/playground" style={s.btnPrimary}>Playground</a>
        {/* A real shell, in a tab, from packages/sh unchanged. It was two thirds of the way down
            the page and nobody would ever have found it. */}
        <a href="shell.html" style={s.btnDemo}>Shell in your browser →</a>
        <a href={GITHUB} target="_blank" rel="noopener" style={s.btnSecondary}>GitHub</a>
      </div>
      <div style={{ textAlign: "center", fontSize: 13, color: "#6b7280", marginBottom: 40 }}>
        also running here:{" "}
        <a href="hash.html" style={{ color: "#9ca3af" }}>hash &amp; compress</a>,{" "}
        <a href="pixels.html" style={{ color: "#9ca3af" }}>pixels</a> — whole wac applications on a
        worker, <a href="#demos" style={{ color: "#9ca3af" }}>how they work here</a>
      </div>

      {/* What exists, before the tour of how it reads. Numbers from wac-mono's generated map;
          rounded, because this repo's Pages build has no wac-mono beside it to check them. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 1,
          background: "#2e2e3e",
          border: "1px solid #2e2e3e",
          borderRadius: 6,
          overflow: "hidden",
          marginBottom: 56,
        }}
      >
        {[
          ["packages", String(TOTALS.packages)],
          ["lines of wac", `~${Math.round(TOTALS.lines / 1000)}k`],
          ["tests", `~${Math.round(TOTALS.tests / 100) * 100}`],
          ["programs", String(TOTALS.programs)],
          ["compiler", "~6k TS"],
          ["ts in packages", "0"],
        ].map(([label, value]) => (
          <div key={label} style={{ background: "#181825", padding: "12px 14px" }}>
            <div
              style={{
                fontSize: 11,
                color: "#6b7280",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontFamily: "monospace",
                fontSize: 20,
                color: "#e2e8f0",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {value}
            </div>
          </div>
        ))}
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

      {/* The page is a dozen screens tall; without this the second half is undiscoverable.
          The showcase page it was merged from had a contents list and this did not. */}
      <nav
        aria-label="Sections"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 20px",
          padding: "14px 0",
          borderTop: "1px solid #2e2e3e",
          borderBottom: "1px solid #2e2e3e",
          marginBottom: 44,
          fontSize: 13,
        }}
      >
        {[
          ["#tour", "language tour"],
          ["#surfaces", "two surfaces"],
          ["#bindgen", "typescript bindgen"],
          ["#built", "what is built"],
          ["#capabilities", "capabilities"],
          ["#demos", "run one here"],
          ["#shell", "a shell"],
          ["#tor", "tor"],
          ["#ethereum", "bls12-381 & ssz"],
          ["#wasm-gaps", "what wasm is missing"],
        ].map(([href, label], i) => (
          <a key={href} href={href} style={{ color: "#9ca3af", textDecoration: "none" }}>
            <span style={{ color: "#2dd4bf", fontVariantNumeric: "tabular-nums" }}>
              {String(i + 1).padStart(2, "0")}
            </span>{" "}
            {label}
          </a>
        ))}
      </nav>

      {/* Language tour */}
      <div style={s.section} id="tour">
        <h2 style={s.h2}>Language tour</h2>

        <h3 style={s.h3}>Hello world</h3>
        <p style={s.p}>
          Functions have explicit return types. {kw("export")} makes them
          available to the host and other {tp(".wac")} files.
        </p>
        <InlineDemo initialCode={EX_HELLO} />

        <h3 style={s.h3}>Primitives and control flow</h3>
        <p style={s.p}>
          Types: {tp("i32")} {tp("i64")} {tp("f32")} {tp("f64")} {tp("bool")} {tp("string")}.
          Full control flow: {kw("if")}/{kw("else")}, {kw("while")}, {kw("for")}, {kw("do")}-{kw("while")}, {kw("switch")}, ternary.
        </p>
        <InlineDemo initialCode={EX_MATH} />

        <h3 style={s.h3}>Error diagnostics</h3>
        <p style={s.p}>
          No implicit conversions — write {fn_("while (b != 0)")} not {fn_("while (b)")}.
          Try it — the code block above is editable! The compiler tells you
          exactly what went wrong:
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

        <h3 style={s.h3}>Enums carry payloads, and match is exhaustive</h3>
        <p style={s.p}>
          A variant may hold values, and {kw("match")} over one must cover every case — a missing
          arm is a compile error, not a fallthrough. Generic enums give you {tp("Option<T>")} and{" "}
          {tp("Result<T, E>")}, which is where wac-mono's standard library starts.
        </p>
        <InlineDemo initialCode={EX_ENUM} />

        <h3 style={s.h3}>Generics, monomorphised</h3>
        <p style={s.p}>
          A struct may take type parameters. {tp("Pair<i32>")} and {tp("Pair<string>")} are
          separate types the compiler stamps out — no boxing, and nothing erased, so a{" "}
          {tp("Vec<i32>")} holds machine integers.
        </p>
        <InlineDemo initialCode={EX_GENERIC} />

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

        <h3 style={s.h3}>One import is not a file</h3>
        <p style={s.p}>
          {kw("core")} ships inside the compiler, so it is written without quotes — there is no path
          to be right or wrong about, and it cannot be pointed anywhere else. It holds one enum, and
          the bar for a second is high.
        </p>
        <SideBySide
          leftLabel="main.wac" rightLabel="report.wac"
          left={EX_CORE_MAIN} right={EX_CORE_LIB}
          leftLang="wac" rightLang="wac"
        />
        <p style={s.p}>
          Those two files never mention each other, and neither declares {tp("Read")}. That matters
          because wac has <em>nominal</em> types and no closures: two identical declarations are two
          types, and there is nothing you could write to convert between them. Within one project
          that costs nothing — both sides import the same file. Across two published libraries it is
          fatal, so a streaming transform that names {tp("fn[Read()]")} could never be handed a
          reader built anywhere else.
        </p>
        <p style={s.p}>
          Hence the rule for what goes in {kw("core")}, which is a test rather than a taste:{" "}
          <strong style={{ color: "#e2e8f0" }}>must this type cross a repository boundary through a
          function reference?</strong> Containers and sum types do not — they live in a package, and
          a copy in each project is duplication rather than a wall. Today {tp("Read")} is the only
          thing that qualifies.
        </p>

        <p style={s.p}>
          Also: four cast modes ({op("as")} lossless, {op("as!")} checked, {op("as~")} lossy, {op("as@")} raw),
          struct subtyping via {kw("struct")} {tp("Rect")} : {tp("Shape")},
          and function references ({tp("fn[i32(i32, i32)]")}).
        </p>
      </div>

      {/* Two surfaces. New since the last time this page was written, and the thing most likely
          to be misread as a transpiler — hence the byte-identity claim, which is the shortest
          way to say that it is not one. */}
      <div style={s.section} id="surfaces">
        <h2 style={s.h2}>Two surfaces, one language</h2>
        <p style={s.p}>
          The same language can be written with braces or with indentation. {tp(".wapy")} is the
          second surface — {kw("def")}, {kw("class")}, {kw("and")}/{kw("or")}/{kw("not")},{" "}
          {kw("None")}, {kw("self")} — and it is <strong style={{ color: "#e2e8f0" }}>not
          Python</strong>: it does not accept Python, and copying Python into it is an explicit
          anti-goal. It borrows the shapes, not the semantics.
        </p>
        <SideBySide
          leftLabel="hist.wac" rightLabel="hist.wapy"
          left={EX_SURFACE_WAC} right={EX_SURFACE_WAPY}
          leftLang="wac" rightLang="wapy"
        />
        <p style={s.p}>
          These two files compile to <strong style={{ color: "#e2e8f0" }}>byte-identical
          wasm</strong>. Not the same behaviour — the same bytes. There is no transpilation step
          and no generated intermediate: {tp(".wapy")} has its own lexer and parser producing the
          same syntax tree, so a diagnostic names the line its author wrote, and the resolver,
          checker and emitter never learn which surface ran.
        </p>

        <h3 style={s.h3}>Editable, and running here</h3>
        <p style={s.p}>
          Compiled in this tab by the same {fn_("wacCompile")} call as every other demo on the
          page. The extension is what selects the frontend, so the only thing that differs is
          the file&rsquo;s name.
        </p>
        <InlineDemo initialCode={EX_WAPY_LIVE} surface="wapy" />

        <h3 style={s.h3}>Mixed freely, in one program</h3>
        <p style={s.p}>
          Neither surface is privileged, so an import graph may cross between them as often as it
          likes. Here a {tp(".wac")} file imports a class from a {tp(".wapy")} file, and a{" "}
          {tp(".wapy")} file imports a function from that {tp(".wac")} file.
        </p>
        <SideBySide
          leftLabel="stats.wac" rightLabel="report.wapy"
          left={EX_MIXED_WAC} right={EX_MIXED_WAPY}
          leftLang="wac" rightLang="wapy"
        />
        <p style={s.p}>
          wac stays the canonical form, which is a statement about documentation rather than about
          the compiler: the spec is written in it, and the converter runs in that direction so
          that <a href={`${GITHUB}/blob/master/atoms/wac/wapyRoundTrip.test.ts`} target="_blank"
          rel="noopener" style={{ color: "#2dd4bf" }}>a test</a> can convert all 50,000 lines of
          wac-mono and check that parsing the result gives back the identical syntax tree.
        </p>
      </div>

      {/* Bindgen */}
      <div style={s.section}>
        <h2 style={s.h2} id="bindgen">TypeScript bindgen</h2>
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

      <Built />
      <CaseStudies />

      {/* What WebAssembly is missing. Evidence collected from writing 50,000 lines against it,
          which is a thing this project has and most WasmGC users do not — the languages with GC
          arrays are not parsing wire protocols with them. */}
      <div style={s.section} id="wasm-gaps">
        <h2 style={s.h2}>What WebAssembly is missing</h2>
        <p style={s.p}>
          Writing 50,000 lines of byte-heavy systems code against WasmGC — TLS, SSH, Tor, gzip,
          Zstandard, BLS12-381, SHA-2, ChaCha20 — with no C runtime underneath and no linear
          memory in the artifact turns up gaps that are hard to see from anywhere else. The
          languages that report WasmGC&rsquo;s rough edges bring Java, Kotlin, Dart and Scheme,
          where the arrays hold references and the hot loops are dispatch. The languages that
          report linear memory&rsquo;s rough edges bring C, C++ and Rust, which never touch a GC
          array at all.
        </p>
        <p style={s.p}>
          {" "}
          <a href={`${GITHUB}/blob/master/WASM-WISHLIST.md`} target="_blank" rel="noopener"
             style={{ color: "#2dd4bf" }}>WASM-WISHLIST.md</a>{" "}
          is the running list: each entry is something this project wanted and could not have,
          with the code that works around it and what the workaround costs. Entries are marked
          verified, believed or speculative, and the distinction is load-bearing — integer rotate
          looked like a missing instruction until someone checked and found {fn_("i32.rotl")} has
          existed since 2017 and it was wac that had no way to spell it.
        </p>
        <ul style={s.ul}>
          <li>
            <strong style={{ color: "#e2e8f0" }}>Nothing copies between a GC array and linear
            memory.</strong> {fn_("array.copy")} takes two array type indices, {fn_("memory.copy")}{" "}
            takes two memory operands, and there is no instruction with one of each. Assembling one{" "}
            {tp("v128")} from a GC array costs 32 instructions — as much as the vector operation
            saves.
          </li>
          <li>
            <strong style={{ color: "#e2e8f0" }}>GC arrays are read one element at a time.</strong>{" "}
            No way to read four bytes of an {tp("(array i8)")} as an {tp("i32")}, so every word of
            every SHA-2 block, TLS record header and Tor cell costs about ten instructions where a{" "}
            {fn_("i32.load")} is one:
          </li>
        </ul>
        <Solo code={EX_BEWORD} lang="wac" />
        <ul style={s.ul}>
          <li>
            <strong style={{ color: "#e2e8f0" }}>There is no byte swap.</strong> Wasm loads are
            little-endian and most wire protocols are big-endian. This one inverted a conclusion in
            our own design work: SHA-256 looked like the obvious argument for linear memory and
            turned out to be among the weakest, because the swap eats the gain.
          </li>
          <li>
            <strong style={{ color: "#e2e8f0" }}>SIMD has no lane rotate.</strong> Scalar wasm has
            had {fn_("i32.rotl")} since the MVP. Every vector rotate is three instructions, which
            is 12 of the 20 in a vectorised ChaCha20 half-round — and add-rotate-xor is the shape
            of ChaCha20, Salsa20, BLAKE2, BLAKE3, SHA-1, SHA-2 and Keccak alike.
          </li>
          <li>
            <strong style={{ color: "#e2e8f0" }}>No widening multiply, no add-with-carry.</strong>{" "}
            {fn_("i64.mul")} gives the low 64 bits of a 128-bit product and there is no way to ask
            for the high half, so arbitrary-precision arithmetic — and therefore BLS12-381 — works
            in 32-bit limbs.
          </li>
          <li>
            <strong style={{ color: "#e2e8f0" }}>Nothing runs when a trap unwinds.</strong> A trap
            goes straight to the host, so there is no way to release anything on the way out.
          </li>
        </ul>
        <p style={{ ...s.p, marginBottom: 0 }}>
          Four more, with the measurements, in the document.
        </p>
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid #2e2e3e", paddingTop: 24, display: "flex", gap: 24, fontSize: 13, color: "#6b7280" }}>
        <a href="#/playground" style={{ color: "#9ca3af", textDecoration: "none" }}>Playground</a>
        <a href={`${GITHUB}/tree/master/spec`} target="_blank" rel="noopener" style={{ color: "#9ca3af", textDecoration: "none" }}>Language Spec</a>
        <a href={GITHUB} target="_blank" rel="noopener" style={{ color: "#9ca3af", textDecoration: "none" }}>GitHub</a>
        <a href={MONO} target="_blank" rel="noopener" style={{ color: "#9ca3af", textDecoration: "none" }}>wac-mono</a>
        <span style={{ marginLeft: "auto", color: "#4a4a5a" }}>
          Snippets are real source from those repositories, abridged only by removing lines.
        </span>
      </div>
    </div>
  );
}
