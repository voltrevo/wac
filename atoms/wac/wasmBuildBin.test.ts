// Integration tests for wasmBuildBin + wacEmitFunc.
// Each test compiles a wac source string to .wasm, instantiates it, and verifies outputs.

import { wacLex } from "./wacLex.ts";
import { wacParse, type Program } from "./wacParse.ts";
import { wacResolve } from "./wacResolve.ts";
import { wasmBuildBin } from "./wasmBuildBin.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function compile(src: string, file = "main.wac"): Uint8Array {
  const { tokens } = wacLex(src);
  const { program, errors: pe } = wacParse(tokens, file);
  if (pe.length) throw new Error(`Parse: ${pe.map(e => e.message).join("; ")}`);
  const programs = new Map<string, Program>([[file, program]]);
  const result = wacResolve(file, programs);
  if (result.errors.length) throw new Error(`Resolve: ${result.errors.map(e => e.message).join("; ")}`);
  return wasmBuildBin(result, programs);
}

async function inst(src: string): Promise<Record<string, (...a: unknown[]) => unknown>> {
  const bytes = compile(src);
  const wasm = await WebAssembly.instantiate(bytes, {});
  const instance = (wasm as unknown as { instance: WebAssembly.Instance }).instance;
  return instance.exports as Record<string, (...a: unknown[]) => unknown>;
}

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`${msg}: expected ${b}, got ${a}`);
}

// ── Binary produces valid wasm ─────────────────────────────────────────────────

Deno.test("wasmBuildBin: produces valid wasm magic and version", () => {
  const bytes = compile(`export i32 f() { return 1; }`);
  eq(bytes[0], 0x00, "magic[0]");
  eq(bytes[1], 0x61, "magic[1]");
  eq(bytes[2], 0x73, "magic[2]");
  eq(bytes[3], 0x6D, "magic[3]");
  eq(bytes[4], 0x01, "version[0]");
  eq(bytes[5], 0x00, "version[1]");
});

// ── Arithmetic ─────────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: i32 add", async () => {
  const e = await inst(`export i32 add(i32 a, i32 b) { return a + b; }`);
  eq(e.add(3, 4), 7, "add(3,4)");
  eq(e.add(-1, 1), 0, "add(-1,1)");
});

Deno.test("wasmBuildBin: i32 subtract", async () => {
  const e = await inst(`export i32 sub(i32 a, i32 b) { return a - b; }`);
  eq(e.sub(10, 3), 7, "sub(10,3)");
});

Deno.test("wasmBuildBin: i32 multiply", async () => {
  const e = await inst(`export i32 mul(i32 a, i32 b) { return a * b; }`);
  eq(e.mul(6, 7), 42, "mul(6,7)");
});

Deno.test("wasmBuildBin: i32 divide (signed)", async () => {
  const e = await inst(`export i32 div(i32 a, i32 b) { return a / b; }`);
  eq(e.div(10, 3), 3, "div(10,3)");
  eq(e.div(-10, 3), -3, "div(-10,3)");
});

Deno.test("wasmBuildBin: i32 modulo", async () => {
  const e = await inst(`export i32 mod_(i32 a, i32 b) { return a % b; }`);
  eq(e.mod_(10, 3), 1, "mod_(10,3)");
});

Deno.test("wasmBuildBin: unary negation", async () => {
  const e = await inst(`export i32 neg(i32 a) { return -a; }`);
  eq(e.neg(5), -5, "neg(5)");
  eq(e.neg(-3), 3, "neg(-3)");
  eq(e.neg(0), 0, "neg(0)");
});

Deno.test("wasmBuildBin: bitwise ops", async () => {
  const e = await inst(`
    export i32 band(i32 a, i32 b) { return a & b; }
    export i32 bor(i32 a, i32 b) { return a | b; }
    export i32 bxor(i32 a, i32 b) { return a ^ b; }
    export i32 bnot(i32 a) { return ~a; }
    export i32 lsh(i32 a, i32 n) { return a << n; }
    export i32 rsh(i32 a, i32 n) { return a >> n; }
  `);
  eq(e.band(0b1010, 0b1100), 0b1000, "band");
  eq(e.bor(0b1010, 0b1100), 0b1110, "bor");
  eq(e.bxor(0b1010, 0b1100), 0b0110, "bxor");
  eq(e.bnot(0), -1, "bnot(0)");
  eq(e.lsh(1, 3), 8, "lsh(1,3)");
  eq(e.rsh(8, 2), 2, "rsh(8,2)");
});

Deno.test("wasmBuildBin: comparison ops", async () => {
  const e = await inst(`
    export i32 lt(i32 a, i32 b) { return a < b ? 1 : 0; }
    export i32 le(i32 a, i32 b) { return a <= b ? 1 : 0; }
    export i32 gt(i32 a, i32 b) { return a > b ? 1 : 0; }
    export i32 ge(i32 a, i32 b) { return a >= b ? 1 : 0; }
    export i32 eq_(i32 a, i32 b) { return a == b ? 1 : 0; }
    export i32 ne(i32 a, i32 b) { return a != b ? 1 : 0; }
  `);
  eq(e.lt(1, 2), 1, "1<2"); eq(e.lt(2, 1), 0, "2<1");
  eq(e.le(2, 2), 1, "2<=2"); eq(e.le(3, 2), 0, "3<=2");
  eq(e.gt(3, 2), 1, "3>2"); eq(e.gt(1, 2), 0, "1>2");
  eq(e.ge(2, 2), 1, "2>=2"); eq(e.ge(1, 2), 0, "1>=2");
  eq(e.eq_(3, 3), 1, "3==3"); eq(e.eq_(3, 4), 0, "3==4");
  eq(e.ne(3, 4), 1, "3!=4"); eq(e.ne(3, 3), 0, "3!=3");
});

// ── Boolean logic ──────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: boolean and (short-circuit)", async () => {
  const e = await inst(`export i32 and_(i32 a, i32 b) { return a == 1 && b == 1 ? 1 : 0; }`);
  eq(e.and_(1, 1), 1, "1&&1");
  eq(e.and_(1, 0), 0, "1&&0");
  eq(e.and_(0, 1), 0, "0&&1");
});

Deno.test("wasmBuildBin: boolean or (short-circuit)", async () => {
  const e = await inst(`export i32 or_(i32 a, i32 b) { return a == 1 || b == 1 ? 1 : 0; }`);
  eq(e.or_(0, 0), 0, "0||0");
  eq(e.or_(1, 0), 1, "1||0");
  eq(e.or_(0, 1), 1, "0||1");
});

Deno.test("wasmBuildBin: boolean not", async () => {
  const e = await inst(`export i32 not_(i32 a) { return !a ? 1 : 0; }`);
  eq(e.not_(0), 1, "!0");
  eq(e.not_(5), 0, "!5");
});

// ── Control flow ──────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: if without else (void)", async () => {
  const e = await inst(`
    export i32 clamp(i32 v) {
      i32 x = v;
      if (x < 0) { x = 0; }
      return x;
    }
  `);
  eq(e.clamp(-5), 0, "clamp(-5)");
  eq(e.clamp(3), 3, "clamp(3)");
});

Deno.test("wasmBuildBin: if-else with return in both branches", async () => {
  const e = await inst(`
    export i32 max_(i32 a, i32 b) {
      if (a > b) { return a; } else { return b; }
    }
  `);
  eq(e.max_(3, 7), 7, "max(3,7)");
  eq(e.max_(9, 2), 9, "max(9,2)");
  eq(e.max_(5, 5), 5, "max(5,5)");
});

Deno.test("wasmBuildBin: if-else-if chain", async () => {
  const e = await inst(`
    export i32 sign(i32 a) {
      if (a > 0) { return 1; } else if (a < 0) { return -1; } else { return 0; }
    }
  `);
  eq(e.sign(5), 1, "sign(5)");
  eq(e.sign(-3), -1, "sign(-3)");
  eq(e.sign(0), 0, "sign(0)");
});

Deno.test("wasmBuildBin: while loop", async () => {
  const e = await inst(`
    export i32 sum(i32 n) {
      i32 acc = 0;
      i32 i = 1;
      while (i <= n) { acc = acc + i; i = i + 1; }
      return acc;
    }
  `);
  eq(e.sum(10), 55, "sum(10)");
  eq(e.sum(0), 0, "sum(0)");
});

Deno.test("wasmBuildBin: for loop", async () => {
  const e = await inst(`
    export i32 factorial(i32 n) {
      i32 acc = 1;
      for (i32 i = 2; i <= n; i = i + 1) { acc = acc * i; }
      return acc;
    }
  `);
  eq(e.factorial(5), 120, "5!");
  eq(e.factorial(0), 1, "0!");
  eq(e.factorial(1), 1, "1!");
});

Deno.test("wasmBuildBin: do-while loop", async () => {
  const e = await inst(`
    export i32 countTo(i32 n) {
      i32 acc = 0;
      i32 i = 1;
      do { acc = acc + i; i = i + 1; } while (i <= n);
      return acc;
    }
  `);
  eq(e.countTo(4), 10, "countTo(4)=10");
  eq(e.countTo(1), 1, "countTo(1)=1");
});

Deno.test("wasmBuildBin: break from while", async () => {
  const e = await inst(`
    export i32 findFirst(i32 target) {
      i32 i = 0;
      while (i < 100) {
        if (i * i == target) { break; }
        i = i + 1;
      }
      return i;
    }
  `);
  eq(e.findFirst(9), 3, "sqrt(9)=3");
  eq(e.findFirst(16), 4, "sqrt(16)=4");
});

Deno.test("wasmBuildBin: continue in for loop", async () => {
  const e = await inst(`
    export i32 sumEvens(i32 n) {
      i32 acc = 0;
      for (i32 i = 0; i <= n; i = i + 1) {
        if (i % 2 != 0) { continue; }
        acc = acc + i;
      }
      return acc;
    }
  `);
  // 0+2+4+6+8+10 = 30
  eq(e.sumEvens(10), 30, "sumEvens(10)");
});

Deno.test("wasmBuildBin: switch statement", async () => {
  const e = await inst(`
    export i32 dayType(i32 d) {
      switch (d) {
        case 0: return 2;
        case 6: return 2;
        default: return 1;
      }
    }
  `);
  eq(e.dayType(0), 2, "Sunday");
  eq(e.dayType(6), 2, "Saturday");
  eq(e.dayType(3), 1, "Wednesday");
});

// ── Variables and assignment ───────────────────────────────────────────────────

Deno.test("wasmBuildBin: local var declaration and init", async () => {
  const e = await inst(`
    export i32 calc(i32 x) {
      i32 a = x * 2;
      i32 b = a + 1;
      return b;
    }
  `);
  eq(e.calc(5), 11, "calc(5)");
});

Deno.test("wasmBuildBin: compound assignment +=, -=, *=", async () => {
  const e = await inst(`
    export i32 compound(i32 x) {
      i32 a = x;
      a += 10;
      a *= 2;
      a -= 3;
      return a;
    }
  `);
  eq(e.compound(5), 27, "compound(5)");
});

Deno.test("wasmBuildBin: increment and decrement", async () => {
  const e = await inst(`
    export i32 incrTest(i32 n) {
      i32 a = n;
      a++;
      a++;
      a--;
      return a;
    }
  `);
  eq(e.incrTest(10), 11, "incrTest(10)");
});

Deno.test("wasmBuildBin: ternary expression", async () => {
  const e = await inst(`export i32 abs_(i32 x) { return x < 0 ? -x : x; }`);
  eq(e.abs_(-5), 5, "abs(-5)");
  eq(e.abs_(3), 3, "abs(3)");
});

// ── Function calls ─────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: call non-exported helper", async () => {
  const e = await inst(`
    i32 double(i32 x) { return x * 2; }
    export i32 quadruple(i32 x) { return double(double(x)); }
  `);
  eq(e.quadruple(3), 12, "quadruple(3)");
});

Deno.test("wasmBuildBin: recursive function", async () => {
  const e = await inst(`
    export i32 fib(i32 n) {
      if (n <= 1) { return n; }
      return fib(n - 1) + fib(n - 2);
    }
  `);
  eq(e.fib(0), 0, "fib(0)");
  eq(e.fib(1), 1, "fib(1)");
  eq(e.fib(10), 55, "fib(10)");
});

Deno.test("wasmBuildBin: multiple exported functions", async () => {
  const e = await inst(`
    export i32 add(i32 a, i32 b) { return a + b; }
    export i32 mul(i32 a, i32 b) { return a * b; }
  `);
  eq(e.add(3, 4), 7, "add");
  eq(e.mul(3, 4), 12, "mul");
});

// ── Struct types ───────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: struct new and field get", async () => {
  const e = await inst(`
    struct Point { i32 x; i32 y; }
    export Point makePoint(i32 x, i32 y) { return Point { x: x, y: y }; }
    export i32 getX(Point p) { return p.x; }
    export i32 getY(Point p) { return p.y; }
  `);
  const p = e.makePoint(3, 4);
  eq(e.getX(p), 3, "getX");
  eq(e.getY(p), 4, "getY");
});

Deno.test("wasmBuildBin: struct field set", async () => {
  const e = await inst(`
    struct Cell { i32 val; }
    export Cell makeCell(i32 v) { return Cell { val: v }; }
    export Cell setVal(Cell c, i32 v) { c.val = v; return c; }
    export i32 getVal(Cell c) { return c.val; }
  `);
  const c = e.makeCell(10);
  const c2 = e.setVal(c, 42);
  eq(e.getVal(c2), 42, "getVal after setVal");
});

Deno.test("wasmBuildBin: struct field compound assign", async () => {
  const e = await inst(`
    struct Counter { i32 n; }
    export Counter make(i32 n) { return Counter { n: n }; }
    export Counter inc(Counter c) { c.n += 1; return c; }
    export i32 get(Counter c) { return c.n; }
  `);
  let c = e.make(10);
  c = e.inc(c);
  c = e.inc(c);
  eq(e.get(c), 12, "counter after 2 inc");
});

Deno.test("wasmBuildBin: struct new_default (zero init)", async () => {
  const e = await inst(`
    struct Empty { i32 x; }
    export Empty mkDefault() { return Empty {}; }
    export i32 getX(Empty s) { return s.x; }
  `);
  const s = e.mkDefault();
  eq(e.getX(s), 0, "default x=0");
});

Deno.test("wasmBuildBin: two struct types", async () => {
  const e = await inst(`
    struct Vec2 { i32 x; i32 y; }
    struct Vec3 { i32 x; i32 y; i32 z; }
    export Vec2 v2(i32 x, i32 y) { return Vec2 { x: x, y: y }; }
    export Vec3 v3(i32 x, i32 y, i32 z) { return Vec3 { x: x, y: y, z: z }; }
    export i32 v2x(Vec2 v) { return v.x; }
    export i32 v3z(Vec3 v) { return v.z; }
  `);
  const v2 = e.v2(1, 2);
  const v3 = e.v3(3, 4, 5);
  eq(e.v2x(v2), 1, "v2.x");
  eq(e.v3z(v3), 5, "v3.z");
});

// ── Struct subtyping ───────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: struct inheritance (is test)", async () => {
  const e = await inst(`
    struct Shape { i32 tag; }
    struct Circle : Shape { i32 radius; }
    export Shape makeShape(i32 tag) { return Shape { tag: tag }; }
    export Circle makeCircle(i32 tag, i32 r) { return Circle { tag: tag, radius: r }; }
    export i32 getTag(Shape s) { return s.tag; }
    export i32 getRadius(Circle c) { return c.radius; }
    export i32 isCircle(Shape s) { return s is Circle ? 1 : 0; }
  `);
  const shape = e.makeShape(99);
  const circle = e.makeCircle(42, 7);
  eq(e.getTag(shape), 99, "getTag(shape)");
  eq(e.getTag(circle), 42, "getTag(circle) uses inherited field");
  eq(e.getRadius(circle), 7, "getRadius");
  eq(e.isCircle(shape), 0, "isCircle(shape)=0");
  eq(e.isCircle(circle), 1, "isCircle(circle)=1");
});

Deno.test("wasmBuildBin: struct inheritance downcast as!", async () => {
  const e = await inst(`
    struct Animal { i32 kind; }
    struct Dog : Animal { i32 breed; }
    export Animal makeAnimal(i32 k) { return Animal { kind: k }; }
    export Dog makeDog(i32 k, i32 b) { return Dog { kind: k, breed: b }; }
    export i32 getKind(Animal a) { return a.kind; }
    export i32 getBreed(Dog d) { return d.breed; }
    export Dog castDog(Animal a) { return a as! Dog; }
  `);
  const dog = e.makeDog(2, 5);
  const asAnimal = e.makeAnimal(1);
  eq(e.getKind(dog), 2, "getKind(dog)");
  const dogAgain = e.castDog(dog);
  eq(e.getBreed(dogAgain), 5, "getBreed after cast");
  // castDog on a non-dog should trap
  try {
    e.castDog(asAnimal);
    throw new Error("expected trap");
  } catch (err) {
    if ((err as Error).message === "expected trap") throw err;
    // trap happened — good
  }
});

Deno.test("wasmBuildBin: is not expression", async () => {
  const e = await inst(`
    struct Base { i32 x; }
    struct Sub : Base { i32 y; }
    export Base mkBase(i32 x) { return Base { x: x }; }
    export Sub mkSub(i32 x, i32 y) { return Sub { x: x, y: y }; }
    export i32 notSub(Base b) { return b is not Sub ? 1 : 0; }
  `);
  const base = e.mkBase(1);
  const sub = e.mkSub(2, 3);
  eq(e.notSub(base), 1, "isNotSub(base)=1");
  eq(e.notSub(sub), 0, "isNotSub(sub)=0");
});

// ── Methods ────────────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: struct method call", async () => {
  const e = await inst(`
    struct Point {
      i32 x;
      i32 y;
      i32 dist2(this) { return this.x * this.x + this.y * this.y; }
    }
    export Point makePoint(i32 x, i32 y) { return Point { x: x, y: y }; }
    export i32 dist2(Point p) { return p.dist2(); }
  `);
  const p = e.makePoint(3, 4);
  eq(e.dist2(p), 25, "dist2(3,4)=25");
});

Deno.test("wasmBuildBin: static method call", async () => {
  const e = await inst(`
    struct Math {
      i32 add(i32 a, i32 b) { return a + b; }
    }
    export i32 callStatic(i32 a, i32 b) { return Math.add(a, b); }
  `);
  eq(e.callStatic(5, 3), 8, "Math.add(5,3)");
});

// ── Arrays ─────────────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: array new_default and get/set", async () => {
  const e = await inst(`
    export i32[] makeArr(i32 n) { return i32[n](); }
    export void setItem(i32[] arr, i32 idx, i32 val) { arr[idx] = val; }
    export i32 getItem(i32[] arr, i32 idx) { return arr[idx]; }
    export i32 length(i32[] arr) { return arr.len(); }
  `);
  const arr = e.makeArr(5);
  e.setItem(arr, 2, 99);
  eq(e.getItem(arr, 2), 99, "arr[2]=99");
  eq(e.getItem(arr, 0), 0, "arr[0] default 0");
  eq(e.length(arr), 5, "len=5");
});

Deno.test("wasmBuildBin: array fixed init", async () => {
  const e = await inst(`
    export i32[] makeFixed() { return i32[](1, 2, 3, 4, 5); }
    export i32 getItem(i32[] arr, i32 idx) { return arr[idx]; }
    export i32 length(i32[] arr) { return arr.len(); }
  `);
  const arr = e.makeFixed();
  eq(e.length(arr), 5, "len=5");
  eq(e.getItem(arr, 0), 1, "arr[0]");
  eq(e.getItem(arr, 4), 5, "arr[4]");
});

Deno.test("wasmBuildBin: array compound assign element", async () => {
  const e = await inst(`
    export i32[] make(i32 n) { return i32[n](); }
    export void incr(i32[] arr, i32 idx) { arr[idx] += 10; }
    export i32 get(i32[] arr, i32 idx) { return arr[idx]; }
  `);
  const arr = e.make(3);
  e.incr(arr, 1);
  e.incr(arr, 1);
  eq(e.get(arr, 1), 20, "arr[1] after 2 incr");
  eq(e.get(arr, 0), 0, "arr[0] unchanged");
});

Deno.test("wasmBuildBin: array iteration", async () => {
  const e = await inst(`
    export i32[] fill(i32 n) {
      i32[] arr = i32[n]();
      for (i32 i = 0; i < n; i = i + 1) { arr[i] = i * i; }
      return arr;
    }
    export i32 get(i32[] arr, i32 i) { return arr[i]; }
  `);
  const arr = e.fill(5);
  eq(e.get(arr, 0), 0, "0^2");
  eq(e.get(arr, 2), 4, "2^2");
  eq(e.get(arr, 4), 16, "4^2");
});

// ── Null references ────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: nullable struct is null check", async () => {
  const e = await inst(`
    struct Node { i32 val; }
    export Node? makeNull() { return null; }
    export Node? makeNode(i32 v) { return Node { val: v }; }
    export i32 isNull_(Node? n) { return n is null ? 1 : 0; }
    export i32 getVal(Node n) { return n.val; }
  `);
  const n = e.makeNull();
  const node = e.makeNode(42);
  eq(e.isNull_(n), 1, "null is null");
  eq(e.isNull_(node), 0, "node is not null");
  eq(e.getVal(node as NonNullable<unknown>), 42, "getVal(node)");
});

// ── Type section layout ────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: multiple struct types share type section", async () => {
  // Tests that type indices are assigned correctly for multiple structs
  const e = await inst(`
    struct A { i32 x; }
    struct B { i32 y; }
    struct C { i32 z; }
    export A mkA(i32 x) { return A { x: x }; }
    export B mkB(i32 y) { return B { y: y }; }
    export C mkC(i32 z) { return C { z: z }; }
    export i32 getA(A a) { return a.x; }
    export i32 getB(B b) { return b.y; }
    export i32 getC(C c) { return c.z; }
  `);
  eq(e.getA(e.mkA(1)), 1, "A");
  eq(e.getB(e.mkB(2)), 2, "B");
  eq(e.getC(e.mkC(3)), 3, "C");
});

Deno.test("wasmBuildBin: struct hierarchy (grandparent chain)", async () => {
  const e = await inst(`
    struct A { i32 a; }
    struct B : A { i32 b; }
    struct C : B { i32 c; }
    export A mkA(i32 a) { return A { a: a }; }
    export B mkB(i32 a, i32 b) { return B { a: a, b: b }; }
    export C mkC(i32 a, i32 b, i32 c) { return C { a: a, b: b, c: c }; }
    export i32 getA(A x) { return x.a; }
    export i32 getB(B x) { return x.b; }
    export i32 getC(C x) { return x.c; }
    export i32 isB(A x) { return x is B ? 1 : 0; }
    export i32 isC(A x) { return x is C ? 1 : 0; }
  `);
  const a = e.mkA(1);
  const b = e.mkB(2, 3);
  const c = e.mkC(4, 5, 6);
  eq(e.getA(a), 1, "A.a");
  eq(e.getA(b), 2, "B.a (inherited)");
  eq(e.getA(c), 4, "C.a (double-inherited)");
  eq(e.getB(b), 3, "B.b");
  eq(e.getB(c), 5, "C.b (inherited)");
  eq(e.getC(c), 6, "C.c");
  eq(e.isB(b), 1, "b is B");
  eq(e.isB(c), 1, "c is B (subtype)");
  eq(e.isC(b), 0, "b is not C");
  eq(e.isC(c), 1, "c is C");
});

// ── Return types ──────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: void function", async () => {
  const e = await inst(`
    struct Counter { i32 n; }
    export Counter mk() { return Counter { n: 0 }; }
    export void add(Counter c, i32 n) { c.n = c.n + n; }
    export i32 get(Counter c) { return c.n; }
  `);
  const c = e.mk();
  e.add(c, 5);
  e.add(c, 3);
  eq(e.get(c), 8, "counter after add 5+3");
});

Deno.test("wasmBuildBin: early return from loop", async () => {
  const e = await inst(`
    export i32 indexOf(i32[] arr, i32 val) {
      for (i32 i = 0; i < arr.len(); i = i + 1) {
        if (arr[i] == val) { return i; }
      }
      return -1;
    }
    export i32[] mkArr() { return i32[](10, 20, 30, 40, 50); }
  `);
  const arr = e.mkArr();
  eq(e.indexOf(arr, 30), 2, "indexOf(30)=2");
  eq(e.indexOf(arr, 99), -1, "indexOf(99)=-1");
});

// ── Trap instruction ──────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: trap statement causes wasm trap", async () => {
  const e = await inst(`
    export i32 failOrReturn(i32 x) {
      if (x == 0) { trap; }
      return x;
    }
  `);
  eq(e.failOrReturn(5), 5, "no trap");
  try {
    e.failOrReturn(0);
    throw new Error("expected trap");
  } catch (err) {
    if ((err as Error).message === "expected trap") throw err;
    // wasm trap — good
  }
});

// ── String type ───────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: string literal creates array", async () => {
  const e = await inst(`
    export string makeStr() { return "hello"; }
    export i32 strLen(string s) { return s.len(); }
  `);
  const s = e.makeStr();
  eq(e.strLen(s), 5, "len('hello')=5");
});

// ── Funcref type ──────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: funcref field and indirect call", async () => {
  const e = await inst(`
    struct Cb { fn[i32(i32)] f; }
    i32 dbl(i32 x) { return x * 2; }
    export Cb mkCb() { return Cb { f: dbl }; }
    export i32 callCb(Cb cb, i32 x) { return cb.f(x); }
  `);
  const cb = e.mkCb();
  eq(e.callCb(cb, 5), 10, "indirect call dbl(5)=10");
});

// ── Edge cases ────────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: constant zero i32", async () => {
  const e = await inst(`export i32 zero() { return 0; }`);
  eq(e.zero(), 0, "zero");
});

Deno.test("wasmBuildBin: large constant", async () => {
  const e = await inst(`export i32 bigNum() { return 1000000; }`);
  eq(e.bigNum(), 1000000, "bigNum");
});

Deno.test("wasmBuildBin: function with no params", async () => {
  const e = await inst(`export i32 answer() { return 42; }`);
  eq(e.answer(), 42, "answer");
});

Deno.test("wasmBuildBin: multiple locals same type grouped", async () => {
  const e = await inst(`
    export i32 multi(i32 x) {
      i32 a = x;
      i32 b = x + 1;
      i32 c = x + 2;
      return a + b + c;
    }
  `);
  // a=5, b=6, c=7 → 18
  eq(e.multi(5), 18, "multi(5)");
});

Deno.test("wasmBuildBin: ref.is_null check on array", async () => {
  const e = await inst(`
    export i32[]? mkNull() { return null; }
    export i32[] mkArr(i32 n) { return i32[n](); }
    export i32 isNull_(i32[]? arr) { return arr is null ? 1 : 0; }
  `);
  const nullArr = e.mkNull();
  const arr = e.mkArr(3);
  eq(e.isNull_(nullArr), 1, "null is null");
  eq(e.isNull_(arr), 0, "arr is not null");
});

Deno.test("wasmBuildBin: unwrap operator (ref.as_non_null)", async () => {
  const e = await inst(`
    struct Node { i32 v; }
    export Node? mkNode(i32 v) { return Node { v: v }; }
    export i32 unwrapped(Node? n) { return n!.v; }
  `);
  const n = e.mkNode(77);
  eq(e.unwrapped(n), 77, "unwrap n.v");
});

// ── i64 arithmetic ─────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: i64 arithmetic", async () => {
  const e = await inst(`
    export i64 i64add(i64 a, i64 b) { return a + b; }
    export i64 i64sub(i64 a, i64 b) { return a - b; }
    export i64 i64mul(i64 a, i64 b) { return a * b; }
    export i64 i64neg(i64 a) { return -a; }
    export i64 i64not(i64 a) { return ~a; }
    export i64 i64inc(i64 a) { a++; return a; }
    export i32 i64eq(i64 a, i64 b) { return a == b ? 1 : 0; }
  `);
  eq(e.i64add(10n, 5n), 15n, "i64add");
  eq(e.i64sub(10n, 3n), 7n, "i64sub");
  eq(e.i64mul(6n, 7n), 42n, "i64mul");
  eq(e.i64neg(5n), -5n, "i64neg");
  eq(e.i64not(0n), -1n, "i64not");
  eq(e.i64inc(9n), 10n, "i64inc");
  eq(e.i64eq(5n, 5n), 1, "i64eq true");
  eq(e.i64eq(5n, 6n), 0, "i64eq false");
});

Deno.test("wasmBuildBin: i64 comparison ops", async () => {
  const e = await inst(`
    export i32 i64lt(i64 a, i64 b) { return a < b ? 1 : 0; }
    export i32 i64gt(i64 a, i64 b) { return a > b ? 1 : 0; }
    export i32 i64le(i64 a, i64 b) { return a <= b ? 1 : 0; }
    export i32 i64ne(i64 a, i64 b) { return a != b ? 1 : 0; }
  `);
  eq(e.i64lt(5n, 10n), 1, "i64lt true");
  eq(e.i64lt(10n, 5n), 0, "i64lt false");
  eq(e.i64gt(10n, 5n), 1, "i64gt true");
  eq(e.i64le(5n, 5n), 1, "i64le equal");
  eq(e.i64ne(5n, 6n), 1, "i64ne true");
});

// ── f64 / f32 arithmetic ───────────────────────────────────────────────────────

Deno.test("wasmBuildBin: f64 arithmetic", async () => {
  const e = await inst(`
    export f64 f64add(f64 a, f64 b) { return a + b; }
    export f64 f64sub(f64 a, f64 b) { return a - b; }
    export f64 f64mul(f64 a, f64 b) { return a * b; }
    export f64 f64div(f64 a, f64 b) { return a / b; }
    export f64 f64neg(f64 a) { return -a; }
    export i32 f64lt(f64 a, f64 b) { return a < b ? 1 : 0; }
    export i32 f64eq(f64 a, f64 b) { return a == b ? 1 : 0; }
    export f64 litAdd(f64 a) { return 1.5 + a; }
  `);
  eq(e.f64add(1.5, 2.5), 4.0, "f64add");
  eq(e.f64sub(5.0, 1.5), 3.5, "f64sub");
  eq(e.f64mul(2.0, 3.0), 6.0, "f64mul");
  eq(e.f64div(7.0, 2.0), 3.5, "f64div");
  eq(e.f64neg(2.5), -2.5, "f64neg");
  eq(e.f64lt(1.0, 2.0), 1, "f64lt true");
  eq(e.f64lt(3.0, 2.0), 0, "f64lt false");
  eq(e.f64eq(3.0, 3.0), 1, "f64eq true");
  eq(e.litAdd(0.5), 2.0, "litAdd 1.5+0.5");
});

Deno.test("wasmBuildBin: f32 arithmetic", async () => {
  const e = await inst(`
    export f32 f32add(f32 a, f32 b) { return a + b; }
    export f32 f32mul(f32 a, f32 b) { return a * b; }
    export f32 f32neg(f32 a) { return -a; }
    export i32 f32lt(f32 a, f32 b) { return a < b ? 1 : 0; }
    export i32 f32eq(f32 a, f32 b) { return a == b ? 1 : 0; }
  `);
  // f32 values round-trip through JS as f64
  const close = (a: unknown, b: number, msg: string) => {
    if (Math.abs((a as number) - b) > 0.001) throw new Error(`${msg}: got ${a}, expected ~${b}`);
  };
  close(e.f32add(1.5, 2.5), 4.0, "f32add");
  close(e.f32mul(2.0, 3.0), 6.0, "f32mul");
  close(e.f32neg(2.5), -2.5, "f32neg");
  eq(e.f32lt(1.0, 2.0), 1, "f32lt true");
  eq(e.f32eq(3.0, 3.0), 1, "f32eq true");
});

// ── Numeric casts ─────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: numeric casts", async () => {
  const e = await inst(`
    export i64 i32toI64(i32 a) { return a as i64; }
    export i32 i64toI32(i64 a) { return a as! i32; }
    export f64 i32toF64(i32 a) { return a as f64; }
    export i32 f64toI32(f64 a) { return a as! i32; }
    export f64 f32toF64(f32 a) { return a as f64; }
    export f32 f64toF32(f64 a) { return a as~ f32; }
    export i32 f32toI32(f32 a) { return a as! i32; }
    export i32 f64satToI32(f64 a) { return a as~ i32; }
  `);
  eq(e.i32toI64(42), 42n, "i32toI64");
  eq(e.i64toI32(100n), 100, "i64toI32");
  eq(e.i32toF64(7), 7.0, "i32toF64");
  eq(e.f64toI32(3.9), 3, "f64toI32 truncate");
  const close = (a: unknown, b: number, msg: string) => {
    if (Math.abs((a as number) - b) > 0.01) throw new Error(`${msg}: got ${a}, expected ~${b}`);
  };
  close(e.f32toF64(1.5), 1.5, "f32toF64");
  close(e.f64toF32(2.5), 2.5, "f64toF32");
  eq(e.f32toI32(3.7), 3, "f32toI32");
  eq(e.f64satToI32(4.9), 4, "f64satToI32");
});

// ── Packed array types (i8/i16) ────────────────────────────────────────────────

Deno.test("wasmBuildBin: i8 packed array", async () => {
  const e = await inst(`
    export i8[] mkBytes(i32 n) { return i8[n](); }
    export void setByte(i8[] arr, i32 idx, i32 val) { arr[idx] = val; }
    export i32 getByte(i8[] arr, i32 idx) { return arr[idx]; }
    export i32 lenBytes(i8[] arr) { return arr.len(); }
  `);
  const arr = e.mkBytes(5);
  e.setByte(arr, 0, 42);
  e.setByte(arr, 4, 99);
  eq(e.getByte(arr, 0), 42, "byte[0]=42");
  eq(e.getByte(arr, 1), 0, "byte[1] default 0");
  eq(e.getByte(arr, 4), 99, "byte[4]=99");
  eq(e.lenBytes(arr), 5, "len=5");
});

Deno.test("wasmBuildBin: i16 packed array", async () => {
  const e = await inst(`
    export i16[] mkShorts(i32 n) { return i16[n](); }
    export void setShort(i16[] arr, i32 idx, i32 val) { arr[idx] = val; }
    export i32 getShort(i16[] arr, i32 idx) { return arr[idx]; }
  `);
  const arr = e.mkShorts(3);
  e.setShort(arr, 1, 1000);
  eq(e.getShort(arr, 1), 1000, "short[1]=1000");
});

// ── Struct array ───────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: array of structs (nullable)", async () => {
  // Uses nullable struct array (Item?[]) since non-nullable struct has no default value
  const e = await inst(`
    struct Item { i32 v; }
    export Item?[] mkItems(i32 n) { return Item?[n](); }
    export void setItem2(Item?[] arr, i32 idx, Item it) { arr[idx] = it; }
    export Item getItem2(Item?[] arr, i32 idx) { return arr[idx]!; }
    export Item mkItem(i32 v) { return Item { v: v }; }
    export i32 itemV(Item it) { return it.v; }
    export i32 lenItems(Item?[] arr) { return arr.len(); }
  `);
  const arr = e.mkItems(3);
  const item = e.mkItem(77);
  e.setItem2(arr, 1, item);
  const retrieved = e.getItem2(arr, 1);
  eq(e.itemV(retrieved as NonNullable<unknown>), 77, "items[1].v=77");
  eq(e.lenItems(arr), 3, "len=3");
});

// ── String features ────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: string escape sequences", async () => {
  const e = await inst(`
    export string newline() { return "line1\\nline2"; }
    export string tab() { return "a\\tb"; }
    export i32 nlLen(string s) { return s.len(); }
  `);
  const nl = e.newline();
  const tb = e.tab();
  // "line1\nline2" = 11 chars, "a\tb" = 3 chars
  eq(e.nlLen(nl), 11, "newline string len");
  eq(e.nlLen(tb), 3, "tab string len");
});

Deno.test("wasmBuildBin: long string (uleb continuation for length>=128)", async () => {
  // A 128-char string triggers the uleb continuation bit in string encoding
  const str128 = "a".repeat(128);
  const e = await inst(`
    export i32 longLen() { return "${str128}".len(); }
    export string longStr() { return "${str128}"; }
  `);
  eq(e.longLen(), 128, "long string len=128");
  const s = e.longStr();
  eq(e.longLen(), 128, "long string round-trip");
});

Deno.test("wasmBuildBin: string nullable", async () => {
  const e = await inst(`
    export string? mkNullStr() { return null; }
    export string? mkStr(string s) { return s; }
    export i32 strIsNull(string? s) { return s is null ? 1 : 0; }
    export i32 litLen() { return "hello world".len(); }
  `);
  const ns = e.mkNullStr();
  eq(e.strIsNull(ns), 1, "null string is null");
  eq(e.litLen(), 11, "inline literal len");
});

// ── Funcref as local variable ──────────────────────────────────────────────────

Deno.test("wasmBuildBin: funcref local variable", async () => {
  const e = await inst(`
    i32 triple(i32 x) { return x * 3; }
    export i32 callViaLocal(i32 x) {
      fn[i32(i32)] f = triple;
      return f(x);
    }
  `);
  eq(e.callViaLocal(4), 12, "triple via local funcref");
  eq(e.callViaLocal(7), 21, "triple via local funcref 7");
});

// ── For-loop without update ────────────────────────────────────────────────────

Deno.test("wasmBuildBin: for loop without update expression", async () => {
  const e = await inst(`
    export i32 sumNoUpdate(i32 n) {
      i32 acc = 0;
      for (i32 i = 0; i < n;) {
        acc = acc + i;
        i++;
      }
      return acc;
    }
  `);
  // 0+1+2+3+4 = 10
  eq(e.sumNoUpdate(5), 10, "sumNoUpdate(5)=10");
  eq(e.sumNoUpdate(1), 0, "sumNoUpdate(1)=0");
});

// ── Struct field and array element ++ ─────────────────────────────────────────

Deno.test("wasmBuildBin: struct field ++ and --", async () => {
  const e = await inst(`
    struct Counter2 { i32 n; }
    export Counter2 mkC2(i32 n) { return Counter2 { n: n }; }
    export Counter2 incC2(Counter2 c) { c.n++; return c; }
    export Counter2 decC2(Counter2 c) { c.n--; return c; }
    export i32 getN(Counter2 c) { return c.n; }
  `);
  let c = e.mkC2(5);
  c = e.incC2(c);
  c = e.incC2(c);
  eq(e.getN(c), 7, "field ++ twice");
  c = e.decC2(c);
  eq(e.getN(c), 6, "field -- once");
});

Deno.test("wasmBuildBin: array element ++ and --", async () => {
  const e = await inst(`
    export i32[] mkArr3() { return i32[](10, 20, 30); }
    export void incrElem2(i32[] arr, i32 idx) { arr[idx]++; }
    export void decrElem2(i32[] arr, i32 idx) { arr[idx]--; }
    export i32 getElem2(i32[] arr, i32 idx) { return arr[idx]; }
  `);
  const arr = e.mkArr3();
  e.incrElem2(arr, 1);
  e.incrElem2(arr, 1);
  eq(e.getElem2(arr, 1), 22, "elem[1]++ twice");
  e.decrElem2(arr, 0);
  eq(e.getElem2(arr, 0), 9, "elem[0]-- once");
});

// ── Expression as statement (drop) ────────────────────────────────────────────

Deno.test("wasmBuildBin: non-void expr as statement drops result", async () => {
  const e = await inst(`
    i32 side(i32 x) { return x + 1; }
    export i32 withDrop(i32 x) {
      side(x);
      return x * 2;
    }
  `);
  eq(e.withDrop(5), 10, "withDrop: side result dropped");
});

// ── `not` keyword and `is` expr ───────────────────────────────────────────────

Deno.test("wasmBuildBin: logical not operator", async () => {
  const e = await inst(`
    export i32 notTest(i32 a) { return !a ? 1 : 0; }
    export i32 andOr(i32 a, i32 b) { return (a && b) || (!a && !b) ? 1 : 0; }
  `);
  eq(e.notTest(0), 1, "!0 = 1");
  eq(e.notTest(5), 0, "!5 = 0");
  eq(e.andOr(1, 1), 1, "both true");
  eq(e.andOr(0, 0), 1, "both false");
  eq(e.andOr(1, 0), 0, "mixed");
});

Deno.test("wasmBuildBin: is-expr (ref.eq comparison)", async () => {
  const e = await inst(`
    struct Tag2 { i32 t; }
    export Tag2 mkTag2(i32 t) { return Tag2 { t: t }; }
    export i32 sameRef(Tag2 a, Tag2 b) { return a is (b) ? 1 : 0; }
  `);
  const t1 = e.mkTag2(1);
  const t2 = e.mkTag2(2);
  eq(e.sameRef(t1, t1), 1, "same ref is same");
  eq(e.sameRef(t1, t2), 0, "diff refs not same");
});

// ── Bool literal in expression ─────────────────────────────────────────────────

Deno.test("wasmBuildBin: bool literal in binary expr", async () => {
  const e = await inst(`
    export i32 boolLit() { return true == false ? 0 : 1; }
    export i32 boolEq() { return true == true ? 1 : 0; }
  `);
  eq(e.boolLit(), 1, "true != false");
  eq(e.boolEq(), 1, "true == true");
});

// ── Null literal in comparison ─────────────────────────────────────────────────

Deno.test("wasmBuildBin: null literal as binary operand", async () => {
  const e = await inst(`
    struct N2 { i32 v; }
    export i32 nullEq(N2? a) { return null == a ? 1 : 0; }
  `);
  const n = e.nullEq(null);
  eq(n, 1, "null == null");
});

// ── Struct positional construction ────────────────────────────────────────────

Deno.test("wasmBuildBin: struct positional construction", async () => {
  const e = await inst(`
    struct Pos { i32 x; i32 y; }
    export Pos mkPosPos(i32 x, i32 y) { return Pos(x, y); }
    export i32 posX(Pos p) { return p.x; }
    export i32 posY(Pos p) { return p.y; }
  `);
  const p = e.mkPosPos(3, 7);
  eq(e.posX(p), 3, "pos.x=3");
  eq(e.posY(p), 7, "pos.y=7");
});

// ── Zero-size array ────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: zero-size array (arrNew size=null)", async () => {
  const e = await inst(`
    export i32[] mkEmpty() { return i32[](); }
    export i32 emptyLen(i32[] arr) { return arr.len(); }
  `);
  const arr = e.mkEmpty();
  eq(e.emptyLen(arr), 0, "empty arr len=0");
});

// ── Struct-only program (buildElemSection n=0) ─────────────────────────────────

Deno.test("wasmBuildBin: struct type only (no functions, empty elem section)", () => {
  // A program with only struct definitions and no functions should compile to valid wasm
  // This exercises the buildElemSection n=0 early return path
  const bytes = compile(`struct EmptyProg { i32 x; }`);
  // Valid wasm magic
  eq(bytes[0], 0x00, "magic[0]");
  eq(bytes[1], 0x61, "magic[1]");
  // Should be small but valid
  if (bytes.length < 8) throw new Error("too small");
});

// ── ternary with struct result ─────────────────────────────────────────────────

Deno.test("wasmBuildBin: ternary with struct result type", async () => {
  const e = await inst(`
    struct Opt { i32 v; }
    export Opt mkOpt(i32 v) { return Opt { v: v }; }
    export i32 ternaryStruct(i32 cond, Opt a, Opt b) {
      return (cond != 0 ? a : b).v;
    }
  `);
  const a = e.mkOpt(10);
  const b = e.mkOpt(20);
  eq(e.ternaryStruct(1, a, b), 10, "ternary picks a");
  eq(e.ternaryStruct(0, a, b), 20, "ternary picks b");
});

// ── Switch statement ───────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: switch statement", async () => {
  const e = await inst(`
    export i32 classify(i32 n) {
      switch (n) {
        case 0: { return 0; }
        case 1: { return 1; }
        default: { return -1; }
      }
    }
    export i32 switchBreak(i32 n) {
      i32 r = 0;
      switch (n) {
        case 5: { r = 10; break; }
        default: { r = 99; break; }
      }
      return r;
    }
  `);
  eq(e.classify(0), 0, "switch case 0");
  eq(e.classify(1), 1, "switch case 1");
  eq(e.classify(99), -1, "switch default");
  eq(e.switchBreak(5), 10, "switch break case");
  eq(e.switchBreak(3), 99, "switch break default");
});

// ── Struct methods ─────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: struct instance methods", async () => {
  const e = await inst(`
    struct Cnt {
      i32 n;
      void inc(this) { this.n++; }
      void add(this, i32 x) { this.n += x; }
      i32 get(const this) { return this.n; }
      Cnt create(i32 n) { return Cnt { n: n }; }
    }
    export Cnt mkCnt(i32 n) { return Cnt { n: n }; }
    export Cnt incCnt(Cnt c) { c.inc(); return c; }
    export Cnt addCnt(Cnt c, i32 x) { c.add(x); return c; }
    export i32 getCnt(Cnt c) { return c.get(); }
    export Cnt createCnt(i32 n) { return Cnt.create(n); }
  `);
  let c = e.mkCnt(5);
  c = e.incCnt(c);
  eq(e.getCnt(c), 6, "inc -> 6");
  c = e.addCnt(c, 4);
  eq(e.getCnt(c), 10, "add 4 -> 10");
  const c2 = e.createCnt(42);
  eq(e.getCnt(c2), 42, "create 42");
});

// ── Reference casts ────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: ref upcast (as) and downcast (as!)", async () => {
  const e = await inst(`
    struct BoxI { i32 v; }
    export BoxI mkBox(i32 v) { return BoxI { v: v }; }
    export anyref toAny(BoxI b) { return b as anyref; }
    export BoxI fromAny(anyref r) { return r as! BoxI; }
    export i32 getV(BoxI b) { return b.v; }
    export i32 isBox(anyref r) { return r is BoxI ? 1 : 0; }
  `);
  const b = e.mkBox(77);
  const r = e.toAny(b as never);
  eq(e.isBox(r as never), 1, "is BoxI");
  const b2 = e.fromAny(r as never);
  eq(e.getV(b2 as never), 77, "downcast v=77");
});

Deno.test("wasmBuildBin: i31ref casts", async () => {
  const e = await inst(`
    export i32 roundtrip(i32 x) { return (x as! i31ref) as! i32; }
    export i32 i31andBack(i32 x) { i31ref r = x as! i31ref; return r as! i32; }
  `);
  eq(e.roundtrip(42), 42, "i31ref roundtrip 42");
  eq(e.roundtrip(0), 0, "i31ref roundtrip 0");
  eq(e.i31andBack(100), 100, "i31ref local roundtrip");
});

// ── Reference equality ─────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: ref != null comparison", async () => {
  const e = await inst(`
    struct N3 { i32 v; }
    export i32 notNull(N3? a) { return a != null ? 1 : 0; }
    export i32 equalsNull(N3? a) { return a == null ? 1 : 0; }
    export N3 mkN3(i32 v) { return N3 { v: v }; }
  `);
  const n = e.mkN3(1);
  eq(e.notNull(null), 0, "null != null is false");
  eq(e.notNull(n), 1, "struct != null is true");
  eq(e.equalsNull(null), 1, "null == null");
  eq(e.equalsNull(n), 0, "struct == null is false");
});

// ── do-while loop ──────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: do-while loop", async () => {
  const e = await inst(`
    export i32 doCount(i32 n) {
      i32 acc = 0;
      do { acc++; n--; } while (n > 0);
      return acc;
    }
  `);
  eq(e.doCount(3), 3, "doCount(3)=3");
  eq(e.doCount(1), 1, "doCount(1)=1");
});

// ── Struct with funcref field ──────────────────────────────────────────────────

Deno.test("wasmBuildBin: struct with funcref field", async () => {
  const e = await inst(`
    i32 dbl(i32 x) { return x * 2; }
    struct FnHolder { fn[i32(i32)] cb; }
    export FnHolder mkHolder() { return FnHolder { cb: dbl }; }
    export i32 callHolder(FnHolder h, i32 x) { return h.cb(x); }
  `);
  const h = e.mkHolder();
  eq(e.callHolder(h, 5), 10, "funcref field call 5*2=10");
  eq(e.callHolder(h, 7), 14, "funcref field call 7*2=14");
});

// ── More numeric casts ─────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: extended numeric casts", async () => {
  const e = await inst(`
    export i64 boolToI64(bool b) { return b as i64; }
    export f64 i64ToF64(i64 a) { return a as f64; }
    export i64 f64ToI64(f64 a) { return a as! i64; }
    export f32 i32ToF32(i32 a) { return a as f32; }
    export i64 f32ToI64(f32 a) { return a as! i64; }
    export i32 i64SatI32(i64 a) { return a as~ i32; }
    export f64 i64AsF64sat(i64 a) { return a as~ f64; }
    export f32 i32AsF32sat(i32 a) { return a as~ f32; }
    export i32 boolToI32(bool b) { return b as i32; }
  `);
  eq(e.boolToI64(true), 1n, "bool->i64");
  eq(e.boolToI64(false), 0n, "false->i64=0");
  eq(e.i64ToF64(5n), 5.0, "i64->f64");
  eq(e.f64ToI64(3.9), 3n, "f64->i64 trunc");
  eq(e.i64SatI32(100n), 100, "i64 sat->i32");
  eq(e.i64AsF64sat(7n), 7.0, "i64 sat->f64");
  eq(e.boolToI32(true), 1, "bool->i32");
  eq(e.boolToI32(false), 0, "false->i32");
  const close = (a: unknown, b: number, msg: string) => {
    if (Math.abs((a as number) - b) > 0.01) throw new Error(`${msg}: got ${a} expected ${b}`);
  };
  close(e.i32ToF32(7), 7.0, "i32->f32");
  close(e.i32AsF32sat(7), 7.0, "i32 sat->f32");
  eq(e.f32ToI64(3.0), 3n, "f32->i64");
});

// ── Const struct field ─────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: const (immutable) struct field", async () => {
  const e = await inst(`
    struct Pair { const i32 a; const i32 b; }
    export Pair mkPair(i32 a, i32 b) { return Pair { a: a, b: b }; }
    export i32 pairSum(Pair p) { return p.a + p.b; }
  `);
  const p = e.mkPair(3, 7);
  eq(e.pairSum(p), 10, "3+7=10");
});

// ── UTF-8 string encoding ──────────────────────────────────────────────────────

Deno.test("wasmBuildBin: UTF-8 non-ASCII string", async () => {
  const e = await inst(`
    export string getAccent() { return "caf\u00E9"; }
    export string getCjk() { return "\u4e2d\u6587"; }
    export string getEmoji() { return "\uD83D\uDE00"; }
    export i32 accentLen(string s) { return s.len(); }
  `);
  // "café" = 5 UTF-8 bytes (c=1, a=1, f=1, é=2)
  // "中文" = 6 UTF-8 bytes (each CJK char = 3 bytes)
  // "😀" = 4 UTF-8 bytes
  const accent = e.getAccent();
  const cjk = e.getCjk();
  const emoji = e.getEmoji();
  eq(e.accentLen(accent), 5, "café=5 bytes");
  eq(e.accentLen(cjk), 6, "中文=6 bytes");
  eq(e.accentLen(emoji), 4, "emoji=4 bytes");
});

// ── Nested array type (compile-only, covers addType recursion) ─────────────────

Deno.test("wasmBuildBin: nested array type registration", () => {
  // i32[][] requires element type i32[] to be registered, triggering addType recursion
  const bytes = compile(`export i32 matRows(i32[][] m) { return m.len(); }`);
  eq(bytes[0], 0x00, "valid wasm magic");
  eq(bytes[1], 0x61, "valid wasm magic[1]");
});

// ── as@ raw cast ───────────────────────────────────────────────────────────────

Deno.test("wasmBuildBin: as@ raw casts", async () => {
  const e = await inst(`
    export i32 i64Raw(i64 a) { return a as@ i32; }
    export i32 f64Raw(f64 a) { return a as@ i32; }
    export i32 f32Raw(f32 a) { return a as@ i32; }
    export f32 f64ToF32Raw(f64 a) { return a as@ f32; }
  `);
  // i64 as@ i32: takes low 32 bits
  eq(e.i64Raw(5n), 5, "i64 raw->i32");
  // f64 raw: reinterpret bits as i32 (first 32 bits of double)
  // Just check it doesn't crash
  const r = e.f64Raw(0.0);
  if (typeof r !== "number") throw new Error("expected number");
});

// ── String unknown escape ──────────────────────────────────────────────────────

Deno.test("wasmBuildBin: string unknown escape sequence", async () => {
  // \q is not a known escape, uses charCodeAt fallback
  const e = await inst(`
    export i32 unknownEsc() { return "\\q".len(); }
    export string getUnknown() { return "\\q"; }
  `);
  // \q → 'q' char = 1 byte
  eq(e.unknownEsc(), 1, "unknown escape \\q = 1 byte");
});

// ── anyref? nullable return ────────────────────────────────────────────────────

Deno.test("wasmBuildBin: anyref nullable return and param", async () => {
  const e = await inst(`
    export anyref? mkNullAny() { return null; }
    export i32 isNullAny(anyref? r) { return r is null ? 1 : 0; }
  `);
  const n = e.mkNullAny();
  eq(e.isNullAny(n), 1, "anyref? null is null");
});

// ── i31ref? nullable return ────────────────────────────────────────────────────

Deno.test("wasmBuildBin: i31ref nullable return", async () => {
  const e = await inst(`
    export i31ref? mkNullI31() { return null; }
    export i32 isNullI31(i31ref? r) { return r is null ? 1 : 0; }
  `);
  const n = e.mkNullI31();
  eq(e.isNullI31(n), 1, "i31ref? null is null");
});

// ── funcref? nullable return ───────────────────────────────────────────────────

Deno.test("wasmBuildBin: funcref nullable return", async () => {
  const e = await inst(`
    i32 dblFn(i32 x) { return x * 2; }
    export fn[i32(i32)]? mkNullFn(i32 cond) {
      if (cond != 0) { return dblFn; }
      return null;
    }
    export i32 isFnNull(fn[i32(i32)]? f) { return f is null ? 1 : 0; }
  `);
  const nf = e.mkNullFn(0);
  eq(e.isFnNull(nf), 1, "fn? null is null");
  const ff = e.mkNullFn(1);
  eq(e.isFnNull(ff), 0, "fn? non-null is not null");
});

// ── nested struct field compound assign ───────────────────────────────────────

Deno.test("wasmBuildBin: nested struct field compound assign", async () => {
  const e = await inst(`
    struct InnerS { i32 v; }
    struct OuterS { InnerS inner; }
    export OuterS mkOuter(i32 v) { return OuterS { inner: InnerS { v: v } }; }
    export OuterS addInner(OuterS o, i32 dx) { o.inner.v += dx; return o; }
    export i32 getInnerV(OuterS o) { return o.inner.v; }
  `);
  const o = e.mkOuter(10);
  const o2 = e.addInner(o, 5);
  eq(e.getInnerV(o2), 15, "nested field += 5 → 15");
});

// ── 2D array element compound assign ──────────────────────────────────────────

Deno.test("wasmBuildBin: 2D array element compound assign", async () => {
  const e = await inst(`
    export i32[][] mk2d() { return i32[][](i32[](1, 2), i32[](3, 4)); }
    export void add2d(i32[][] m, i32 r, i32 c, i32 v) { m[r][c] += v; }
    export i32 get2d(i32[][] m, i32 r, i32 c) { return m[r][c]; }
  `);
  const m = e.mk2d();
  e.add2d(m, 0, 1, 10);
  eq(e.get2d(m, 0, 1), 12, "m[0][1] += 10 → 12");
  e.add2d(m, 1, 0, 7);
  eq(e.get2d(m, 1, 0), 10, "m[1][0] += 7 → 10");
});

// ── switch on i64 and f64 ─────────────────────────────────────────────────────

Deno.test("wasmBuildBin: switch on i64 value", async () => {
  const e = await inst(`
    export i32 switchI64(i64 n) {
      switch (n) {
        case 1: { return 10; }
        case 2: { return 20; }
        default: { return -1; }
      }
    }
  `);
  eq(e.switchI64(1n), 10, "i64 case 1");
  eq(e.switchI64(2n), 20, "i64 case 2");
  eq(e.switchI64(99n), -1, "i64 default");
});

Deno.test("wasmBuildBin: switch on f64 value", async () => {
  const e = await inst(`
    export i32 switchF64(f64 x) {
      switch (x) {
        case 1.0: { return 10; }
        case 2.0: { return 20; }
        default: { return -1; }
      }
    }
  `);
  eq(e.switchF64(1.0), 10, "f64 case 1.0");
  eq(e.switchF64(2.0), 20, "f64 case 2.0");
  eq(e.switchF64(3.0), -1, "f64 default");
});

// ── ternary selecting function idents (typeOfExpr ident for func name) ────────

Deno.test("wasmBuildBin: ternary selecting function idents", async () => {
  const e = await inst(`
    i32 fnA(i32 x) { return x * 2; }
    i32 fnB(i32 x) { return x * 3; }
    export i32 selectAndCall(i32 useA, i32 x) {
      fn[i32(i32)] f = useA != 0 ? fnA : fnB;
      return f(x);
    }
  `);
  eq(e.selectAndCall(1, 4), 8, "useA=1 → fnA(4)=8");
  eq(e.selectAndCall(0, 4), 12, "useA=0 → fnB(4)=12");
});

// ── typeOfExpr binary/is/unary in ternary branches ───────────────────────────

Deno.test("wasmBuildBin: typeOfExpr binary in ternary then-branch", async () => {
  const e = await inst(`
    export i32 cmpTernary(i32 a, i32 b) {
      return (a > 0 ? a == b : a != b) ? 1 : 0;
    }
    export i32 notTernary(i32 a, i32 b) {
      i32 r = a > 0 ? !a : !b;
      return r;
    }
  `);
  eq(e.cmpTernary(1, 1), 1, "a>0: a==b: 1==1 → true → outer picks 1");
  eq(e.cmpTernary(1, 2), 0, "a>0: a==b: 1==2 → false → outer picks 0");
  eq(e.cmpTernary(0, 1), 1, "a=0: a!=b: 0!=1 → true → outer picks 1");
  eq(e.notTernary(1, 0), 0, "a>0: !a = !1 = 0");
  eq(e.notTernary(0, 0), 1, "a=0: !b = !0 = 1");
});

Deno.test("wasmBuildBin: typeOfExpr is-expr in ternary then-branch", async () => {
  const e = await inst(`
    struct Tag4 { i32 v; }
    export i32 isTernary(Tag4? r, i32 x) {
      return (x > 0 ? r is null : x > 5) ? 1 : 0;
    }
  `);
  eq(e.isTernary(null, 1), 1, "x>0: r is null (null) → true");
  eq(e.isTernary(null, -1), 0, "x<=0: x>5 = false → 0");
});

// ── struct with unique funcref field signature ────────────────────────────────

Deno.test("wasmBuildBin: struct with unique funcref field sig (scanFuncref)", () => {
  // fn[void(i32,i32)] has no matching function sig — triggers scanFuncref line 334
  const bytes = compile(`
    struct EvtSys { fn[void(i32,i32)]? onEvent; }
    export i32 compileOnly() { return 42; }
  `);
  eq(bytes[0], 0x00, "valid wasm");
});

// ── f32 fixed array literal (f32.const via expectType) ───────────────────────

Deno.test("wasmBuildBin: f32 fixed array literal", async () => {
  const e = await inst(`
    export f32[] mkF32s() { return f32[](1.5, 2.5, 3.5); }
    export f32 sumF32s(f32[] arr) { return arr[0] + arr[1] + arr[2]; }
  `);
  const close = (a: unknown, b: number, msg: string) => {
    if (Math.abs((a as number) - b) > 0.01) throw new Error(`${msg}: got ${a}, expected ~${b}`);
  };
  const arr = e.mkF32s();
  close(e.sumF32s(arr), 7.5, "1.5+2.5+3.5=7.5");
});

// ── switch on f32 (f32.eq opcode in emitEqForType) ───────────────────────────

Deno.test("wasmBuildBin: switch on f32 value", async () => {
  const e = await inst(`
    export i32 switchF32(f32 x) {
      switch (x) {
        case 1.0: { return 10; }
        case 2.0: { return 20; }
        default: { return -1; }
      }
    }
  `);
  eq(e.switchF32(1.0), 10, "f32 case 1.0");
  eq(e.switchF32(2.0), 20, "f32 case 2.0");
  eq(e.switchF32(3.0), -1, "f32 default");
});

// ── i31ref lossless as i32 ────────────────────────────────────────────────────

Deno.test("wasmBuildBin: i31ref lossless as i32 (i31.get_s)", async () => {
  const e = await inst(`
    export i32 i31AsI32(i32 x) {
      i31ref r = x as! i31ref;
      return r as i32;
    }
  `);
  eq(e.i31AsI32(42), 42, "i31ref as i32 = 42");
  eq(e.i31AsI32(0), 0, "i31ref as i32 = 0");
});

// ── same-type cast no-op ──────────────────────────────────────────────────────

Deno.test("wasmBuildBin: same-type cast is no-op", async () => {
  const e = await inst(`
    export i32 i32AsI32(i32 x) { return x as i32; }
    export f64 f64AsF64(f64 x) { return x as f64; }
  `);
  eq(e.i32AsI32(42), 42, "i32 as i32 = 42");
  eq(e.f64AsF64(3.14), 3.14, "f64 as f64 = 3.14");
});

// ── f32 sat cast to i32 ───────────────────────────────────────────────────────

Deno.test("wasmBuildBin: f32 as~ i32 (trunc_sat)", async () => {
  const e = await inst(`
    export i32 f32SatI32(f32 a) { return a as~ i32; }
  `);
  eq(e.f32SatI32(3.7), 3, "f32 3.7 sat→i32 = 3");
  eq(e.f32SatI32(0.0), 0, "f32 0.0 sat→i32 = 0");
});

// ── method reference as funcref value ────────────────────────────────────────

Deno.test("wasmBuildBin: method reference as funcref value", async () => {
  const e = await inst(`
    struct MR { i32 n; i32 get(const this) { return this.n; } }
    export MR mkMR(i32 n) { return MR { n: n }; }
    export i32 callViaRef(MR m) {
      fn[i32(MR)] f = MR.get;
      return f(m);
    }
  `);
  const m = e.mkMR(77);
  eq(e.callViaRef(m), 77, "method ref call → 77");
});

// ── typeOfExpr construct local funcref and field method ref ───────────────────

Deno.test("wasmBuildBin: typeOfExpr struct construct in ternary (line 247)", async () => {
  const e = await inst(`
    struct Box2 { i32 v; }
    export i32 ternaryConstruct(i32 cond) {
      return (cond != 0 ? Box2 { v: 10 } : Box2 { v: 20 }).v;
    }
    export i32[] ternaryArrNew(i32 cond) {
      return cond != 0 ? i32[](1, 2) : i32[](3, 4);
    }
    export i32 getArrElem(i32[] arr, i32 i) { return arr[i]; }
  `);
  eq(e.ternaryConstruct(1), 10, "cond=1 → Box2{v:10}.v=10");
  eq(e.ternaryConstruct(0), 20, "cond=0 → Box2{v:20}.v=20");
  const arr1 = e.ternaryArrNew(1);
  const arr0 = e.ternaryArrNew(0);
  eq(e.getArrElem(arr1, 0), 1, "cond=1 → [1,2][0]=1");
  eq(e.getArrElem(arr0, 0), 3, "cond=0 → [3,4][0]=3");
});

Deno.test("wasmBuildBin: typeOfExpr local funcref call as expr stmt", async () => {
  const e = await inst(`
    i32 triple2(i32 x) { return x * 3; }
    export i32 localFnExprStmt(i32 x) {
      fn[i32(i32)] f = triple2;
      f(x);          // expr stmt: typeOfExpr(construct f) called to check if void
      return f(x);
    }
  `);
  eq(e.localFnExprStmt(4), 12, "triple2 via local funcref = 12");
});

Deno.test("wasmBuildBin: typeOfExpr method ref field as expr stmt", async () => {
  const e = await inst(`
    struct MR2 { i32 n; i32 getN(const this) { return this.n; } }
    export MR2 mkMR2(i32 n) { return MR2 { n: n }; }
    export i32 methodExprStmt(MR2 m) {
      MR2.getN;  // method ref as expr stmt: typeOfExpr(field MR2.getN) to get funcref type
      return m.getN();
    }
  `);
  const m = e.mkMR2(55);
  eq(e.methodExprStmt(m), 55, "method via expr stmt = 55");
});

// ── null without expectType (ref.null anyref fallback) ────────────────────────

Deno.test("wasmBuildBin: null in ternary else without expectType", async () => {
  const e = await inst(`
    export anyref? pickNull(i32 cond, anyref? r) {
      return cond != 0 ? r : null;
    }
    export i32 isNull2(anyref? r) { return r is null ? 1 : 0; }
  `);
  eq(e.pickNull(0, null), null, "cond=0 → null");
  eq(e.isNull2(e.pickNull(0, null)), 1, "picked null → is null");
});

// ── nullable array of arrays (addType nullable inner) ────────────────────────

Deno.test("wasmBuildBin: nullable-array-of-arrays type (addType coverage)", () => {
  // i32[]?[] = array of nullable-i32-arrays, triggers addType nullable inner
  const bytes = compile(`export i32 nullArrLen(i32[]?[] m) { return m.len(); }`);
  eq(bytes[0], 0x00, "valid wasm");
});

// ── string? nullable type (wasmNullable prim string, heapTypeBytes string) ────

Deno.test("wasmBuildBin: string? nullable return and null init", async () => {
  const e = await inst(`
    export string? maybeStr(i32 x) {
      string? s = null;
      if (x != 0) { s = "hello"; }
      return s;
    }
    export i32 strOrZero(string? s) {
      return s is null ? 0 : s!.len();
    }
  `);
  eq(e.strOrZero(e.maybeStr(0)), 0, "null → 0");
  eq(e.strOrZero(e.maybeStr(1)), 5, "\"hello\".len() = 5");
});

// ── static method call (emitCall TypeName.method path) ───────────────────────

Deno.test("wasmBuildBin: static method call via TypeName.method", async () => {
  const e = await inst(`
    struct Calc { i32 x; i32 sum(i32 a, i32 b) { return a + b; } }
    export i32 staticAdd(i32 a, i32 b) { return Calc.sum(a, b); }
  `);
  eq(e.staticAdd(3, 4), 7, "static add 3+4=7");
});

// ── ref.cast downcast struct (emitCast as! struct path) ───────────────────────

Deno.test("wasmBuildBin: ref.cast downcast anyref to struct", async () => {
  const e = await inst(`
    struct Box3 { i32 v; }
    export Box3 mkBox3(i32 v) { return Box3 { v: v }; }
    export anyref boxToAny(Box3 b) { return b as anyref; }
    export i32 anyToBox(anyref r) { return (r as! Box3).v; }
  `);
  const b = e.mkBox3(42);
  const a = e.boxToAny(b);
  eq(e.anyToBox(a), 42, "downcast anyref → Box3 → v=42");
});

// ── i64 increment (i64 local ++ path in emitStmt incr) ───────────────────────

Deno.test("wasmBuildBin: i64 local increment and decrement", async () => {
  const e = await inst(`
    export i64 incI64(i64 x) { x++; x++; return x; }
    export i64 decI64(i64 x) { x--; return x; }
  `);
  eq(e.incI64(5n), 7n, "5+2=7 via i64++");
  eq(e.decI64(3n), 2n, "3-1=2 via i64--");
});

// ── null assigned to nullable local var (emitAssign isNull path) ─────────────

Deno.test("wasmBuildBin: null assign to nullable local var", async () => {
  const e = await inst(`
    struct NBox { i32 v; }
    export i32 nullableLocal(i32 cond) {
      NBox? n = NBox { v: 99 };
      if (cond == 0) { n = null; }
      return n is null ? 0 : n!.v;
    }
  `);
  eq(e.nullableLocal(1), 99, "cond=1 → NBox.v=99");
  eq(e.nullableLocal(0), 0, "cond=0 → null → 0");
});

// ── null assigned to nullable struct field (emitFieldAssign isNull path) ─────

Deno.test("wasmBuildBin: null assign to nullable struct field", async () => {
  const e = await inst(`
    struct NField { anyref? ref; }
    export NField mkNF(anyref r) { return NField { ref: r }; }
    export void clearField(NField f) { f.ref = null; }
    export i32 isNull3(NField f) { return f.ref is null ? 1 : 0; }
  `);
  // Use a boxed struct as anyref
  const f = e.mkNF(e.mkNF(null as unknown as never));
  eq(e.isNull3(f), 0, "field not null initially");
  e.clearField(f);
  eq(e.isNull3(f), 1, "field null after clearField");
});

