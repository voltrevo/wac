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

Deno.test("wacCompile: coverage instruments match arms, including else", async () => {
  // `switch` cases were instrumented and `match` arms were not, so a match reported as
  // fully covered no matter how many arms never ran — the statement contributed only its
  // function's `entry` point. Silent under-reporting in the one tool whose job is to say
  // what has not been exercised.
  const m = await instCov(`
    enum E { A(i32 v), B, C }
    export i32 pick(E e) {
      match (e) {
        case A(v): return v;
        case B:    return 2;
        else:      return 3;
      }
    }
    export E mkA(i32 v) { return E.A(v); }
    export E mkB()      { return E.B; }
    export E mkC()      { return E.C; }
  `);

  const arms = m.points.filter(p => p.kind === "case");
  if (arms.length !== 3) {
    throw new Error(`expected 3 arm points (two cases and the else), got ${arms.length}: ${
      m.points.map(p => p.kind).join(", ")}`);
  }

  // Only the A arm runs, so exactly one arm counter moves.
  m.ex.pick(m.ex.mkA(7));
  const afterA = arms.map(p => m.counts()[p.index]);
  if (afterA[0] !== 1 || afterA[1] !== 0 || afterA[2] !== 0) {
    throw new Error(`expected only the first arm to be counted, got ${afterA.join(", ")}`);
  }

  // Then B, then C — which reaches the else arm, since C has no case of its own.
  m.ex.pick(m.ex.mkB());
  m.ex.pick(m.ex.mkC());
  const afterAll = arms.map(p => m.counts()[p.index]);
  if (afterAll.some(c => c !== 1)) {
    throw new Error(`expected every arm counted once, got ${afterAll.join(", ")}`);
  }
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

// ── Bulk array/string marshalling ─────────────────────────────────────────────
//
// Arrays and strings cross the boundary through a linear-memory staging buffer:
// one TypedArray.set in, one wasm-internal loop into the GC array, and the reverse
// coming out. Previously this was one exported call per element, which dominated
// any real work.
//
// The buffer starts at zero pages and grows on demand, so the cases worth pinning
// are the ones around growth: empty input, exact page multiples, and sizes either
// side of a page boundary. Growing detaches the old ArrayBuffer, so a stale view
// is the failure mode to watch for.

/** Compile with bindgen and import the generated module. */
async function bindgenModule(src: string): Promise<Record<string, unknown>> {
  const { wacBindgen } = await import("./wacBindgen.ts");
  const r = compile(src);
  if (!r.ok) throw new Error(`compile failed: ${r.diagnostics.map(e => e.message).join("; ")}`);
  const ts = wacBindgen(r.compiled);
  const dir = await Deno.makeTempDir();
  const path = `${dir}/gen.ts`;
  await Deno.writeTextFile(path, ts);
  const mod = await import(`file://${path}`);
  await Deno.remove(dir, { recursive: true });
  return mod;
}

Deno.test("[§wac-bind-bulk-70zh5tg] wacBindgen: byte arrays round trip across page boundaries", async () => {
  const mod = await bindgenModule(`export u8[] echo(u8[] d) { return d; }`);
  const echo = mod.echo as (d: Uint8Array) => Uint8Array;

  // 65536 is one wasm page. These straddle zero, one and two pages, which is
  // where the grow logic and any stale view would show up.
  for (const n of [0, 1, 2, 255, 65535, 65536, 65537, 131072, 200000]) {
    const input = new Uint8Array(n);
    for (let i = 0; i < n; i++) input[i] = (i * 31 + 7) & 0xFF;
    const out = echo(input);
    if (out.length !== n) throw new Error(`n=${n}: got ${out.length} bytes`);
    for (let i = 0; i < n; i++) {
      if (out[i] !== input[i]) throw new Error(`n=${n}: byte ${i} differs`);
    }
  }
});

Deno.test("wacBindgen: 0xFF survives the round trip unsigned", async () => {
  // u8 reads zero-extend, and the staging buffer is a Uint8Array on the JS side,
  // so a sign-extension mistake anywhere would show up as 255 becoming -1.
  const mod = await bindgenModule(`export u8[] echo(u8[] d) { return d; }`);
  const echo = mod.echo as (d: Uint8Array) => Uint8Array;
  const out = echo(new Uint8Array([0, 1, 127, 128, 254, 255]));
  eq(Array.from(out).join(","), "0,1,127,128,254,255", "high bytes unchanged");
});

Deno.test("wacBindgen: several arrays in one call do not clobber each other", async () => {
  // They share one staging buffer, so this only works because from_mem copies into
  // a GC array before the next argument is written.
  const mod = await bindgenModule(`
    export i32 sums(u8[] a, u8[] b) {
      i32 total = 0;
      for (i32 i = 0; i < a.len(); i++) { total += a[i]; }
      for (i32 i = 0; i < b.len(); i++) { total -= b[i]; }
      return total;
    }
  `);
  const sums = mod.sums as (a: Uint8Array, b: Uint8Array) => number;
  const a = new Uint8Array(1000).fill(5);
  const b = new Uint8Array(1000).fill(2);
  eq(sums(a, b), 3000, "5*1000 - 2*1000");
  // Different lengths, so a stale length would show up too.
  eq(sums(new Uint8Array(10).fill(1), new Uint8Array(5).fill(1)), 5, "uneven lengths");
});

Deno.test("wacBindgen: wider element types round trip", async () => {
  const mod = await bindgenModule(`
    export i32[] echo32(i32[] d) { return d; }
    export f64[] echoF64(f64[] d) { return d; }
  `);
  const echo32 = mod.echo32 as (d: Int32Array) => Int32Array;
  const echoF64 = mod.echoF64 as (d: Float64Array) => Float64Array;

  // Element widths of 4 and 8 mean the index has to be scaled; an unscaled
  // address would alias elements onto each other.
  const ints = Int32Array.from([0, 1, -1, 2147483647, -2147483648, 123456789]);
  const gotInts = echo32(ints);
  eq(Array.from(gotInts).join(","), Array.from(ints).join(","), "i32[] round trip");

  const floats = Float64Array.from([0, -0, 1.5, -1.5, Math.PI, 1e300, 5e-324]);
  const gotFloats = echoF64(floats);
  for (let i = 0; i < floats.length; i++) {
    if (!Object.is(gotFloats[i], floats[i])) {
      throw new Error(`f64 element ${i}: got ${gotFloats[i]}, want ${floats[i]}`);
    }
  }
  // 4096 elements is 32 KiB of f64, enough to need a grow.
  const big = Float64Array.from({ length: 4096 }, (_, i) => i * 1.5);
  const gotBig = echoF64(big);
  if (gotBig.length !== big.length || gotBig[4095] !== big[4095]) {
    throw new Error("large f64[] round trip failed");
  }
});

Deno.test("wacBindgen: strings round trip, including multi-byte and long", async () => {
  const mod = await bindgenModule(`export string echo(string s) { return s; }`);
  const echo = mod.echo as (s: string) => string;
  for (const s of ["", "a", "hello world", "héllo → 😀", "x".repeat(100000)]) {
    const out = echo(s);
    if (out !== s) throw new Error(`string round trip failed for length ${s.length}`);
  }
});

Deno.test("wacBindgen: a returned array is a copy, not a live view", async () => {
  // The staging buffer is reused, so a returned view would be silently
  // overwritten by the next call.
  const mod = await bindgenModule(`export u8[] echo(u8[] d) { return d; }`);
  const echo = mod.echo as (d: Uint8Array) => Uint8Array;
  const first = echo(new Uint8Array([1, 2, 3]));
  echo(new Uint8Array([9, 9, 9, 9, 9, 9]));
  eq(Array.from(first).join(","), "1,2,3", "the earlier result is unaffected");
});

Deno.test("a heap type index past 63 is written as a signed LEB", async () => {
  // `ref.cast` takes a *heap type*, which is a signed LEB (s33), where `struct.new` and `struct.get`
  // take an unsigned type index. Two sites wrote the cast's immediate with `uleb`: identical output
  // for every index below 64, and at exactly 64 the single byte 0x40, which a decoder reading s33
  // sees as -64. Nothing smaller than a sixty-odd-type module could show it, and then every module
  // with an enum at the boundary was rejected outright — the enum's `__bind_e_*` getter contains the
  // cast. Issue 0062, and it cost a shell package all 539 of its differential tests in one
  // afternoon. Measured: 62 filler structs was fine, 63 was not.
  const filler = Array.from({ length: 70 }, (_, i) => `export struct F${i} { i32 a${i}; }`).join("\n");
  const withEnum = await inst(`${filler}

export enum E { Some(i32? v), None }

export i32 viaMatch(i32 x) {
  E e = E.Some(x);
  return match (e) { case Some(v): v!, case None: 0 };
}
`);
  eq(withEnum.viaMatch(7), 7, "an enum payload read back through a two-byte type index");

  // The second site: `x!` on a nullable primitive is also a `ref.cast`, of the box struct.
  const unboxing = await inst(`${filler}

export i32 unbox(i32 x) {
  i32? maybe = x;
  return maybe!;
}
`);
  eq(unboxing.unbox(9), 9, "unboxing a nullable primitive in a module of the same size");
});
