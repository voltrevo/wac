// Tests for wacCompile — the full wac pipeline (lex → parse → resolve → typecheck → emit).
// Each test compiles a wac source and verifies the output or error structure.

import { wacCompile, typeStr } from "./wacCompile.ts";
import type { WacType } from "./wacParse.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function compile(src: string) {
  return wacCompile(new Map([["main.wac", src]]), "main.wac");
}

async function inst(src: string): Promise<Record<string, (...a: unknown[]) => unknown>> {
  const r = compile(src);
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics.map(e => e.message).join("; ")}`);
  const { instance } = await WebAssembly.instantiate(r.compiled.wasm as BufferSource, {});
  return instance.exports as Record<string, (...a: unknown[]) => unknown>;
}

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`${msg}: got ${a}, expected ${b}`);
}

// ── Success path ──────────────────────────────────────────────────────────────

Deno.test("wacCompile: simple arithmetic function", async () => {
  const e = await inst(`export i32 mul(i32 a, i32 b) { return a * b; }`);
  eq(e.mul(7, 6), 42, "7*6=42");
  eq(e.mul(0, 99), 0, "0*99=0");
  eq(e.mul(-3, 4), -12, "-3*4=-12");
});

Deno.test("wacCompile: struct and method", async () => {
  const e = await inst(`
    struct Point { i32 x; i32 y; }
    export Point mkPoint(i32 x, i32 y) { return Point { x: x, y: y }; }
    export i32 sumXY(Point p) { return p.x + p.y; }
  `);
  const p = e.mkPoint(10, 20);
  eq(e.sumXY(p), 30, "sumXY(10,20)=30");
  eq(e.sumXY(e.mkPoint(-5, 5)), 0, "sumXY(-5,5)=0");
});

Deno.test("wacCompile: result has ok=true and non-empty bytes", () => {
  const r = compile(`export i32 id(i32 x) { return x; }`);
  if (!r.ok) throw new Error("expected ok");
  if (!(r.compiled.wasm instanceof Uint8Array)) throw new Error("bytes not Uint8Array");
  if (r.compiled.wasm[0] !== 0x00) throw new Error("invalid wasm magic");
  if (r.compiled.wasm[1] !== 0x61) throw new Error("invalid wasm magic");
});

// ── Multi-file compilation ────────────────────────────────────────────────────

Deno.test("wacCompile: multi-file import chain", async () => {
  const files = new Map([
    ["math.wac", `export i32 double(i32 x) { return x * 2; }`],
    ["main.wac", `
      import { double } from "./math.wac";
      export i32 quadruple(i32 x) { return double(double(x)); }
    `],
  ]);
  const r = wacCompile(files, "main.wac");
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics.map(e => e.message).join("; ")}`);
  const { instance } = await WebAssembly.instantiate(r.compiled.wasm as BufferSource, {});
  const e = instance.exports as Record<string, (...a: unknown[]) => unknown>;
  eq(e.quadruple(3), 12, "quadruple(3)=12");
  eq(e.quadruple(7), 28, "quadruple(7)=28");
});

// ── Lex/parse errors ──────────────────────────────────────────────────────────

Deno.test("wacCompile: lex error — unexpected character", () => {
  // '#' is an unexpected character that the lexer rejects
  const r = compile(`export i32 f() { return #bad; }`);
  if (r.ok) throw new Error("expected failure");
  if (r.diagnostics.length === 0) throw new Error("expected errors");
  if (r.diagnostics[0].phase !== "lex") throw new Error("expected lex error, got: " + r.diagnostics[0].phase);
  if (!r.diagnostics[0].message.includes("#")) throw new Error("expected '#' in message");
});

Deno.test("wacCompile: parse error — missing return expression", () => {
  // 'return;' in a non-void function is caught by type checker
  const r = compile(`export i32 bad() { return; }`);
  if (r.ok) throw new Error("expected failure");
  if (r.diagnostics[0].phase !== "typecheck") throw new Error("expected typecheck error");
  if (!r.diagnostics[0].message.includes("return")) throw new Error("expected return error");
});

Deno.test("wacCompile: parse error — unclosed brace", () => {
  const r = compile(`export i32 f(i32 x) { return x;`);
  if (r.ok) throw new Error("expected failure");
  const phases = r.diagnostics.map(e => e.phase);
  if (!phases.includes("parse")) throw new Error("expected parse error, got: " + JSON.stringify(phases));
});

// ── Resolve errors ────────────────────────────────────────────────────────────

Deno.test("wacCompile: resolve error — missing import", () => {
  const files = new Map([
    ["main.wac", `import { missing } from "./lib.wac"; export i32 f() { return missing(); }`],
  ]);
  const r = wacCompile(files, "main.wac");
  if (r.ok) throw new Error("expected failure");
  // Files map doesn't include lib.wac, so resolution fails
  const phases = r.diagnostics.map(e => e.phase);
  if (!phases.includes("resolve")) throw new Error("expected resolve error");
});

Deno.test("wacCompile: typecheck error — undefined function call", () => {
  const r = compile(`export i32 f() { return noSuchFn(); }`);
  if (r.ok) throw new Error("expected failure");
  // Undefined calls are caught at typecheck phase
  const phases = r.diagnostics.map(e => e.phase);
  if (!phases.includes("typecheck") && !phases.includes("resolve")) {
    throw new Error("expected resolve or typecheck error, got: " + JSON.stringify(phases));
  }
});

// ── Type check errors ─────────────────────────────────────────────────────────

Deno.test("wacCompile: typecheck error — wrong return type", () => {
  const r = compile(`export i32 bad() { return "hello"; }`);
  if (r.ok) throw new Error("expected failure");
  if (r.diagnostics[0].phase !== "typecheck") throw new Error("expected typecheck, got " + r.diagnostics[0].phase);
  if (!r.diagnostics[0].message.includes("return:")) throw new Error("expected return type error, got: " + r.diagnostics[0].message);
});

Deno.test("wacCompile: typecheck error — argument count mismatch", () => {
  const r = compile(`i32 add(i32 a, i32 b) { return a + b; } export i32 f() { return add(1); }`);
  if (r.ok) throw new Error("expected failure");
  if (r.diagnostics[0].phase !== "typecheck") throw new Error("expected typecheck");
});

Deno.test("wacCompile: typecheck error — wrong operator types", () => {
  const r = compile(`
    struct S { i32 v; }
    export S bad(S a, S b) { return a + b; }
  `);
  if (r.ok) throw new Error("expected failure");
  if (r.diagnostics[0].phase !== "typecheck") throw new Error("expected typecheck");
});

// ── Error structure ───────────────────────────────────────────────────────────

Deno.test("wacCompile: error has file, line, col, phase fields", () => {
  const r = compile(`export i32 bad() { return "oops"; }`);
  if (r.ok) throw new Error("expected failure");
  const err = r.diagnostics[0];
  if (typeof err.file !== "string") throw new Error("file missing");
  if (typeof err.line !== "number") throw new Error("line missing");
  if (typeof err.col !== "number") throw new Error("col missing");
  if (!["lex","parse","resolve","typecheck"].includes(err.phase)) throw new Error("phase invalid: " + err.phase);
  if (typeof err.message !== "string") throw new Error("message missing");
});

Deno.test("wacCompile: error line/col point to the problem location", () => {
  const src = [
    `i32 id(i32 x) { return x; }`,
    `export i32 bad() { return "wrong"; }`,
  ].join("\n");
  const r = compile(src);
  if (r.ok) throw new Error("expected failure");
  const err = r.diagnostics[0];
  if (err.line !== 2) throw new Error(`expected line 2, got ${err.line}`);
  if (err.phase !== "typecheck") throw new Error("expected typecheck");
});

// ── Multiple errors ───────────────────────────────────────────────────────────

Deno.test("wacCompile: multiple type errors reported together", () => {
  // Two separate functions with type errors — both should appear
  const r = compile(`
    export i32 f1() { return "bad1"; }
    export i32 f2() { return "bad2"; }
  `);
  if (r.ok) throw new Error("expected failure");
  if (r.diagnostics.length < 2) throw new Error(`expected ≥2 errors, got ${r.diagnostics.length}`);
  if (!r.diagnostics.every(e => e.phase === "typecheck")) throw new Error("all should be typecheck");
});

// ── WacCompiled exports metadata ──────────────────────────────────────────────

Deno.test("wacCompile: exports metadata — names, params, ret types", () => {
  const r = compile(`
    export i32 add(i32 a, i32 b) { return a + b; }
    export f64 scale(f64 x, i32 n) { return x * n as f64; }
    i32 internal(i32 x) { return x; }
  `);
  if (!r.ok) throw new Error("compile failed");
  const exps = r.compiled.exports;
  // Only exported functions appear
  if (exps.length !== 2) throw new Error(`expected 2 exports, got ${exps.length}`);
  const add = exps.find(e => e.name === "add")!;
  if (!add) throw new Error("add not in exports");
  if (add.params.length !== 2) throw new Error("add params count");
  if (add.params[0].name !== "a" || add.params[0].type !== "i32") throw new Error("add param a");
  if (add.params[1].name !== "b" || add.params[1].type !== "i32") throw new Error("add param b");
  if (add.ret !== "i32") throw new Error("add ret");
  const scale = exps.find(e => e.name === "scale")!;
  if (scale.params[0].type !== "f64") throw new Error("scale param x type");
  if (scale.ret !== "f64") throw new Error("scale ret");
});

Deno.test("wacCompile: exports metadata — void return", () => {
  const r = compile(`export void noop() {}`);
  if (!r.ok) throw new Error("compile failed");
  const e = r.compiled.exports[0];
  if (e.ret !== "void") throw new Error(`expected ret void, got ${e.ret}`);
  if (e.params.length !== 0) throw new Error("expected no params");
});

// ── typeStr utility ───────────────────────────────────────────────────────────

Deno.test("wacCompile: typeStr — primitive types", () => {
  const p = (name: string): WacType => ({ kind: "prim", name, line: 0, col: 0 });
  if (typeStr(p("i32"))   !== "i32")   throw new Error("i32");
  if (typeStr(p("i64"))   !== "i64")   throw new Error("i64");
  if (typeStr(p("f32"))   !== "f32")   throw new Error("f32");
  if (typeStr(p("f64"))   !== "f64")   throw new Error("f64");
  if (typeStr(p("bool"))  !== "bool")  throw new Error("bool");
  if (typeStr(p("void"))  !== "void")  throw new Error("void");
  if (typeStr(p("string")) !== "string") throw new Error("string");
});

Deno.test("wacCompile: typeStr — composite types", () => {
  const p0 = (name: string): WacType => ({ kind: "prim", name, line: 0, col: 0 });
  const arr = (elem: WacType): WacType => ({ kind: "array", elem, line: 0, col: 0 });
  const nul = (inner: WacType): WacType => ({ kind: "nullable", inner, line: 0, col: 0 });
  const str = (name: string): WacType => ({ kind: "struct", name, line: 0, col: 0 });
  const fn  = (params: WacType[], ret: WacType): WacType => ({ kind: "funcref", params, ret, line: 0, col: 0 });

  if (typeStr(arr(p0("i32")))        !== "i32[]")     throw new Error("i32[]");
  if (typeStr(arr(arr(p0("f64"))))   !== "f64[][]")   throw new Error("f64[][]");
  if (typeStr(nul(p0("i32")))        !== "i32?")      throw new Error("i32?");
  if (typeStr(nul(arr(p0("i32"))))   !== "i32[]?")    throw new Error("i32[]?");
  if (typeStr(str("Point"))          !== "Point")     throw new Error("Point");
  if (typeStr(fn([], p0("void")))    !== "fn[void()]")         throw new Error("fn[void()]");
  if (typeStr(fn([p0("i32"),p0("i32")], p0("i32"))) !== "fn[i32(i32, i32)]") throw new Error("fn[i32(i32,i32)]");
});

// ── Branch coverage instrumentation ───────────────────────────────────────────
//
// `{ coverage: true }` adds a counter per branch point and exports __cov_init /
// __cov_len / __cov_get to drive them. The counter array is a WasmGC i32 array in
// a mutable global, which starts null — so __cov_init must run before any
// instrumented code, and a missing init traps rather than silently miscounting.

type CovModule = {
  ex: Record<string, (...a: unknown[]) => unknown>;
  points: { index: number; kind: string; line: number; col: number; file: string }[];
  counts: () => number[];
};

async function instCov(src: string, files?: Map<string, string>): Promise<CovModule> {
  const r = wacCompile(files ?? new Map([["main.wac", src]]), "main.wac", { coverage: true });
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics.map(e => e.message).join("; ")}`);
  const { instance } = await WebAssembly.instantiate(r.compiled.wasm as BufferSource, {});
  const ex = instance.exports as Record<string, (...a: unknown[]) => unknown>;
  ex.__cov_init();
  const len = ex.__cov_len() as number;
  return {
    ex,
    points: r.compiled.coverage!,
    counts: () => Array.from({ length: len }, (_, i) => ex.__cov_get(i) as number),
  };
}

Deno.test("wacCompile: coverage is off by default and changes nothing", () => {
  const src = `export i32 f(i32 n) { if (n > 0) { return 1; } return 0; }`;
  const plain = compile(src);
  const explicitOff = wacCompile(new Map([["main.wac", src]]), "main.wac", { coverage: false });
  if (!plain.ok || !explicitOff.ok) throw new Error("compile failed");
  if (plain.compiled.coverage !== undefined) throw new Error("expected no coverage table");
  // Byte-for-byte identical: instrumentation must not leak into normal builds.
  if (plain.compiled.wasm.length !== explicitOff.compiled.wasm.length) {
    throw new Error("uninstrumented builds differ in length");
  }
  for (let i = 0; i < plain.compiled.wasm.length; i++) {
    if (plain.compiled.wasm[i] !== explicitOff.compiled.wasm[i]) {
      throw new Error(`uninstrumented builds differ at byte ${i}`);
    }
  }
});

Deno.test("wacCompile: coverage counts branch arms, loops and function entries", async () => {
  const m = await instCov(`
    export i32 classify(i32 n) {
      if (n < 0) {
        return 0;
      } else {
        i32 total = 0;
        for (i32 i = 0; i < n; i++) {
          total += i;
        }
        return total;
      }
    }
    export i32 never(i32 n) { return n; }
  `);

  const kinds = m.points.map(p => p.kind);
  for (const want of ["entry", "then", "else", "loop"]) {
    if (!kinds.includes(want)) throw new Error(`no '${want}' point; got ${kinds.join(",")}`);
  }

  eq(m.counts().every(c => c === 0), true, "counters start at zero");

  eq(m.ex.classify(4), 6, "classify(4) = 0+1+2+3");
  const after = m.counts();
  const at = (kind: string) => after[m.points.findIndex(p => p.kind === kind)];
  eq(at("entry"), 1, "one entry");
  eq(at("else"), 1, "else arm taken");
  eq(at("then"), 0, "then arm not taken");
  eq(at("loop"), 4, "loop body ran four times");

  // The second function was never called, which is the whole point: an entry
  // counter still at zero names dead code.
  const neverIdx = m.points.map((p, i) => ({ p, i }))
    .filter(x => x.p.kind === "entry").map(x => x.i)[1];
  eq(after[neverIdx], 0, "uncalled function's entry stays zero");

  eq(m.ex.classify(-5), 0, "classify(-5)");
  eq(m.counts()[m.points.findIndex(p => p.kind === "then")], 1, "then arm now taken");
});

Deno.test("wacCompile: coverage instruments short-circuit operands and ternary arms", async () => {
  const m = await instCov(`
    export i32 pick(i32 a, i32 b) {
      bool both = a > 0 && b > 0;
      bool either = a > 0 || b > 0;
      i32 r = both ? 1 : 0;
      if (either) { r += 10; }
      return r;
    }
  `);
  const kinds = m.points.map(p => p.kind);
  for (const want of ["and-rhs", "or-rhs", "ternary-then", "ternary-else"]) {
    if (!kinds.includes(want)) throw new Error(`no '${want}' point; got ${kinds.join(",")}`);
  }
  const at = (kind: string) => m.counts()[m.points.findIndex(p => p.kind === kind)];

  // a > 0 is false, so && short-circuits and its rhs never runs; || does evaluate
  // its rhs because the left was false.
  eq(m.ex.pick(0, 5), 10, "pick(0, 5)");
  eq(at("and-rhs"), 0, "&& right operand short-circuited");
  eq(at("or-rhs"), 1, "|| right operand evaluated");
  eq(at("ternary-else"), 1, "ternary else arm");
  eq(at("ternary-then"), 0, "ternary then arm not taken");

  // Now the mirror image: && evaluates its rhs, || short-circuits.
  eq(m.ex.pick(1, 5), 11, "pick(1, 5)");
  eq(at("and-rhs"), 1, "&& right operand now evaluated");
  eq(at("or-rhs"), 1, "|| right operand still short-circuited");
  eq(at("ternary-then"), 1, "ternary then arm now taken");
});

Deno.test("wacCompile: coverage instruments switch cases including default", async () => {
  const m = await instCov(`
    export i32 name(i32 n) {
      switch (n) {
        case 1: return 10;
        case 2: return 20;
        default: return 99;
      }
    }
  `);
  const caseIdx = m.points.map((p, i) => ({ p, i })).filter(x => x.p.kind === "case").map(x => x.i);
  eq(caseIdx.length, 3, "three case points (two cases plus default)");

  eq(m.ex.name(2), 20, "name(2)");
  const after = m.counts();
  eq(after[caseIdx[0]], 0, "case 1 not taken");
  eq(after[caseIdx[1]], 1, "case 2 taken");
  eq(after[caseIdx[2]], 0, "default not taken");

  eq(m.ex.name(7), 99, "name(7)");
  eq(m.counts()[caseIdx[2]], 1, "default now taken");
});

Deno.test("wacCompile: __cov_init resets counters and is required before use", async () => {
  const m = await instCov(`export i32 f(i32 n) { if (n > 0) { return 1; } return 0; }`);
  m.ex.f(1);
  if (m.counts().every(c => c === 0)) throw new Error("expected nonzero counts");
  m.ex.__cov_init();
  eq(m.counts().every(c => c === 0), true, "re-init clears counters");

  // Without __cov_init the global is null, so the first increment traps rather
  // than counting into nothing.
  const r = wacCompile(
    new Map([["main.wac", `export i32 f(i32 n) { if (n > 0) { return 1; } return 0; }`]]),
    "main.wac", { coverage: true });
  if (!r.ok) throw new Error("compile failed");
  const { instance } = await WebAssembly.instantiate(r.compiled.wasm as BufferSource, {});
  const raw = instance.exports as Record<string, (...a: unknown[]) => unknown>;
  let threw = false;
  try { raw.f(1); } catch { threw = true; }
  eq(threw, true, "calling instrumented code before __cov_init traps");
});

Deno.test("wacCompile: coverage points carry the declaring file across imports", async () => {
  const files = new Map([
    ["main.wac", `import { helper } from "./lib.wac";\nexport i32 f(i32 n) { return helper(n); }`],
    ["lib.wac", `export i32 helper(i32 n) { if (n > 0) { return 1; } return 0; }`],
  ]);
  const m = await instCov("", files);
  const filesSeen = new Set(m.points.map(p => p.file));
  if (!filesSeen.has("main.wac") || !filesSeen.has("lib.wac")) {
    throw new Error(`expected points from both files, got ${[...filesSeen].join(",")}`);
  }
  eq(m.ex.f(5), 1, "f(5) via imported helper");
  const libThen = m.points.findIndex(p => p.file === "lib.wac" && p.kind === "then");
  eq(m.counts()[libThen], 1, "the imported file's branch was counted");
});
