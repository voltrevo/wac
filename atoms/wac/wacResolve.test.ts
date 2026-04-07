import { wacLex } from "./wacLex.ts";
import { wacParse, type Program } from "./wacParse.ts";
import {
  wacResolve, type ResolveResult, type FuncEntry, type StructEntry,
  funcReturnType, funcParams, isMethod,
} from "./wacResolve.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseOne(src: string, path = "/main.wac"): Program {
  const { tokens } = wacLex(src);
  const { program } = wacParse(tokens, path);
  return program;
}

function makeMap(entries: [string, string][]): Map<string, Program> {
  return new Map(entries.map(([p, src]) => [p, parseOne(src, p)]));
}

function resolve(
  entry: string,
  files: [string, string][],
): ResolveResult {
  const programs = makeMap(files);
  return wacResolve(entry, programs);
}

function ok(entry: string, files: [string, string][]): ResolveResult {
  const result = resolve(entry, files);
  if (result.errors.length > 0) {
    throw new Error(`Resolve errors: ${result.errors.map(e => e.message).join("; ")}`);
  }
  return result;
}

function fail(entry: string, files: [string, string][]): string[] {
  return resolve(entry, files).errors.map(e => e.message);
}

// ── Single file — basic ───────────────────────────────────────────────────────

Deno.test("wacResolve: empty program", () => {
  const r = ok("/main.wac", [["/main.wac", ""]]);
  if (r.funcs.length !== 0) throw new Error("no funcs");
  if (r.structs.length !== 0) throw new Error("no structs");
});

Deno.test("wacResolve: single exported function", () => {
  const r = ok("/main.wac", [["/main.wac", "export i32 add(i32 a, i32 b) { return a + b; }"]]);
  if (r.funcs.length !== 1) throw new Error(`funcs ${r.funcs.length}`);
  const f = r.funcs[0];
  if (f.mangledName !== "main$add") throw new Error(`mangled ${f.mangledName}`);
  if (f.exportName !== "add") throw new Error(`export ${f.exportName}`);
  if (f.funcIndex !== 0) throw new Error("funcIndex 0");
  if (f.filePath !== "/main.wac") throw new Error("filePath");
});

Deno.test("wacResolve: non-exported function", () => {
  const r = ok("/main.wac", [["/main.wac", "i32 helper(i32 x) { return x * 2; }"]]);
  const f = r.funcs[0];
  if (f.exportName !== null) throw new Error("not exported");
  if (f.mangledName !== "main$helper") throw new Error(`mangled ${f.mangledName}`);
});

Deno.test("wacResolve: multiple functions get sequential indices", () => {
  const r = ok("/a.wac", [["/a.wac", `
    i32 foo(i32 x) { return x; }
    export i32 bar(i32 x) { return x + 1; }
    void baz() { }
  `]]);
  if (r.funcs.length !== 3) throw new Error(`funcs ${r.funcs.length}`);
  if (r.funcs[0].funcIndex !== 0) throw new Error("index 0");
  if (r.funcs[1].funcIndex !== 1) throw new Error("index 1");
  if (r.funcs[2].funcIndex !== 2) throw new Error("index 2");
  if (r.funcs[0].mangledName !== "a$foo") throw new Error(`mangled: ${r.funcs[0].mangledName}`);
  if (r.funcs[1].exportName !== "bar") throw new Error("bar exported");
  if (r.funcs[2].exportName !== null) throw new Error("baz not exported");
});

// ── Structs ───────────────────────────────────────────────────────────────────

Deno.test("wacResolve: struct declaration", () => {
  const r = ok("/main.wac", [["/main.wac", "struct Point { i32 x; i32 y; }"]]);
  if (r.structs.length !== 1) throw new Error(`structs ${r.structs.length}`);
  const s = r.structs[0];
  if (s.name !== "Point") throw new Error("name");
  if (s.typeIndex !== 0) throw new Error("typeIndex");
  if (s.filePath !== "/main.wac") throw new Error("filePath");
  if (s.methods.size !== 0) throw new Error("no methods");
});

Deno.test("wacResolve: struct with methods", () => {
  const r = ok("/main.wac", [["/main.wac", `
    struct Counter {
      i32 count;
      void inc(this) { this.count += 1; }
      i32 getCount(const this) { return this.count; }
      Counter create(i32 n) { return Counter(n); }
    }
  `]]);
  if (r.structs.length !== 1) throw new Error("1 struct");
  const s = r.structs[0];
  if (s.methods.size !== 3) throw new Error(`methods ${s.methods.size}`);
  if (!s.methods.has("inc")) throw new Error("inc");
  if (!s.methods.has("getCount")) throw new Error("getCount");
  if (!s.methods.has("create")) throw new Error("create");
  // Methods get function indices
  const inc = s.methods.get("inc")!;
  if (inc.mangledName !== "Counter$inc") throw new Error(`mangled: ${inc.mangledName}`);
  if (inc.exportName !== null) throw new Error("methods not exported");
  if (!isMethod(inc)) throw new Error("isMethod");
  // Methods have sequential function indices
  const indices = Array.from(s.methods.values()).map(m => m.funcIndex).sort((a, b) => a - b);
  if (indices.length !== 3) throw new Error("3 indices");
  // Check contiguous starting at 0 (no top-level funcs)
  if (indices[0] !== 0 || indices[1] !== 1 || indices[2] !== 2) throw new Error(`indices: ${indices}`);
});

Deno.test("wacResolve: struct methods registered in funcs array", () => {
  const r = ok("/main.wac", [["/main.wac", `
    i32 topFunc() { return 0; }
    struct Foo { void bar(this) { } }
  `]]);
  if (r.funcs.length !== 2) throw new Error(`funcs ${r.funcs.length}`);
  if (r.funcs[0].origin.kind !== "func") throw new Error("first is func");
  if (r.funcs[1].origin.kind !== "method") throw new Error("second is method");
  if (r.funcs[1].mangledName !== "Foo$bar") throw new Error("mangled Foo$bar");
});

// ── File scope ────────────────────────────────────────────────────────────────

Deno.test("wacResolve: file scope contains local declarations", () => {
  const r = ok("/main.wac", [["/main.wac", `
    i32 foo() { return 1; }
    struct Bar { i32 x; }
  `]]);
  const scope = r.fileScopes.get("/main.wac")!;
  if (!scope.has("foo")) throw new Error("foo in scope");
  if (!scope.has("Bar")) throw new Error("Bar in scope");
  if (scope.get("foo")!.kind !== "func") throw new Error("foo is func");
  if (scope.get("Bar")!.kind !== "struct") throw new Error("Bar is struct");
});

// ── Imports ───────────────────────────────────────────────────────────────────

Deno.test("wacResolve: simple import", () => {
  const r = ok("/main.wac", [
    ["/main.wac", `import { add } from "./math.wac"; export i32 run() { return add(1, 2); }`],
    ["/math.wac", `export i32 add(i32 a, i32 b) { return a + b; }`],
  ]);
  // math.wac is processed first (DFS)
  const mainScope = r.fileScopes.get("/main.wac")!;
  if (!mainScope.has("add")) throw new Error("add in scope");
  if (mainScope.get("add")!.kind !== "func") throw new Error("add is func");
  // The add entry should have the correct mangled name
  const addEntry = mainScope.get("add")!.entry as FuncEntry;
  if (addEntry.mangledName !== "math$add") throw new Error(`mangled: ${addEntry.mangledName}`);
});

Deno.test("wacResolve: import with alias", () => {
  const r = ok("/main.wac", [
    ["/main.wac", `import { distance as dist } from "./geo.wac"; export f64 run() { return dist(3.0, 4.0); }`],
    ["/geo.wac", `export f64 distance(f64 x, f64 y) { return x + y; }`],
  ]);
  const mainScope = r.fileScopes.get("/main.wac")!;
  if (!mainScope.has("dist")) throw new Error("dist in scope");
  if (mainScope.has("distance")) throw new Error("distance should not be in scope (aliased)");
  const distEntry = mainScope.get("dist")!.entry as FuncEntry;
  if (distEntry.mangledName !== "geo$distance") throw new Error(`mangled: ${distEntry.mangledName}`);
});

Deno.test("wacResolve: import type (struct)", () => {
  const r = ok("/main.wac", [
    ["/main.wac", `import { Point } from "./geo.wac"; export i32 run(Point p) { return 0; }`],
    ["/geo.wac", `export struct Point { f64 x; f64 y; }`],
  ]);
  const mainScope = r.fileScopes.get("/main.wac")!;
  if (!mainScope.has("Point")) throw new Error("Point in scope");
  if (mainScope.get("Point")!.kind !== "struct") throw new Error("Point is struct");
});

Deno.test("wacResolve: functions from imports come before entry file functions", () => {
  // DFS: imported file functions get lower indices
  const r = ok("/main.wac", [
    ["/main.wac", `import { dep } from "./dep.wac"; export i32 main() { return dep(); }`],
    ["/dep.wac", `export i32 dep() { return 42; }`],
  ]);
  // dep.wac processed first → dep$dep gets index 0, main$main gets index 1
  const depEntry = r.fileScopes.get("/main.wac")!.get("dep")!.entry as FuncEntry;
  const mainEntry = r.fileScopes.get("/main.wac")!.get("main")!.entry as FuncEntry;
  if (depEntry.funcIndex !== 0) throw new Error(`dep index ${depEntry.funcIndex}`);
  if (mainEntry.funcIndex !== 1) throw new Error(`main index ${mainEntry.funcIndex}`);
});

Deno.test("wacResolve: diamond imports — file visited once", () => {
  // shared.wac imported by both left.wac and right.wac
  // shared$base should get only one function index
  const r = ok("/top.wac", [
    ["/top.wac", `
      import { left } from "./left.wac";
      import { right } from "./right.wac";
      export i32 combined() { return left() + right(); }
    `],
    ["/left.wac", `
      import { base } from "./shared.wac";
      export i32 left() { return base() + 10; }
    `],
    ["/right.wac", `
      import { base } from "./shared.wac";
      export i32 right() { return base() + 20; }
    `],
    ["/shared.wac", `export i32 base() { return 100; }`],
  ]);
  // shared$base should appear exactly once in funcs
  const baseFuncs = r.funcs.filter(f => f.mangledName === "shared$base");
  if (baseFuncs.length !== 1) throw new Error(`base appears ${baseFuncs.length} times`);
  // All 4 funcs: shared$base, left$left, right$right, top$combined
  if (r.funcs.length !== 4) throw new Error(`funcs ${r.funcs.length}`);
});

Deno.test("wacResolve: circular imports — handled without infinite loop", () => {
  // ping imports pong, pong imports ping
  const r = ok("/ping.wac", [
    ["/ping.wac", `
      import { pong } from "./pong.wac";
      export i32 ping(i32 n) { if (n == 0) { return 0; } return pong(n - 1) + 1; }
    `],
    ["/pong.wac", `
      import { ping } from "./ping.wac";
      export i32 pong(i32 n) { if (n == 0) { return 0; } return ping(n - 1) + 1; }
    `],
  ]);
  // Both functions should be registered
  if (r.funcs.length !== 2) throw new Error(`funcs ${r.funcs.length}`);
  const names = r.funcs.map(f => f.mangledName).sort();
  if (names[0] !== "ping$ping") throw new Error(`names: ${names}`);
  if (names[1] !== "pong$pong") throw new Error(`names: ${names}`);
});

Deno.test("wacResolve: multi-level imports", () => {
  const r = ok("/top.wac", [
    ["/top.wac", `import { mid } from "./mid.wac"; export i32 top() { return mid(); }`],
    ["/mid.wac", `import { base } from "./base.wac"; export i32 mid() { return base() + 1; }`],
    ["/base.wac", `export i32 base() { return 0; }`],
  ]);
  if (r.funcs.length !== 3) throw new Error(`funcs ${r.funcs.length}`);
  // DFS: base first (index 0), mid (1), top (2)
  const [b, m, t] = r.funcs;
  if (b.mangledName !== "base$base") throw new Error(`b: ${b.mangledName}`);
  if (m.mangledName !== "mid$mid") throw new Error(`m: ${m.mangledName}`);
  if (t.mangledName !== "top$top") throw new Error(`t: ${t.mangledName}`);
});

Deno.test("wacResolve: relative path with subdirectory", () => {
  const r = ok("/a/main.wac", [
    ["/a/main.wac", `import { util } from "./util.wac"; export i32 run() { return util(); }`],
    ["/a/util.wac", `export i32 util() { return 1; }`],
  ]);
  if (r.errors.length > 0) throw new Error(`errors: ${r.errors.map(e => e.message)}`);
  if (r.funcs.length !== 2) throw new Error(`funcs: ${r.funcs.length}`);
});

Deno.test("wacResolve: path with parent dir (../)", () => {
  const r = ok("/a/main.wac", [
    ["/a/main.wac", `import { util } from "../shared/util.wac"; export i32 run() { return util(); }`],
    ["/shared/util.wac", `export i32 util() { return 1; }`],
  ]);
  if (r.errors.length > 0) throw new Error(`errors: ${r.errors.map(e => e.message)}`);
  const mainScope = r.fileScopes.get("/a/main.wac")!;
  if (!mainScope.has("util")) throw new Error("util in scope");
});

// ── Helper functions ──────────────────────────────────────────────────────────

Deno.test("wacResolve: funcReturnType for function entry", () => {
  const r = ok("/main.wac", [["/main.wac", "export i64 double(i32 x) { return 0; }"]]);
  const rt = funcReturnType(r.funcs[0]);
  if (rt.kind !== "prim" || (rt as any).name !== "i64") throw new Error(`ret ${rt.kind}`);
});

Deno.test("wacResolve: funcReturnType for method entry", () => {
  const r = ok("/main.wac", [["/main.wac", `struct Foo { i32 get(const this) { return 0; } }`]]);
  const method = r.funcs[0];
  const rt = funcReturnType(method);
  if (rt.kind !== "prim") throw new Error(`ret ${rt.kind}`);
  if ((rt as any).name !== "i32") throw new Error(`ret name ${(rt as any).name}`);
});

Deno.test("wacResolve: funcParams for function entry", () => {
  const r = ok("/main.wac", [["/main.wac", "export i32 add(i32 a, i64 b) { return 0; }"]]);
  const params = funcParams(r.funcs[0]);
  if (params.length !== 2) throw new Error(`params ${params.length}`);
  if (params[0].name !== "a") throw new Error("param a");
  if (params[1].name !== "b") throw new Error("param b");
});

Deno.test("wacResolve: isMethod for func vs method", () => {
  const r = ok("/main.wac", [["/main.wac", `
    i32 plain() { return 0; }
    struct Foo { i32 method(const this) { return 0; } }
  `]]);
  if (isMethod(r.funcs[0])) throw new Error("plain is not method");
  if (!isMethod(r.funcs[1])) throw new Error("struct method is method");
});

// ── Naming collision errors ───────────────────────────────────────────────────

Deno.test("wacResolve: duplicate function names", () => {
  const errs = fail("/main.wac", [["/main.wac", `
    i32 foo() { return 1; }
    i32 foo() { return 2; }
  `]]);
  if (errs.length === 0) throw new Error("expected error");
  if (!errs[0].includes("foo")) throw new Error(`err: ${errs[0]}`);
});

Deno.test("wacResolve: duplicate struct names", () => {
  const errs = fail("/main.wac", [["/main.wac", `
    struct Point { i32 x; }
    struct Point { i32 y; }
  `]]);
  if (errs.length === 0) throw new Error("expected error");
  if (!errs[0].includes("Point")) throw new Error(`err: ${errs[0]}`);
});

Deno.test("wacResolve: function and struct same name", () => {
  const errs = fail("/main.wac", [["/main.wac", `
    struct Foo { i32 x; }
    i32 Foo() { return 1; }
  `]]);
  if (errs.length === 0) throw new Error("expected error");
});

Deno.test("wacResolve: duplicate fields in struct", () => {
  const errs = fail("/main.wac", [["/main.wac", `struct Bad { i32 x; i32 x; }`]]);
  if (errs.length === 0) throw new Error("expected error");
  if (!errs[0].includes("x")) throw new Error(`err: ${errs[0]}`);
});

Deno.test("wacResolve: duplicate methods in struct", () => {
  const errs = fail("/main.wac", [["/main.wac", `
    struct Bad {
      i32 get(const this) { return 0; }
      i32 get(const this) { return 1; }
    }
  `]]);
  if (errs.length === 0) throw new Error("expected error");
  if (!errs[0].includes("get")) throw new Error(`err: ${errs[0]}`);
});

Deno.test("wacResolve: field and method same name in struct", () => {
  const errs = fail("/main.wac", [["/main.wac", `
    struct Bad {
      i32 len;
      i32 len(const this) { return 0; }
    }
  `]]);
  if (errs.length === 0) throw new Error("expected error");
  if (!errs[0].includes("len")) throw new Error(`err: ${errs[0]}`);
});

Deno.test("wacResolve: import collides with local name", () => {
  const errs = fail("/main.wac", [
    ["/main.wac", `
      import { distance } from "./geo.wac";
      f64 distance(f64 x, f64 y) { return x - y; }
    `],
    ["/geo.wac", `export f64 distance(f64 x, f64 y) { return x + y; }`],
  ]);
  if (errs.length === 0) throw new Error("expected error");
  if (!errs[0].includes("distance")) throw new Error(`err: ${errs[0]}`);
});

Deno.test("wacResolve: two imports with same alias collide", () => {
  const errs = fail("/main.wac", [
    ["/main.wac", `
      import { foo } from "./a.wac";
      import { foo } from "./b.wac";
    `],
    ["/a.wac", `export i32 foo() { return 1; }`],
    ["/b.wac", `export i32 foo() { return 2; }`],
  ]);
  if (errs.length === 0) throw new Error("expected error");
});

Deno.test("wacResolve: rename resolves collision", () => {
  const r = ok("/main.wac", [
    ["/main.wac", `
      import { foo } from "./a.wac";
      import { foo as fooB } from "./b.wac";
      export i32 run() { return foo() + fooB(); }
    `],
    ["/a.wac", `export i32 foo() { return 1; }`],
    ["/b.wac", `export i32 foo() { return 2; }`],
  ]);
  const mainScope = r.fileScopes.get("/main.wac")!;
  if (!mainScope.has("foo")) throw new Error("foo");
  if (!mainScope.has("fooB")) throw new Error("fooB");
});

Deno.test("wacResolve: importing non-exported function is error", () => {
  const errs = fail("/main.wac", [
    ["/main.wac", `import { helper } from "./util.wac"; export i32 run() { return helper(); }`],
    ["/util.wac", `i32 helper() { return 1; }`],  // NOT exported
  ]);
  if (errs.length === 0) throw new Error("expected error for importing non-exported");
  if (!errs[0].includes("helper")) throw new Error(`err: ${errs[0]}`);
});

Deno.test("wacResolve: importing non-existent name is error", () => {
  const errs = fail("/main.wac", [
    ["/main.wac", `import { missing } from "./util.wac"; export i32 run() { return 0; }`],
    ["/util.wac", `export i32 foo() { return 1; }`],
  ]);
  if (errs.length === 0) throw new Error("expected error");
  if (!errs[0].includes("missing")) throw new Error(`err: ${errs[0]}`);
});

Deno.test("wacResolve: file not found in programs map is error", () => {
  const errs = fail("/main.wac", [
    ["/main.wac", `import { foo } from "./missing.wac"; export i32 run() { return 0; }`],
    // missing.wac not in map
  ]);
  if (errs.length === 0) throw new Error("expected error for missing file");
});

// ── Mangling rules ────────────────────────────────────────────────────────────

Deno.test("wacResolve: stem uses filename without extension", () => {
  const r = ok("/path/to/geometry.wac", [
    ["/path/to/geometry.wac", `export i32 distance() { return 0; }`],
  ]);
  if (r.funcs[0].mangledName !== "geometry$distance") throw new Error(`mangled: ${r.funcs[0].mangledName}`);
});

Deno.test("wacResolve: same name functions in different files have distinct mangled names", () => {
  const r = ok("/main.wac", [
    ["/main.wac", `
      import { compute as computeA } from "./a.wac";
      import { compute as computeB } from "./b.wac";
      export i32 test() { return computeA(5) + computeB(5); }
    `],
    ["/a.wac", `export i32 compute(i32 x) { return x + 1; }`],
    ["/b.wac", `export i32 compute(i32 x) { return x * 2; }`],
  ]);
  const aEntry = r.fileScopes.get("/main.wac")!.get("computeA")!.entry as FuncEntry;
  const bEntry = r.fileScopes.get("/main.wac")!.get("computeB")!.entry as FuncEntry;
  if (aEntry.mangledName !== "a$compute") throw new Error(`a: ${aEntry.mangledName}`);
  if (bEntry.mangledName !== "b$compute") throw new Error(`b: ${bEntry.mangledName}`);
  if ((aEntry.mangledName as string) === (bEntry.mangledName as string)) throw new Error("same mangled names");
});

Deno.test("wacResolve: struct type indices are assigned in DFS order", () => {
  const r = ok("/main.wac", [
    ["/main.wac", `
      import { Vec } from "./vec.wac";
      struct Matrix { i32 rows; i32 cols; }
    `],
    ["/vec.wac", `export struct Vec { f64 x; f64 y; }`],
  ]);
  // Vec comes first (imported) → typeIndex 0, Matrix → typeIndex 1
  const vecEntry = r.fileScopes.get("/main.wac")!.get("Vec")!.entry as StructEntry;
  const matEntry = r.fileScopes.get("/main.wac")!.get("Matrix")!.entry as StructEntry;
  if (vecEntry.typeIndex !== 0) throw new Error(`Vec typeIndex ${vecEntry.typeIndex}`);
  if (matEntry.typeIndex !== 1) throw new Error(`Matrix typeIndex ${matEntry.typeIndex}`);
});

// ── Edge cases ────────────────────────────────────────────────────────────────

Deno.test("wacResolve: struct with no methods still registered", () => {
  const r = ok("/main.wac", [["/main.wac", "struct Empty { }"]]);
  if (r.structs.length !== 1) throw new Error("1 struct");
  if (r.structs[0].methods.size !== 0) throw new Error("no methods");
  if (r.funcs.length !== 0) throw new Error("no funcs from struct with no methods");
});

Deno.test("wacResolve: export struct is in file scope", () => {
  const r = ok("/main.wac", [["/main.wac", "export struct Foo { i32 x; }"]]);
  const scope = r.fileScopes.get("/main.wac")!;
  if (!scope.has("Foo")) throw new Error("Foo in scope");
});

Deno.test("wacResolve: import struct and use locally", () => {
  const r = ok("/main.wac", [
    ["/main.wac", `
      import { Point } from "./geo.wac";
      export i32 run() { Point p = Point(1, 2); return p.x; }
    `],
    ["/geo.wac", `export struct Point { i32 x; i32 y; }`],
  ]);
  const mainScope = r.fileScopes.get("/main.wac")!;
  const pointEntry = mainScope.get("Point")!;
  if (pointEntry.kind !== "struct") throw new Error("struct");
  // Point should share the same StructEntry as in geo.wac
  const geoScope = r.fileScopes.get("/geo.wac")!;
  if (mainScope.get("Point") !== geoScope.get("Point")) throw new Error("same entry");
});

Deno.test("wacResolve: const struct is still registered correctly", () => {
  const r = ok("/main.wac", [["/main.wac", `const struct Config { i32 width; i32 height; }`]]);
  if (r.structs.length !== 1) throw new Error("1 struct");
  if (r.structs[0].structDecl.isConst !== true) throw new Error("isConst");
});

// ── Coverage edge cases ───────────────────────────────────────────────────────

Deno.test("wacResolve: funcParams on method entry (not just func)", () => {
  const r = ok("/main.wac", [["/main.wac", `
    struct Foo { i32 bar(this, i32 x, i32 y) { return x + y; } }
  `]]);
  const method = r.funcs[0];
  if (!isMethod(method)) throw new Error("isMethod");
  const params = funcParams(method);
  if (params.length !== 2) throw new Error(`params ${params.length}`);
  if (params[0].name !== "x") throw new Error("param x");
  if (params[1].name !== "y") throw new Error("param y");
});

Deno.test("wacResolve: file without directory prefix (no '/' in path)", () => {
  // Tests resolvePath when baseFile has no '/' — uses '.' as dir
  const r = ok("main.wac", [
    ["main.wac", `import { helper } from "./util.wac"; export i32 run() { return helper(); }`],
    ["util.wac", `export i32 helper() { return 1; }`],
  ]);
  if (r.errors.length > 0) throw new Error(`errors: ${r.errors.map(e => e.message)}`);
  if (r.funcs.length !== 2) throw new Error(`funcs: ${r.funcs.length}`);
});

Deno.test("wacResolve: file stem without extension", () => {
  // Tests stem() when filename has no extension
  const r = ok("main", [["main", `export i32 run() { return 1; }`]]);
  if (r.funcs[0].mangledName !== "main$run") throw new Error(`mangled: ${r.funcs[0].mangledName}`);
});

Deno.test("wacResolve: deep parent dir path (../../)", () => {
  // Tests joinPath with path that goes above initial dir
  const r = ok("/a/b/main.wac", [
    ["/a/b/main.wac", `import { util } from "../../shared/util.wac"; export i32 run() { return util(); }`],
    ["/shared/util.wac", `export i32 util() { return 1; }`],
  ]);
  if (r.errors.length > 0) throw new Error(`errors: ${r.errors.map(e => e.message)}`);
  if (r.funcs.length !== 2) throw new Error(`funcs: ${r.funcs.length}`);
});
