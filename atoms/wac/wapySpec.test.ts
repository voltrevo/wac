// The claims in `spec/spec/wapy.md`, checked against the compiler.
//
// A second surface is a second thing to keep true, and a document describing it is a third.
// Each test here carries the section tag it belongs to, so a claim and its evidence can be
// found from each other.

import { wacCompile } from "./wacCompile.ts";
import { wacLex } from "./wacLex.ts";
import { wacParse } from "./wacParse.ts";
import { wapyOf } from "./wapyPrint.ts";
import { SPELLINGS } from "./wapyLex.ts";
import { wapyParse } from "./wapyParse.ts";
import { wacInstance } from "./wacInstance.ts";

function wapy(wac: string): string {
  const r = wapyOf(wac, "t.wac");
  if (r.unhandled.length) throw new Error(`unhandled: ${r.unhandled.join(", ")}`);
  return r.text.trimEnd();
}

/** A wac form and the wapy the correspondence table says it becomes. */
function prints(name: string, wac: string, want: string): void {
  Deno.test(`[§wac-wapy-h3nq7fv] ${name}`, () => {
    const got = wapy(wac);
    if (got !== want) throw new Error(`\n  wac:  ${wac}\n  got:\n${got}\n  want:\n${want}`);
  });
}

// ── §wac-wapy-h3nq7fv — the correspondence table, row by row ────────────────

prints("a function", "i32 f(i32 x) { return x; }", "def f(x: i32) -> i32:\n    return x");
prints("an export", "export i32 f() { return 1; }", "@export\ndef f() -> i32:\n    return 1");
prints("a struct", "struct P { f64 x; }", "class P:\n    x: f64");
prints("a const struct", "const struct P { f64 x; }", "@const\nclass P:\n    x: f64");
prints("a subtype", "struct B { i32 a; }\nstruct C : B { i32 b; }",
       "class B:\n    a: i32\n\nclass C(B):\n    b: i32");
prints("an enum", "enum E { A, B(i32 v) }", "class E(enum):\n    A\n    B(v: i32)");
prints("a method with a receiver", "struct P { f64 x; f64 get(P self) { return self.x; } }",
       "class P:\n    x: f64\n\n    def get(self: P) -> f64:\n        return self.x");
prints("an override", "struct B { i32 f() { return 1; } }\nstruct D : B { override i32 f() { return 2; } }",
       "class B:\n    def f() -> i32:\n        return 1\n\nclass D(B):\n    @override\n    def f() -> i32:\n        return 2");
prints("a declaration", "void f() { i32 x = 1; }", "def f() -> void:\n    x: i32 = 1");
prints("a struct literal", "struct P { f64 x; }\nP g() { return P { x: 1.0 }; }",
       "class P:\n    x: f64\n\ndef g() -> P:\n    return P(x=1.0)");
prints("an array fill", "i32[] f(i32 v) { return i32[3](fill: v); }",
       "def f(v: i32) -> i32[]:\n    return i32[3](fill=v)");
prints("generics, in a type and in an expression", "struct V<T> { T v; }\nV<i32> f() { return V<i32>(0); }",
       "class V[T]:\n    v: T\n\ndef f() -> V[i32]:\n    return V<i32>(0)");
prints("nullable, outermost and nested", "struct P { i32 a; }\nP? f() { return null; }\nP?[] g() { return P?[](2); }",
       "class P:\n    a: i32\n\ndef f() -> P | None:\n    return None\n\ndef g() -> P?[]:\n    return P?[](2)");
prints("logical operators", "bool f(bool a, bool b) { return a && b || !a; }",
       "def f(a: bool, b: bool) -> bool:\n    return a and b or not a");
prints("a conditional", "i32 f(bool c) { return c ? 1 : 2; }", "def f(c: bool) -> i32:\n    return 1 if c else 2");
prints("a counted loop", "void f(i32 n) { for (i32 i = 0; i < n; i++) { } }",
       "def f(n: i32) -> void:\n    for i in range(0, n):\n        pass");
prints("a stepped loop", "void f(i32 n) { for (i32 i = 0; i < n; i += 2) { } }",
       "def f(n: i32) -> void:\n    for i in range(0, n, 2):\n        pass");
prints("a do-while", "void f(bool c) { do { } while (c); }",
       "def f(c: bool) -> void:\n    do:\n        pass\n    while c");
prints("a bare block", "void f() { { i32 x = 1; } }", "def f() -> void:\n    scope:\n        x: i32 = 1");
prints("an empty body", "void f() { }", "def f() -> void:\n    pass");
prints("a trap", "void f() { trap; }", "def f() -> void:\n    trap()");
prints("an import", `import { a, b as c } from "./m.wac";\ni32 f() { return a() + c(); }`,
       `from "./m.wac" import a, b as c\n\ndef f() -> i32:\n    return a() + c()`);
prints("comments, ordinary and doc", "/// A doc comment.\ni32 f() { return 1; } // trailing",
       "## A doc comment.\ndef f() -> i32:\n    return 1  # trailing");

// ── §wac-wapy-switch-w9pk2hs — switch and match are distinct, and preserved ──

prints("a switch keeps its keyword", "void f(i32 x) { switch (x) { case 1: break; default: break; } }",
       "def f(x: i32) -> void:\n    switch x:\n        case 1:\n            break\n        case _:\n            break");

Deno.test("[§wac-wapy-switch-w9pk2hs] a match statement destructures", () => {
  const src = "enum E { A(i32 v), B }\ni32 f(E e) { match (e) { case A(v): return v; case B: return 0; } }";
  const out = wapy(src);
  if (!out.includes("match e:")) throw new Error(out);
  if (!out.includes("case A(v):")) throw new Error(out);
});

// ── §wac-wapy-words-p2vm9kx — the respelled words ───────────────────────────

Deno.test("[§wac-wapy-words-p2vm9kx] wapy.md's respelling list matches the lexer", async () => {
  const md = await Deno.readTextFile(new URL("../../spec/spec/wapy.md", import.meta.url));
  const m = md.match(/### Words\n[\s\S]*?```\n([\s\S]*?)```/);
  if (!m) throw new Error("could not find the respelling block in wapy.md");
  const documented = m[1].split(/\s+/).filter(Boolean).sort();
  const actual = [...SPELLINGS.keys()].sort();
  if (documented.join(" ") !== actual.join(" ")) {
    throw new Error(`wapy.md disagrees with wapyLex\n  documented: ${documented.join(" ")}\n  lexer:      ${actual.join(" ")}`);
  }
});

Deno.test("[§wac-wapy-words-p2vm9kx] a respelled word is a name after `.` and after `case`", () => {
  const src = [
    "class Opt(enum):",
    "    Some(v: i32)",
    "    None",
    "",
    "@export",
    "def has(o: Opt) -> bool:",
    "    return match o { case Some(_): True, case None: False }",
  ].join("\n");
  const e = wapyParse(src, "t.wapy").errors;
  if (e.length) throw new Error(`${e[0].line}:${e[0].col} ${e[0].message}`);
});

Deno.test("[§wac-wapy-words-p2vm9kx] wac's spelling of a respelled word is refused", () => {
  for (const [bad, good] of [["true", "True"], ["false", "False"], ["null", "None"]]) {
    const e = wapyParse(`def f() -> bool:\n    return ${bad}\n`, "t.wapy").errors;
    if (!e.length || !e[0].message.includes(good)) {
      throw new Error(`\`${bad}\` was not refused with a pointer to \`${good}\`: ${JSON.stringify(e[0])}`);
    }
  }
});

Deno.test("[§wac-wapy-words-p2vm9kx] a structural word is an ordinary name", () => {
  // `from`, `pass`, `range` and `scope` mean something only where they mean something.
  const src = [
    "@export",
    "def slice(from: i32, to: i32, pass: i32) -> i32:",
    "    range: i32 = to - from",
    "    scope: i32 = range * pass",
    "    return scope",
  ].join("\n");
  const e = wapyParse(src, "t.wapy").errors;
  if (e.length) throw new Error(`${e[0].line}:${e[0].col} ${e[0].message}`);
});

// ── §wac-wapy-nolines-4gt7wxb — brackets continue a line, nothing else does ──

Deno.test("[§wac-wapy-nolines-4gt7wxb] an open bracket continues the statement", () => {
  const src = [
    "@export",
    "def f(a: i32, b: i32) -> i32:",
    "    return (a +",
    "            b)",
  ].join("\n");
  const e = wapyParse(src, "t.wapy").errors;
  if (e.length) throw new Error(`${e[0].line}:${e[0].col} ${e[0].message}`);
});

Deno.test("[§wac-wapy-nolines-4gt7wxb] a multi-line match expression is writable", () => {
  const src = [
    "class Shape(enum):",
    "    Circle(r: f64)",
    "    Rect(w: f64, h: f64)",
    "",
    "    def area(const self) -> f64:",
    "        return match self {",
    "          case Circle(r): 3.14159 * r * r,",
    "          case Rect(w, h): w * h",
    "        }",
  ].join("\n");
  const e = wapyParse(src, "t.wapy").errors;
  if (e.length) throw new Error(`${e[0].line}:${e[0].col} ${e[0].message}`);
});

Deno.test("[§wac-wapy-nolines-4gt7wxb] a diagnostic inside a continuation names its own line", () => {
  const src = "def f() -> i32:\n    return (1 +\n            true)\n";
  const e = wapyParse(src, "t.wapy").errors;
  if (!e.length) throw new Error("`true` was accepted");
  if (e[0].line !== 3) throw new Error(`reported on line ${e[0].line}, not the line it was written on`);
});

Deno.test("[§wac-wapy-nolines-4gt7wxb] a bracket left open at the end of the file is an error", () => {
  const e = wapyParse("def f() -> i32:\n    return (1 + 2\n", "t.wapy").errors;
  if (!e.some((x) => x.message.includes("still open"))) {
    throw new Error(`no unclosed-bracket error: ${JSON.stringify(e)}`);
  }
});

// ── §wac-wapy-import-8kd3mqp — the extension travels with the path ──────────

Deno.test("[§wac-wapy-import-8kd3mqp] either surface imports either extension", () => {
  const graph = {
    "a.wapy": "@export\ndef one() -> i32:\n    return 1\n",
    "b.wac": `import { one } from "./a.wapy";\nexport i32 two() { return one() + 1; }\n`,
    "c.wapy": `from "./b.wac" import two\n@export\ndef three() -> i32:\n    return two() + 1\n`,
  };
  const r = wacCompile(new Map(Object.entries(graph)), "c.wapy");
  if (!r.ok) throw new Error(r.diagnostics.map((d) => `${d.file}:${d.line} ${d.message}`).join("\n"));
});

// ── §wac-wapy-core-5wq8jhn — `core` is unquoted on both surfaces ────────────

Deno.test("[§wac-wapy-core-5wq8jhn] `from core import Read`, and the Read is the same one", () => {
  const graph = {
    "reader.wapy": [
      "from core import Read",
      "",
      "@export",
      "def size(r: Read) -> i32:",
      "    match r:",
      "        case Data(bytes):",
      "            return bytes.len()",
      "        case End:",
      "            return 0",
      "        case Failed(why):",
      "            return -1",
      "",
    ].join("\n"),
    // The wac side declares nothing and imports the same core, so a value crossing between them
    // proves one type rather than two that happen to agree.
    "main.wac": `import { Read } from core;\nimport { size } from "./reader.wapy";\n` +
      `export i32 run() { return size(Read.Data(u8[](1, 2))); }\n`,
  };
  const r = wacCompile(new Map(Object.entries(graph)), "main.wac");
  if (!r.ok) throw new Error(r.diagnostics.map((d) => `${d.file}:${d.line} ${d.message}`).join("\n"));
});

Deno.test("[§wac-wapy-core-5wq8jhn] a bare word that is not `core` is refused", () => {
  const e = wapyParse("from cor import Read\n", "t.wapy").errors;
  if (!e.some((x) => x.message.includes("unknown module 'cor'"))) {
    throw new Error(`no unknown-module error: ${JSON.stringify(e)}`);
  }
});

// ── §wac-wapy-range-6mn4dtq — `for i in range(…)` is the counted loop ───────

Deno.test("[§wac-wapy-range-6mn4dtq] range(a, b) and range(a, b, s) are wac's counted loop", async () => {
  // The claim is "exactly", so the check is byte identity rather than agreement on a result:
  // a `range` that lost its step, or compared with `<=`, would still produce plausible answers.
  const wac = [
    "export i32 sum(i32 a, i32 b) {",
    "  i32 t = 0;",
    "  for (i32 i = a; i < b; i++) { t += i; }",
    "  return t;",
    "}",
    "export i32 stepped(i32 a, i32 b, i32 s) {",
    "  i32 t = 0;",
    "  for (i32 i = a; i < b; i += s) { t += i; }",
    "  return t;",
    "}",
  ].join("\n");
  const wapySrc = [
    "@export",
    "def sum(a: i32, b: i32) -> i32:",
    "    t: i32 = 0",
    "    for i in range(a, b):",
    "        t += i",
    "    return t",
    "",
    "@export",
    "def stepped(a: i32, b: i32, s: i32) -> i32:",
    "    t: i32 = 0",
    "    for i in range(a, b, s):",
    "        t += i",
    "    return t",
    "",
  ].join("\n");

  const a = wacCompile(new Map([["r.wac", wac]]), "r.wac");
  const b = wacCompile(new Map([["r.wapy", wapySrc]]), "r.wapy");
  if (!a.ok) throw new Error(a.diagnostics[0].message);
  if (!b.ok) throw new Error(`as wapy: ${b.diagnostics[0].line} ${b.diagnostics[0].message}`);
  const x = a.compiled.wasm, y = b.compiled.wasm;
  if (x.length !== y.length) throw new Error(`${x.length} bytes from wac, ${y.length} from wapy`);
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) throw new Error(`byte ${i} differs: ${x[i]} vs ${y[i]}`);
  }

  // And it runs, so the loop bounds are the ones claimed: 2+3+4 = 9, and 2+4 = 6 stepping by two.
  const inst = await wacInstance(b.compiled);
  if (inst.call("sum", [2, 5]) !== 9) throw new Error(`sum(2,5) = ${inst.call("sum", [2, 5])}`);
  if (inst.call("stepped", [2, 5, 2]) !== 6) throw new Error(`stepped(2,5,2) = ${inst.call("stepped", [2, 5, 2])}`);
});

Deno.test("[§wac-wapy-h3nq7fv] the same program in either surface emits identical wasm", () => {
  // The strongest form of "same language": not merely the same tree, the same bytes. Anything
  // the surface could smuggle through — a different declaration order, an operator recorded by
  // its spelling, a `for` that lost its step — would show up here as a diff.
  const wac = [
    "export struct Histogram {",
    "  i32[] bins;",
    "  Histogram of(i32 n) { return Histogram(i32[n]()); }",
    "  void add(this, i32 v) {",
    "    i32 i = v < 0 ? 0 : v;",
    "    this.bins[i % this.bins.len()]++;",
    "  }",
    "  i32 peak(const this) {",
    "    i32 best = 0;",
    "    for (i32 i = 0; i < this.bins.len(); i++) {",
    "      if (this.bins[i] > best) { best = this.bins[i]; }",
    "    }",
    "    return best;",
    "  }",
    "}",
  ].join("\n");

  const a = wacCompile(new Map([["h.wac", wac]]), "h.wac");
  const b = wacCompile(new Map([["h.wapy", wapy(wac)]]), "h.wapy");
  if (!a.ok) throw new Error(a.diagnostics[0].message);
  if (!b.ok) throw new Error(`as wapy: ${b.diagnostics[0].file}:${b.diagnostics[0].line} ${b.diagnostics[0].message}`);

  const x = a.compiled.wasm, y = b.compiled.wasm;
  if (x.length !== y.length) throw new Error(`${x.length} bytes from wac, ${y.length} from wapy`);
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) throw new Error(`byte ${i} differs: ${x[i]} vs ${y[i]}`);
  }
});

// ── §wac-wapy-matchexpr-3jx8rvc — the expression form keeps its braces ──────

Deno.test("[§wac-wapy-matchexpr-3jx8rvc] a match expression drops the parentheses, keeps the braces", () => {
  const out = wapy("enum E { A, B }\ni32 f(E e) { return match (e) { case A: 1, case B: 2 }; }");
  if (!out.includes("match e {")) throw new Error(out);
});

// ── §wac-wapy-roundtrip-5vd2qnw — asserted in full by wapyRoundTrip.test.ts ─
//
// That file converts `spec/tour.wac` and all 155 wac-mono sources and compares syntax trees.
// This one only pins the property statement itself, so the tag resolves to something.

Deno.test("[§wac-wapy-roundtrip-5vd2qnw] the printer's canonicalisations are invisible to the parser", () => {
  // Redundant parentheses dropped, a counted `for` rewritten — neither changes the tree.
  const src = "i32 f(i32 n) { i32 t = 0; for (i32 i = 0; i < n; i++) { t += ((i) * (2)); } return t; }";
  const before = strip(wacParse(wacLex(src).tokens, "t.wac").program);
  const after = strip(wapyParse(wapy(src), "t.wapy").program);
  const a = JSON.stringify(before), b = JSON.stringify(after);
  if (a !== b) throw new Error(`${a}\n${b}`);
});

function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (k === "line" || k === "col" || k === "span") continue;
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = strip(val);
    }
    return out;
  }
  return v;
}
