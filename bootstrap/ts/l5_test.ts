// wac-L5's tests. Each runs through every rung below it — L4 compiles L5's compiler, L3 compiles
// L4's, L2 compiles L3's, L1 interprets L2's, and L1 itself is hand-written wac-L0.
//
// Stage 1 is real wac *syntax* over the i32 subset: the declarations, the statements and the full
// precedence chain. What is missing is breadth (integer widths, casts, strings) and one piece of
// depth (generics), and both are easier to add to something that already parses the language.

import { l5Run, l5RunFile } from "./l5.ts";

const expr: [string, number][] = [
  ["1 + 2 * 3", 7],
  ["(1 + 2) * 3", 9],
  ["10 - 2 - 3", 5],
  ["17 % 5", 2],
  ["1 << 4", 16],
  ["256 >> 4", 16],
  ["12 & 10", 8],
  ["12 | 3", 15],
  ["12 ^ 10", 6],
  ["~0", -1],
  ["!0", 1],
  ["-7 + 10", 3],
  ["true", 1],
  ["false", 0],
  ["1 < 2 ? 10 : 20", 10],
  ["1 > 2 ? 10 : 20", 20],
  // Nested, and right-associative: `a ? b : c ? d : e` is `a ? b : (c ? d : e)`.
  ["0 ? 1 : 0 ? 2 : 3", 3],
  ["1 == 1 && 2 == 2", 1],
  ["1 == 2 && 2 == 2", 0],
  ["1 == 2 || 3 == 3", 1],
  ["1 == 2 || 3 == 4", 0],
  // Precedence: `&&` binds tighter than `||`, and comparison tighter than both.
  ["1 == 2 && 1 == 1 || 3 == 3", 1],
];

for (const [source, want] of expr) {
  Deno.test(`wac-L5: ${source} = ${want}`, async () => {
    const got = await l5Run(`i32 main() { return ${source}; }`);
    if (got !== want) throw new Error(`got ${got}, want ${want}`);
  });
}

const programs: [string, string, number][] = [
  ["export, a doc comment, for, += and a ternary", `
    /** The nth Fibonacci number, the slow way. */
    i32 fib(i32 n) {
      if (n < 2) { return n; }
      return fib(n - 1) + fib(n - 2);
    }
    export i32 main() {
      i32 total = 0;
      for (i32 i = 0; i < 10; i++) { total += i; }
      return total > 40 && total < 50 ? fib(10) : 0;
    }`, 55],

  ["a while loop", `
    i32 main() {
      i32 n = 1;
      while (n < 100) { n = n * 3; }
      return n;
    }`, 243],

  ["a for loop with no body braces", `
    i32 main() {
      i32 n = 0;
      for (i32 i = 0; i < 5; i++) n += i;
      return n;
    }`, 10],

  ["nested for loops, whose labels must not collide", `
    i32 main() {
      i32 n = 0;
      for (i32 i = 0; i < 3; i++) {
        for (i32 j = 0; j < 4; j++) { n++; }
      }
      return n;
    }`, 12],

  ["a global, set and read", `
    i32 seen;
    i32 bump() { seen += 2; return seen; }
    i32 main() { bump(); bump(); return seen; }`, 4],

  ["shadowing in a nested block", `
    i32 main() {
      i32 x = 1;
      { i32 x = 20; x += 300; }
      return x;
    }`, 1],

  // Short-circuit is the point: `b` must not run when `a` decides the answer.
  ["&& does not evaluate its right side when the left is false", `
    i32 ran;
    i32 boom() { ran = 1; return 1; }
    i32 main() { if (0 == 1 && boom()) { } return ran; }`, 0],

  ["|| does not evaluate its right side when the left is true", `
    i32 ran;
    i32 boom() { ran = 1; return 1; }
    i32 main() { if (1 == 1 || boom()) { } return ran; }`, 0],

  ["else if, spelled as wac spells it", `
    i32 sign(i32 n) {
      if (n < 0) { return -1; } else if (n > 0) { return 1; } else { return 0; }
    }
    i32 main() { return sign(5) * 100 + sign(-5) + 10 * (sign(0) + 1); }`, 109],

  ["a block comment between declarations", `
    /* a comment
       over several lines, as every doc comment in wac is */
    i32 main() { return 42; }`, 42],
  // --- stage 2: the type system

  ["a struct with a method and `const this`", `
    struct Point {
      i32 x;
      i32 y;
      i32 sum(const this) { return this.x + this.y; }
    }
    export i32 main() { Point p = Point(3, 4); return p.sum(); }`, 7],

  ["an array, sized and indexed", `
    i32 main() {
      i32[] xs = i32[4]();
      xs[0] = 10;
      xs[2] = 5;
      return xs[0] + xs[2] + xs.len();
    }`, 19],

  ["an array literal, whose length is how many arguments it has", `
    i32 main() { i32[] xs = i32[](7, 8, 9); return xs.len() * 100 + xs[2]; }`, 309],

  ["an enum with wac's comma-separated variants, and match as a statement", `
    enum Shape { Circle(i32 r), Rect(i32 w, i32 h), Empty }
    i32 area(Shape s) {
      match (s) {
        case Circle(r): { return 3 * r * r; }
        case Rect(w, h): { return w * h; }
        case Empty: { return 0; }
      }
      return -1;
    }
    i32 main() { return area(Circle(2)) * 10000 + area(Rect(3, 4)) * 100 + area(Empty); }`, 121200],

  // The shape `core/option.wac` is actually written in: match as an *expression*, `_` for a payload
  // that is not read, and methods on the enum itself.
  ["match as an expression, with `_`", `
    enum Option {
      Some(i32 v), None

      bool isSome(const this) {
        return match (this) { case Some(_): true, case None: false };
      }
      i32 orElse(const this, i32 d) {
        return match (this) { case Some(v): v, case None: d };
      }
    }
    export i32 main() {
      Option a = Some(7);
      Option b = None;
      return a.orElse(99) * 1000 + b.orElse(42) * 10 + a.isSome() + b.isSome();
    }`, 7421],

  ["a struct naming itself through an array", `
    struct Node { i32 value; Node[] kids; }
    i32 total(Node n) {
      i32 sum = n.value;
      for (i32 i = 0; i < n.kids.len(); i++) { sum += total(n.kids[i]); }
      return sum;
    }
    i32 main() {
      Node[] none = Node[0]();
      Node[] two = Node[2]();
      two[0] = Node(2, none);
      two[1] = Node(4, none);
      return total(Node(1, two));
    }`, 7],

  ["a field assigned through a chain", `
    struct Inner { i32 v; }
    struct Outer { Inner in; i32 tag; }
    i32 main() {
      Outer o = Outer(Inner(5), 9);
      o.in.v = 6;
      return o.in.v * 10 + o.tag;
    }`, 69],

  ["a byte array", `
    i32 main() { u8[] b = u8[3](); b[0] = 200; b[1] = 7; return b[0] + b[1] + b.len(); }`, 210],

  ["a reference global", `
    struct P { i32 v; }
    P held;
    i32 setup() { held = P(9); return 0; }
    i32 main() { setup(); return held.v; }`, 9],
  // --- stage 3: the numeric lattice
  //
  // wasm has two integer value types; wac has eight names for them, differing in width and in
  // signedness. Those two facts decide which instruction every operator emits, and nothing else in
  // the compiler can tell `u32 / u32` from `i32 / i32`.

  ["unsigned division picks div_u", `
    i32 main() { u32 a = 4294967295 as u32; return (a / 2 as u32) as i32 != 0 ? 1 : 0; }`, 1],

  ["unsigned comparison picks gt_u", `
    i32 main() { u32 a = -1 as u32; u32 b = 1 as u32; return a > b ? 1 : 0; }`, 1],

  ["...and the same program signed does not", `
    i32 main() { i32 a = -1; i32 b = 1; return a > b ? 1 : 0; }`, 0],

  ["i64 arithmetic", `
    i32 main() { i64 a = 3 as i64; i64 b = 4 as i64; return (a * b) as i32; }`, 12],

  ["widened and narrowed again", `
    i32 main() { return ((7 as i64) + (5 as i64)) as i32; }`, 12],

  ["an i64 comparison", `
    i32 main() { i64 a = 5 as i64; return a > (2 as i64) ? 1 : 0; }`, 1],

  ["an i64 parameter and return", `
    i64 twice(i64 n) { return n + n; }
    i32 main() { return twice(21 as i64) as i32; }`, 42],

  ["negation, at whatever width its operand is", `
    i32 main() { i64 a = 5 as i64; i64 z = -a; return z < (0 as i64) ? 1 : 0; }`, 1],

  ["a bool is what a comparison answers", `
    i32 main() { bool b = 3 > 2; return b ? 10 : 20; }`, 10],

  // Packed storage: wasm has i8 and i16 as element types and no others, and reading one widens —
  // signed or unsigned according to the wac type, which is the whole reason both exist.
  ["a packed i16 element reads signed", `
    i32 main() { i16[] xs = i16[2](); xs[0] = -300; return xs[0]; }`, -300],

  ["a packed u16 element reads unsigned", `
    i32 main() { u16[] xs = u16[2](); xs[0] = 65535; return xs[0]; }`, 65535],
  // --- stage 3b: strings
  //
  // `string` is a GC array of bytes — the same array type a `u8[]` is — so `.len()` and `[i]` work
  // on it with no second implementation, and a literal and a built string are one kind of value.
  // A literal lives in linear memory as a length and its bytes, which is how every rung below
  // writes one; an emitted `$__strlit` lifts it into the array.

  ["a literal, its length and its bytes", `
    i32 main() { string s = "hello"; return s.len() * 100 + s[0]; }`, 604],

  ["concatenation, which is what 659 sites in wacc's source do", `
    i32 main() {
      string a = "Point";
      string b = "sum";
      string j = a + "_" + b;
      return j.len() * 1000 + j[5] * 10 + (j[0] == 80 ? 1 : 0);
    }`, 9951],

  ["an empty literal", `i32 main() { return ("" + "ab").len(); }`, 2],

  ["a string through a parameter and a return", `
    string twice(string s) { return s + s; }
    i32 main() { string d = twice("ab"); return d.len() * 10 + d[2]; }`, 137],

  ["a string in a struct", `
    struct Named { string name; i32 id; }
    i32 main() { Named n = Named("abc", 7); return n.name.len() * 10 + n.id; }`, 37],

  ["strings compare by content, not identity, when written out", `
    bool same(string a, string b) {
      if (a.len() != b.len()) { return false; }
      for (i32 i = 0; i < a.len(); i++) { if (a[i] != b[i]) { return false; } }
      return true;
    }
    i32 main() { return same("ab" + "c", "abc") ? 1 : 0; }`, 1],

  // --- stage 4: generics, monomorphised
  //
  // A generic declaration is not compiled where it is written. Its token index is recorded, and its
  // body is re-read once per instantiation with the letters bound — which is cheap here because the
  // parser's whole state is one integer into the token array, so "read this again, in another
  // world" is an assignment.

  ["a generic instantiated twice", `
    struct Box<T> {
      T v;
      T get(const this) { return this.v; }
    }
    export i32 main() {
      Box<i32> a = Box(7);
      Box<bool> b = Box(true);
      return a.get() * 10 + (b.get() ? 1 : 0);
    }`, 71],

  ["the slot supplies the type argument", `
    struct Box<T> { T v; }
    i32 main() { Box<i32> a = Box(7); return a.v; }`, 7],

  ["...and it can be written out instead", `
    struct Box<T> { T v; }
    i32 main() { Box<i32> a = Box<i32>(7); return a.v; }`, 7],

  ["a generic with an array field and methods", `
    struct Vec<T> {
      T[] data;
      i32 n;
      i32 push(this, T v) { this.data[this.n] = v; this.n = this.n + 1; return this.n; }
      T get(const this, i32 i) { return this.data[i]; }
    }
    i32 main() {
      Vec<i32> v = Vec(i32[8](), 0);
      v.push(4); v.push(9);
      return v.get(0) * 10 + v.get(1);
    }`, 49],

  ["a generic enum, with match", `
    enum Option<T> {
      Some(T v), None
      T orElse(const this, T d) { return match (this) { case Some(v): v, case None: d }; }
    }
    i32 main() {
      Option<i32> a = Some(7);
      Option<i32> b = None;
      return a.orElse(1) * 10 + b.orElse(3);
    }`, 73],

  // `>>` closes two argument lists and the lexer packs it into a shift, which is right everywhere
  // else — so the token is rewritten in place as the second `>` and read again.
  ["nested: Vec<Vec<i32>>", `
    struct Vec<T> {
      T[] data;
      i32 n;
      i32 push(this, T v) { this.data[this.n] = v; this.n = this.n + 1; return this.n; }
      T get(const this, i32 i) { return this.data[i]; }
    }
    i32 main() {
      Vec<i32> inner = Vec(i32[4](), 0);
      inner.push(42);
      Vec<Vec<i32>> outer = Vec(Vec<i32>[4](), 0);
      outer.push(inner);
      return outer.get(0).get(0);
    }`, 42],

  ["two type parameters", `
    struct Pair<A, B> { A a; B b; A first(const this) { return this.a; } }
    i32 main() { Pair<i32, bool> p = Pair(9, true); return p.first(); }`, 9],

  // The arm answers a reference, so the block's result type is not `i32` — and it is written before
  // any arm has been read. The arms go to scratch and the header is written in front of them.
  ["a generic enum over a struct, whose match answers a reference", `
    struct P { i32 x; }
    enum Option<T> {
      Some(T v), None
      T orElse(const this, T d) { return match (this) { case Some(v): v, case None: d }; }
    }
    i32 main() { Option<P> o = Some(P(6)); return o.orElse(P(0)).x; }`, 6],

  ["a generic over a struct", `
    struct P { i32 x; }
    struct Box<T> { T v; T get(const this) { return this.v; } }
    i32 main() { Box<P> b = Box(P(5)); return b.get().x; }`, 5],
];

// wac compiles a whole program into one wasm module, so an import is a file to *include* rather
// than a boundary to cross. Resolving one is path arithmetic and a file read, neither of which a
// wac-L4 program can do — so the driver flattens the graph, which is where `files.wac` does it in
// the real compiler. Depth first, post-order, visited once, so a diamond does not duplicate.
Deno.test("wac-L5: imports, flattened, with a diamond = 49", async () => {
  const root = new URL("..", import.meta.url).pathname;
  const got = await l5RunFile(`${root}tests/l5/imports.l5`);
  if (got !== 49) throw new Error(`got ${got}, want 49`);
});

for (const [name, source, want] of programs) {
  Deno.test(`wac-L5: ${name} = ${want}`, async () => {
    const got = await l5Run(source);
    if (got !== want) throw new Error(`got ${got}, want ${want}`);
  });
}
