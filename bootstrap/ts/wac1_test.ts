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
];

for (const [name, source, want] of cases) {
  Deno.test(`wac-1: ${name} = ${want}`, async () => {
    const got = await wac1Run(source);
    if (got !== want) throw new Error(`got ${got}, want ${want}`);
  });
}
