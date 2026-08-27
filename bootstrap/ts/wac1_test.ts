// wac-1's tests, each run through every rung below it: sx interprets the wx compiler, which
// compiles the wac-0 compiler, which compiles the wac-1 compiler, which compiles the program.
// Five languages, two interpreters, and a wasm GC module at the end of it.

import { wac1Run } from "./wac1.ts";

const cases: [string, string, number][] = [
  ["wac-0's programs still compile", `
    i32 fib(i32 n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); }
    i32 main() { return fib(20); }`, 6765],

  ["a struct, built and read", `
    struct Point { i32 x; i32 y; }
    i32 main() { Point p = Point(3, 4); return p.x * 10 + p.y; }`, 34],

  ["a struct through a parameter and a return", `
    struct Point { i32 x; i32 y; }
    Point flip(Point p) { return Point(p.y, p.x); }
    i32 main() { Point q = flip(Point(3, 4)); return q.x * 10 + q.y; }`, 43],

  ["a field assigned", `
    struct Point { i32 x; i32 y; }
    i32 main() { Point p = Point(1, 2); p.x = 7; return p.x * 10 + p.y; }`, 72],

  ["a struct inside a struct, read and written through the chain", `
    struct Inner { i32 v; }
    struct Outer { Inner in; i32 tag; }
    i32 main() {
      Outer o = Outer(Inner(5), 9);
      o.in.v = 6;
      return o.in.v * 10 + o.tag;
    }`, 69],

  ["an array", `
    i32 main() {
      i32[] xs = i32[5]();
      xs[0] = 10;
      xs[1] = 20;
      return xs[0] + xs[1] + xs.len();
    }`, 35],

  ["an array whose length is an expression", `
    i32 main() { i32 n = 3; i32[] xs = i32[n * 2](); return xs.len(); }`, 6],

  ["a new array is zeroed", `
    i32 main() { i32[] xs = i32[4](); return xs[0] + xs[3]; }`, 0],

  ["an array of structs", `
    struct P { i32 v; }
    i32 main() {
      P[] ps = P[2]();
      ps[0] = P(4);
      ps[1] = P(5);
      return ps[0].v * 10 + ps[1].v;
    }`, 45],

  // The shape that needs a recursive type group: a struct holding an array of itself.
  ["a struct naming itself through an array", `
    struct Node { i32 value; Node[] kids; }
    i32 total(Node n) {
      i32 sum = n.value;
      i32 i = 0;
      while (i < n.kids.len()) { sum = sum + total(n.kids[i]); i = i + 1; }
      return sum;
    }
    i32 main() {
      Node[] none = Node[0]();
      Node[] two = Node[2]();
      two[0] = Node(2, none);
      two[1] = Node(4, none);
      return total(Node(1, two));
    }`, 7],

  ["a struct naming one declared later", `
    struct A { B b; }
    struct B { i32 v; }
    i32 main() { A a = A(B(9)); return a.b.v; }`, 9],

  // `isnull(x)` rather than `x == null`: `==` emits `i32.eq`, which is a type error on references.
  // wasm spells it `ref.is_null`, and a rung with no type checker does not get to offer a spelling
  // that hides the difference.
  ["null and isnull", `
    struct Box { i32 v; }
    i32 main() { Box b = null; if (isnull(b)) { return 1; } return 0; }`, 1],

  ["a null field, filled in later", `
    struct Cell { i32 v; Cell next; }
    i32 main() {
      Cell a = Cell(1, null);
      Cell b = Cell(2, null);
      a.next = b;
      if (isnull(a.next)) { return 0; }
      return a.v * 10 + a.next.v;
    }`, 12],

  ["an array of references starts null", `
    struct P { i32 v; }
    i32 main() { P[] ps = P[2](); if (isnull(ps[0])) { return 7; } return 0; }`, 7],
  // --- enums with payloads, and match

  ["an enum with three shapes of variant", `
    enum Shape { Circle(i32 r); Rect(i32 w, i32 h); Empty; }
    i32 area(Shape s) {
      match (s) {
        case Circle(r): { return 3 * r * r; }
        case Rect(w, h): { return w * h; }
        case Empty: { return 0; }
      }
      return 0 - 1;
    }
    i32 main() {
      return area(Circle(2)) * 10000 + area(Rect(3, 4)) * 100 + area(Empty);
    }`, 121200],

  // The shape wac's own compiler is written in, and the reason `match` is the feature worth having.
  ["a recursive enum, and an evaluator over it", `
    enum Expr { Num(i32 v); Add(Expr a, Expr b); Mul(Expr a, Expr b); Neg(Expr a); }
    i32 eval(Expr e) {
      match (e) {
        case Num(v): { return v; }
        case Add(a, b): { return eval(a) + eval(b); }
        case Mul(a, b): { return eval(a) * eval(b); }
        case Neg(a): { return 0 - eval(a); }
      }
      return 0;
    }
    i32 main() { return eval(Mul(Add(Num(2), Num(3)), Neg(Num(4)))); }`, -20],

  ["a match arm's bindings do not leak", `
    enum E { A(i32 v); B(i32 v); }
    i32 pick(E e) {
      i32 v = 100;
      match (e) { case A(v): { return v; } case B(v): { return v * 2; } }
      return v;
    }
    i32 main() { return pick(A(7)) * 100 + pick(B(3)); }`, 706],

  ["an enum in a struct, and an array of enums", `
    enum Tok { Num(i32 v); Plus; }
    i32 val(Tok t) { match (t) { case Num(v): { return v; } case Plus: { return 0; } } return 0; }
    i32 main() {
      Tok[] ts = Tok[3]();
      ts[0] = Num(4);
      ts[1] = Plus;
      ts[2] = Num(5);
      return val(ts[0]) * 10 + val(ts[2]);
    }`, 45],

  // --- methods

  ["a method, and a method calling one on `this`", `
    struct Point {
      i32 x;
      i32 y;
      i32 sum(this) { return this.x + this.y; }
      i32 scaled(this, i32 k) { return this.sum() * k; }
    }
    i32 main() { Point p = Point(3, 4); return p.sum() * 100 + p.scaled(2); }`, 714],

  ["a method returning a struct", `
    struct Point {
      i32 x;
      i32 y;
      Point flip(this) { return Point(this.y, this.x); }
    }
    i32 main() { Point q = Point(3, 4).flip(); return q.x * 10 + q.y; }`, 43],
  // **The tax for leaving generics out, measured.** A compiler cannot be written without a growable
  // vector, and wac-1 has no `Vec<T>` — so you hand-write one per element type. This is 25 lines,
  // and a compiler wants perhaps five of them. That is the whole cost of the decision, and it is
  // paid in the language you are *writing in* rather than in the one you are implementing.
  ["a growable vector, hand-written", `
    struct IntVec {
      i32[] data;
      i32 n;
      i32 push(this, i32 v) {
        if (this.n == this.data.len()) { this.grow(); }
        this.data[this.n] = v;
        this.n = this.n + 1;
        return v;
      }
      i32 grow(this) {
        i32 want = this.data.len() * 2;
        if (want == 0) { want = 4; }
        i32[] bigger = i32[want]();
        i32 i = 0;
        while (i < this.n) { bigger[i] = this.data[i]; i = i + 1; }
        this.data = bigger;
        return want;
      }
      i32 get(this, i32 i) { return this.data[i]; }
      i32 len(this) { return this.n; }
    }
    IntVec newIntVec() { return IntVec(i32[0](), 0); }
    i32 main() {
      IntVec v = newIntVec();
      i32 i = 0;
      while (i < 100) { v.push(i * i); i = i + 1; }
      return v.get(9) * 1000 + v.len();
    }`, 81100],
];

for (const [name, source, want] of cases) {
  Deno.test(`wac-1: ${name} = ${want}`, async () => {
    const got = await wac1Run(source);
    if (got !== want) throw new Error(`got ${got}, want ${want}`);
  });
}
