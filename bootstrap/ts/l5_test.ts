// wac-L5's tests. Each runs through every rung below it — L4 compiles L5's compiler, L3 compiles
// L4's, L2 compiles L3's, L1 interprets L2's, and L1 itself is hand-written wac-L0.
//
// Stage 1 is real wac *syntax* over the i32 subset: the declarations, the statements and the full
// precedence chain. What is missing is breadth (integer widths, casts, strings) and one piece of
// depth (generics), and both are easier to add to something that already parses the language.

import { l5Run } from "./l5.ts";

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
];

for (const [name, source, want] of programs) {
  Deno.test(`wac-L5: ${name} = ${want}`, async () => {
    const got = await l5Run(source);
    if (got !== want) throw new Error(`got ${got}, want ${want}`);
  });
}
