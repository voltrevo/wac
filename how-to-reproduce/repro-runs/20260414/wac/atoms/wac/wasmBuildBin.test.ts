// Tests for wasmBuildBin — verifies wasm binary assembly by building modules
// from wac source code, instantiating them, and checking outputs.

import { wasmBuildBin } from "./wasmBuildBin.ts";
import { wacResolve } from "./wacResolve.ts";
import { wacTypeCheck } from "./wacTypeCheck.ts";

// ---- Pipeline helper ----

/** Build a TypedModule from a map of filePath → source text. */
function makeTyped(
  sources: Record<string, string>,
  entryPath: string,
): ReturnType<typeof wacTypeCheck> {
  const cap = {
    readFile(path: string): string {
      const src = sources[path];
      if (src === undefined) throw new Error(`file not found: ${path}`);
      return src;
    },
  };
  const resolved = wacResolve(cap, entryPath);
  if (resolved.errors.length > 0) {
    throw new Error(`resolve errors: ${resolved.errors.map(e => e.message).join(", ")}`);
  }
  const typed = wacTypeCheck(resolved);
  if (typed.errors.length > 0) {
    throw new Error(`typecheck errors: ${typed.errors.map(e => e.message).join(", ")}`);
  }
  return typed;
}

/** Instantiate a compiled wasm module and return its exports. */
async function run(wasm: Uint8Array): Promise<WebAssembly.Exports> {
  return ((await WebAssembly.instantiate(wasm)) as any).instance.exports;
}

// ---- Tests: no GC types ----

Deno.test("wasmBuildBin: factorial [§wac-factorial-lzkw61q]", async () => {
  const typed = makeTyped({
    "/main.wac": `
export i32 factorial(i32 n) {
  if (n <= 1) { return 1; }
  return n * factorial(n - 1);
}`,
  }, "/main.wac");

  const { wasm, exports } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.factorial as (n: number) => number;
  if (exports.length !== 1) throw new Error("expected 1 export");
  if (exports[0]!.name !== "factorial") throw new Error("wrong export name");
  if (f(10) !== 3628800) throw new Error(`factorial(10)=${f(10)}`);
  if (f(0)  !== 1)       throw new Error(`factorial(0)=${f(0)}`);
});

Deno.test("wasmBuildBin: mutual recursion [§wac-mutual-exg2t9c]", async () => {
  const typed = makeTyped({
    "/main.wac": `
i32 isEven(i32 n) {
  if (n == 0) { return 1; }
  return isOdd(n - 1);
}
i32 isOdd(i32 n) {
  if (n == 0) { return 0; }
  return isEven(n - 1);
}
export i32 checkEven(i32 n) { return isEven(n); }`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.checkEven as (n: number) => number;
  if (f(42) !== 1) throw new Error(`checkEven(42)=${f(42)}`);
  if (f(17) !== 0) throw new Error(`checkEven(17)=${f(17)}`);
});

Deno.test("wasmBuildBin: void return [§wac-ret-void-ezw2lqp]", async () => {
  const typed = makeTyped({
    "/main.wac": `
export void noop() { }
export void earlyReturn(bool flag) {
  if (flag) { return; }
}`,
  }, "/main.wac");

  const { wasm, exports } = wasmBuildBin(typed);
  const inst = await run(wasm);
  (inst.noop as () => void)();
  (inst.earlyReturn as (flag: number) => void)(1);
  if (exports.length !== 2) throw new Error("expected 2 exports");
  if (exports[0]!.ret !== "void") throw new Error("expected void return type");
});

// ---- Tests: with GC types ----

Deno.test("wasmBuildBin: struct create and field read [§wac-ret-struct-kpjs5dg]", async () => {
  const typed = makeTyped({
    "/main.wac": `
struct Point { f64 x; f64 y; }
export f64 sumCoords(f64 a, f64 b) {
  Point p = Point(a, b);
  return p.x + p.y;
}`,
  }, "/main.wac");

  const { wasm, exports } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.sumCoords as (a: number, b: number) => number;
  const result = f(3.0, 4.0);
  if (result !== 7.0) throw new Error(`sumCoords(3,4)=${result}`);
  if (exports[0]!.params.length !== 2) throw new Error("expected 2 params");
  if (exports[0]!.params[0]!.type !== "f64") throw new Error("wrong param type");
});

Deno.test("wasmBuildBin: struct with i32 and bool fields", async () => {
  const typed = makeTyped({
    "/main.wac": `
struct Counter { i32 value; bool active; }
export i32 makeAndRead(i32 v) {
  Counter c = Counter(v, true);
  return c.value;
}`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.makeAndRead as (v: number) => number;
  if (f(42) !== 42) throw new Error(`makeAndRead(42)=${f(42)}`);
});

Deno.test("wasmBuildBin: struct with i64 and f32 fields", async () => {
  const typed = makeTyped({
    "/main.wac": `
struct BigNum { i64 val; f32 approx; }
export i64 getVal(i64 v) {
  BigNum b = BigNum(v, 0.0);
  return b.val;
}`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.getVal as (v: bigint) => bigint;
  if (f(999n) !== 999n) throw new Error(`getVal(999)=${f(999n)}`);
});

Deno.test("wasmBuildBin: struct with nullable field (encodeValType nullable)", async () => {
  const typed = makeTyped({
    "/main.wac": `
struct Node { i32 val; Node? next; }
export i32 makeNode(i32 v) {
  Node n = Node(v, null);
  return n.val;
}`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.makeNode as (v: number) => number;
  if (f(7) !== 7) throw new Error(`makeNode(7)=${f(7)}`);
});

// ---- Tests: struct inheritance ----

Deno.test("wasmBuildBin: struct inheritance (open sub type encoding)", async () => {
  // Shape is a parent → must be encoded as open sub type (0x50 0x00 0x5F ...)
  // Rect extends Shape → encoded as sub type with parent (0x50 0x01 ...)
  // This test would fail with "type 1 extends final type 0" before the fix.
  const typed = makeTyped({
    "/main.wac": `
struct Shape { f64 x; f64 y; }
struct Rect : Shape { f64 w; f64 h; }
export f64 rectArea(f64 w, f64 h) {
  Rect r = Rect();
  r.w = w;
  r.h = h;
  return r.w * r.h;
}`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  // Instantiation would fail with "extends final type" without the fix.
  const inst = await run(wasm);
  const f = inst.rectArea as (w: number, h: number) => number;
  const area = f(3.0, 4.0);
  if (area !== 12.0) throw new Error(`rectArea(3,4)=${area}`);
});

Deno.test("wasmBuildBin: multi-level inheritance (grandparent open type)", async () => {
  // A → B → C chain: both A and B must be open sub types.
  const typed = makeTyped({
    "/main.wac": `
struct A { i32 x; }
struct B : A { i32 y; }
struct C : B { i32 z; }
export i32 getZ(i32 zv) {
  C c = C();
  c.z = zv;
  return c.z;
}`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.getZ as (z: number) => number;
  if (f(99) !== 99) throw new Error(`getZ(99)=${f(99)}`);
});

Deno.test("wasmBuildBin: leaf struct stays final (no parent, no children)", async () => {
  // A standalone struct with no inheritance should be final.
  // This tests the path: !decl.parent && !parentStructs.has(name) → return structDef.
  const typed = makeTyped({
    "/main.wac": `
struct Leaf { i32 v; }
export i32 roundtrip(i32 v) {
  Leaf x = Leaf(v);
  return x.v;
}`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.roundtrip as (v: number) => number;
  if (f(55) !== 55) throw new Error(`roundtrip(55)=${f(55)}`);
});

// ---- Tests: struct methods ----

Deno.test("wasmBuildBin: struct method with const this", async () => {
  const typed = makeTyped({
    "/main.wac": `
struct Point {
  f64 x;
  f64 y;
  f64 distSq(const this, Point other) {
    f64 dx = this.x - other.x;
    f64 dy = this.y - other.y;
    return dx * dx + dy * dy;
  }
}
export f64 run(f64 x1, f64 y1, f64 x2, f64 y2) {
  Point a = Point(x1, y1);
  Point b = Point(x2, y2);
  return a.distSq(b);
}`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.run as (x1: number, y1: number, x2: number, y2: number) => number;
  // (3-0)^2 + (4-0)^2 = 25
  if (f(0.0, 0.0, 3.0, 4.0) !== 25.0) throw new Error(`distSq != 25`);
});

Deno.test("wasmBuildBin: static struct method", async () => {
  const typed = makeTyped({
    "/main.wac": `
struct Point {
  f64 x;
  f64 y;
  Point create(f64 x, f64 y) {
    return Point(x, y);
  }
}
export f64 run(f64 x, f64 y) {
  Point p = Point.create(x, y);
  return p.x + p.y;
}`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.run as (x: number, y: number) => number;
  if (f(1.5, 2.5) !== 4.0) throw new Error(`run(1.5,2.5)=${f(1.5, 2.5)}`);
});

// ---- Tests: array types ----

Deno.test("wasmBuildBin: i32 array type in signature (encodeValType array)", async () => {
  const typed = makeTyped({
    "/main.wac": `
export i32 sumArr(i32[] arr) {
  i32 s = 0;
  for (i32 i = 0; i < arr.len(); i++) {
    s += arr[i];
  }
  return s;
}`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.sumArr as (arr: any) => number;
  // Build a wasm i32 array of [1, 2, 3] to pass.
  // We need to pass a GC array object — use struct.new to create one.
  // Instead, verify that the module compiles and exports are correct.
  const { exports } = wasmBuildBin(typed);
  if (exports[0]!.params[0]!.type !== "i32[]") throw new Error("wrong array param type");
});

Deno.test("wasmBuildBin: string type in signature (encodeValType string → i8 array)", async () => {
  // string type forces i8 array elem to be in the type section.
  const typed = makeTyped({
    "/main.wac": `
export i32 strLen(string s) {
  return s.len();
}`,
  }, "/main.wac");

  const { wasm, exports } = wasmBuildBin(typed);
  // Just verify the binary compiles; calling with a string is complex.
  await run(wasm);
  if (exports[0]!.params[0]!.type !== "string") throw new Error("wrong string param type");
});

Deno.test("wasmBuildBin: struct with string field (i8 array in rec group)", async () => {
  // string field forces i8 array type into the rec group.
  // Use string? (nullable) so struct.new_default can zero-init it to null.
  const typed = makeTyped({
    "/main.wac": `
struct Msg { i32 id; string? text; }
export i32 msgId(i32 id) {
  Msg m = Msg();
  m.id = id;
  return m.id;
}`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.msgId as (id: number) => number;
  if (f(5) !== 5) throw new Error(`msgId(5)=${f(5)}`);
});

Deno.test("wasmBuildBin: i16 array elem (encodeFieldType i16)", async () => {
  // i16[] in a function return type forces encodeFieldType i16 path in encodeArrayTypeDef.
  // A private helper with i16[] return type gets scanned by scanForArrayElems.
  const typed = makeTyped({
    "/main.wac": `
i16[] makeArr(i32 n) { return i16[n](); }
export i32 getLen(i32 n) { return makeArr(n).len(); }`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.getLen as (n: number) => number;
  if (f(3) !== 3) throw new Error(`getLen(3)=${f(3)}`);
});

// ---- Tests: anyref and i31ref ----

Deno.test("wasmBuildBin: anyref field (encodeValType anyref)", async () => {
  // anyref field forces encodeValType anyref path.
  const typed = makeTyped({
    "/main.wac": `
struct Box { anyref value; }
export i32 run() {
  Box b = Box();
  return 42;
}`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.run as () => number;
  if (f() !== 42) throw new Error(`run()=${f()}`);
});

Deno.test("wasmBuildBin: i31ref field (encodeValType i31ref)", async () => {
  const typed = makeTyped({
    "/main.wac": `
struct Tag { i31ref val; }
export i32 run() {
  Tag t = Tag();
  return 1;
}`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.run as () => number;
  if (f() !== 1) throw new Error(`run()=${f()}`);
});

// ---- Tests: nullable types in encodeValType ----

Deno.test("wasmBuildBin: nullable array field (encodeValType nullable array)", async () => {
  const typed = makeTyped({
    "/main.wac": `
struct Buf { i32[]? data; }
export i32 run() {
  Buf b = Buf();
  return 7;
}`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.run as () => number;
  if (f() !== 7) throw new Error(`run()=${f()}`);
});

Deno.test("wasmBuildBin: nullable string field (encodeValType nullable string)", async () => {
  const typed = makeTyped({
    "/main.wac": `
struct Opt { string? name; }
export i32 run() {
  Opt o = Opt();
  return 3;
}`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.run as () => number;
  if (f() !== 3) throw new Error(`run()=${f()}`);
});

// ---- Tests: duplicate array elem deduplication ----

Deno.test("wasmBuildBin: duplicate array elem types deduped (addArrayElem false path)", async () => {
  // Two functions both use i32[], forcing addArrayElem to be called twice for
  // the same type. The second call hits the `!arrayElems.some(e => typeEq(...))` false branch.
  const typed = makeTyped({
    "/main.wac": `
export i32 lenA(i32[] a) { return a.len(); }
export i32 lenB(i32[] b) { return b.len(); }`,
  }, "/main.wac");

  const { wasm, exports } = wasmBuildBin(typed);
  await run(wasm);
  if (exports.length !== 2) throw new Error("expected 2 exports");
});

// ---- Tests: funcSigIdx deduplication ----

Deno.test("wasmBuildBin: funcSig deduplication (funcSigIdx i>=0 path)", async () => {
  // Multiple functions with the same signature → funcSigIdx returns existing entry.
  const typed = makeTyped({
    "/main.wac": `
export i32 double(i32 x) { return x * 2; }
export i32 triple(i32 x) { return x * 3; }
export i32 quad(i32 x) { return x * 4; }`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const d = inst.double as (n: number) => number;
  const t = inst.triple as (n: number) => number;
  const q = inst.quad as (n: number) => number;
  if (d(5) !== 10) throw new Error(`double(5)=${d(5)}`);
  if (t(5) !== 15) throw new Error(`triple(5)=${t(5)}`);
  if (q(5) !== 20) throw new Error(`quad(5)=${q(5)}`);
});

// ---- Tests: multi-file (imports) ----

Deno.test("wasmBuildBin: multi-file import (buildLocalFuncIdx with NameEnv)", async () => {
  // Importing a function from another file exercises buildLocalFuncIdx NameEnv lookup.
  const typed = makeTyped({
    "/lib.wac": `
export i32 square(i32 x) { return x * x; }`,
    "/main.wac": `
import { square } from "./lib.wac";
export i32 sumSquares(i32 a, i32 b) { return square(a) + square(b); }`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.sumSquares as (a: number, b: number) => number;
  // 3^2 + 4^2 = 25
  if (f(3, 4) !== 25) throw new Error(`sumSquares(3,4)=${f(3, 4)}`);
});

// ---- Tests: WacCompiled exports metadata ----

Deno.test("wasmBuildBin: exports metadata shape", () => {
  const typed = makeTyped({
    "/main.wac": `
export i32 add(i32 a, i32 b) { return a + b; }
export f64 pi() { return 3.14159; }
i32 private_helper(i32 x) { return x; }`,
  }, "/main.wac");

  const { exports } = wasmBuildBin(typed);
  // Only exported functions appear in metadata.
  if (exports.length !== 2) throw new Error(`expected 2 exports, got ${exports.length}`);
  const add = exports.find(e => e.name === "add")!;
  if (!add) throw new Error("missing add export");
  if (add.params.length !== 2) throw new Error("wrong param count");
  if (add.params[0]!.name !== "a") throw new Error("wrong param name");
  if (add.params[0]!.type !== "i32") throw new Error("wrong param type");
  if (add.ret !== "i32") throw new Error("wrong ret type");
  const pi = exports.find(e => e.name === "pi")!;
  if (pi.ret !== "f64") throw new Error("wrong pi ret type");
  if (pi.params.length !== 0) throw new Error("pi should have no params");
});

// ---- Tests: typeStr named, nullable — export metadata types ----

Deno.test("wasmBuildBin: typeStr named in export metadata", () => {
  // Exported function with struct return type → typeStr({tag:"named",...}) used in metadata.
  const typed = makeTyped({
    "/main.wac": `
struct Point { i32 x; i32 y; }
export Point makePoint(i32 x, i32 y) { return Point(x, y); }`,
  }, "/main.wac");

  const { exports } = wasmBuildBin(typed);
  if (exports[0]!.ret !== "Point") throw new Error(`wrong ret type: ${exports[0]!.ret}`);
  if (exports[0]!.params[0]!.type !== "i32") throw new Error("wrong param type");
});

Deno.test("wasmBuildBin: typeStr nullable in export metadata and typeEq nullable dedup", () => {
  // nullable return type → typeStr nullable; two same-signature fns → typeEq nullable dedup.
  const typed = makeTyped({
    "/main.wac": `
struct P { i32 x; }
export P? getNullP() { return null; }
P? helper() { return null; }`,
  }, "/main.wac");

  const { exports } = wasmBuildBin(typed);
  if (exports[0]!.ret !== "P?") throw new Error(`wrong ret type: ${exports[0]!.ret}`);
});

Deno.test("wasmBuildBin: funcref param (scanForArrayElems, scanForFuncSigs, encodeValType funcref)", async () => {
  // A void function with a funcref param triggers:
  // - scanForArrayElems funcref branch (scans inside funcref for array types)
  // - scanForFuncSigs funcref branch (registers the funcref's signature)
  // - encodeValType funcref branch (encodes the param type in the function sig)
  const typed = makeTyped({
    "/main.wac": `
export void setCallback(fn[i32(i32)] f) { }`,
  }, "/main.wac");

  const { wasm, exports } = wasmBuildBin(typed);
  await run(wasm);
  if (exports[0]!.params[0]!.type !== "fn[i32(i32)]") {
    throw new Error(`wrong funcref param type: ${exports[0]!.params[0]!.type}`);
  }
});

Deno.test("wasmBuildBin: nullable funcref field (encodeValType nullable funcref)", async () => {
  // A struct with fn[void()]? field triggers the nullable<funcref> path in encodeValType.
  const typed = makeTyped({
    "/main.wac": `
struct Handler { fn[void()]? callback; }
export i32 run() {
  Handler h = Handler();
  return 5;
}`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.run as () => number;
  if (f() !== 5) throw new Error(`run()=${f()}`);
});

Deno.test("wasmBuildBin: nullable anyref field (encodeValType nullable anyref)", async () => {
  // struct with anyref? field triggers nullable<anyref> path → encodes as [0x6E].
  const typed = makeTyped({
    "/main.wac": `
struct Box { anyref? value; }
export i32 run() {
  Box b = Box();
  return 9;
}`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.run as () => number;
  if (f() !== 9) throw new Error(`run()=${f()}`);
});

Deno.test("wasmBuildBin: nullable i31ref field (encodeValType nullable i31ref)", async () => {
  // struct with i31ref? field triggers nullable<i31ref> path → encodes as [0x6C].
  const typed = makeTyped({
    "/main.wac": `
struct Tag { i31ref? val; }
export i32 run() {
  Tag t = Tag();
  return 11;
}`,
  }, "/main.wac");

  const { wasm } = wasmBuildBin(typed);
  const inst = await run(wasm);
  const f = inst.run as () => number;
  if (f() !== 11) throw new Error(`run()=${f()}`);
});
