// Tests for wacCompile — the full wac pipeline (lex → parse → resolve → typecheck → emit).
// Each test compiles a wac source and verifies the output or error structure.

import { wacCompile } from "./wacCompile.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function compile(src: string) {
  return wacCompile(new Map([["main.wac", src]]), "main.wac");
}

async function inst(src: string): Promise<Record<string, (...a: unknown[]) => unknown>> {
  const r = compile(src);
  if (!r.ok) throw new Error(`compile failed: ${r.errors.map(e => e.message).join("; ")}`);
  const { instance } = await WebAssembly.instantiate(r.bytes, {});
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
  if (!(r.bytes instanceof Uint8Array)) throw new Error("bytes not Uint8Array");
  if (r.bytes[0] !== 0x00) throw new Error("invalid wasm magic");
  if (r.bytes[1] !== 0x61) throw new Error("invalid wasm magic");
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
  if (!r.ok) throw new Error(`compile failed: ${r.errors.map(e => e.message).join("; ")}`);
  const { instance } = await WebAssembly.instantiate(r.bytes, {});
  const e = instance.exports as Record<string, (...a: unknown[]) => unknown>;
  eq(e.quadruple(3), 12, "quadruple(3)=12");
  eq(e.quadruple(7), 28, "quadruple(7)=28");
});

// ── Lex/parse errors ──────────────────────────────────────────────────────────

Deno.test("wacCompile: lex error — unexpected character", () => {
  // '#' is an unexpected character that the lexer rejects
  const r = compile(`export i32 f() { return #bad; }`);
  if (r.ok) throw new Error("expected failure");
  if (r.errors.length === 0) throw new Error("expected errors");
  if (r.errors[0].phase !== "lex") throw new Error("expected lex error, got: " + r.errors[0].phase);
  if (!r.errors[0].message.includes("#")) throw new Error("expected '#' in message");
});

Deno.test("wacCompile: parse error — missing return expression", () => {
  // 'return;' in a non-void function is caught by type checker
  const r = compile(`export i32 bad() { return; }`);
  if (r.ok) throw new Error("expected failure");
  if (r.errors[0].phase !== "typecheck") throw new Error("expected typecheck error");
  if (!r.errors[0].message.includes("return")) throw new Error("expected return error");
});

Deno.test("wacCompile: parse error — unclosed brace", () => {
  const r = compile(`export i32 f(i32 x) { return x;`);
  if (r.ok) throw new Error("expected failure");
  const phases = r.errors.map(e => e.phase);
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
  const phases = r.errors.map(e => e.phase);
  if (!phases.includes("resolve")) throw new Error("expected resolve error");
});

Deno.test("wacCompile: typecheck error — undefined function call", () => {
  const r = compile(`export i32 f() { return noSuchFn(); }`);
  if (r.ok) throw new Error("expected failure");
  // Undefined calls are caught at typecheck phase
  const phases = r.errors.map(e => e.phase);
  if (!phases.includes("typecheck") && !phases.includes("resolve")) {
    throw new Error("expected resolve or typecheck error, got: " + JSON.stringify(phases));
  }
});

// ── Type check errors ─────────────────────────────────────────────────────────

Deno.test("wacCompile: typecheck error — wrong return type", () => {
  const r = compile(`export i32 bad() { return "hello"; }`);
  if (r.ok) throw new Error("expected failure");
  if (r.errors[0].phase !== "typecheck") throw new Error("expected typecheck, got " + r.errors[0].phase);
  if (!r.errors[0].message.includes("mismatch")) throw new Error("expected type mismatch");
});

Deno.test("wacCompile: typecheck error — argument count mismatch", () => {
  const r = compile(`i32 add(i32 a, i32 b) { return a + b; } export i32 f() { return add(1); }`);
  if (r.ok) throw new Error("expected failure");
  if (r.errors[0].phase !== "typecheck") throw new Error("expected typecheck");
});

Deno.test("wacCompile: typecheck error — wrong operator types", () => {
  const r = compile(`
    struct S { i32 v; }
    export S bad(S a, S b) { return a + b; }
  `);
  if (r.ok) throw new Error("expected failure");
  if (r.errors[0].phase !== "typecheck") throw new Error("expected typecheck");
});

// ── Error structure ───────────────────────────────────────────────────────────

Deno.test("wacCompile: error has file, line, col, phase fields", () => {
  const r = compile(`export i32 bad() { return "oops"; }`);
  if (r.ok) throw new Error("expected failure");
  const err = r.errors[0];
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
  const err = r.errors[0];
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
  if (r.errors.length < 2) throw new Error(`expected ≥2 errors, got ${r.errors.length}`);
  if (!r.errors.every(e => e.phase === "typecheck")) throw new Error("all should be typecheck");
});
