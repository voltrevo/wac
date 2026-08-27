// wac-0's tests, each run through every rung below it: sx (hand-written .wax) interprets the wx
// compiler, which compiles the wac-0 compiler, which compiles the program, which the assembler turns
// into wasm. Four languages, two interpreters, and nothing in the path that was not built here.
//
// The compiler module is built once and reused — that step is seconds, and the programs are
// milliseconds.

import { wac0Run } from "./wac0.ts";

const expr: [string, number][] = [
  ["1", 1],
  ["2 + 3 * 4", 14],
  ["(2 + 3) * 4", 20],
  ["10 - 2 - 3", 5],               // left-associative, or this is 11
  ["100 / 7", 14],
  ["100 % 7", 2],
  ["-5 + 8", 3],
  ["!0", 1],
  ["!7", 0],
  ["1 < 2", 1],
  ["2 <= 2", 1],
  ["3 > 4", 0],
  ["4 >= 4", 1],
  ["5 == 5", 1],
  ["5 != 5", 0],
  ["1 + 2 == 3", 1],               // comparison binds looser than arithmetic
];

for (const [source, want] of expr) {
  Deno.test(`wac-0: ${source} = ${want}`, async () => {
    const got = await wac0Run(`i32 main() { return ${source}; }`);
    if (got !== want) throw new Error(`got ${got}, want ${want}`);
  });
}

const programs: [string, string, number][] = [
  ["a call, and a callee declared later", `
    i32 main() { return add(40, 2); }
    i32 add(i32 a, i32 b) { return a + b; }`, 42],

  ["recursion", `
    i32 fib(i32 n) {
      if (n < 2) { return n; }
      return fib(n - 1) + fib(n - 2);
    }
    i32 main() { return fib(20); }`, 6765],

  ["locals, assignment and a loop", `
    i32 main() {
      i32 total = 0;
      i32 i = 0;
      while (i < 10) { total = total + i; i = i + 1; }
      return total;
    }`, 45],

  // The inner `x` takes a fresh slot and the name table is popped at the block's end, so the outer
  // binding is untouched. This is the thing wac-0 has that wx does not.
  ["shadowing in a nested block", `
    i32 main() {
      i32 x = 1;
      { i32 x = 20; x = x + 300; }
      return x;
    }`, 1],

  ["a block's assignment reaches the outer binding when it does not shadow", `
    i32 main() {
      i32 x = 1;
      { x = 7; }
      return x;
    }`, 7],

  ["if and else", `
    i32 classify(i32 n) {
      i32 r = 0;
      if (n % 2 == 0) { r = 100; } else { r = 200; }
      return r;
    }
    i32 main() { return classify(4) * 1000 + classify(3); }`, 100200],

  ["nested if in an else, which is how else-if is spelled", `
    i32 sign(i32 n) {
      if (n < 0) { return 0 - 1; } else { if (n > 0) { return 1; } else { return 0; } }
    }
    i32 main() { return sign(5) * 100 + sign(0) * 10 + (sign(0 - 5) + 2); }`, 101],

  ["a comment is not code", `
    // return 1;
    i32 main() { // nor this
      return 42; // nor this
    }`, 42],

  ["several parameters", `
    i32 f(i32 a, i32 b, i32 c, i32 d) { return a * 1000 + b * 100 + c * 10 + d; }
    i32 main() { return f(1, 2, 3, 4); }`, 1234],

  ["a while whose body never runs", `
    i32 main() { i32 n = 0; while (n > 10) { n = n + 1; } return n; }`, 0],

  ["nested loops", `
    i32 main() {
      i32 n = 0;
      i32 i = 0;
      while (i < 3) {
        i32 j = 0;
        while (j < 4) { n = n + 1; j = j + 1; }
        i = i + 1;
      }
      return n;
    }`, 12],
];

for (const [name, source, want] of programs) {
  Deno.test(`wac-0: ${name} = ${want}`, async () => {
    const got = await wac0Run(source);
    if (got !== want) throw new Error(`got ${got}, want ${want}`);
  });
}

// The three things a compiler needs of its own language, and the reason this rung had to grow
// before wac-1 could be written in it.
const forCompilers: [string, string, number][] = [
  ["a global, read and written", `
    i32 cursor = 4096;
    i32 bump() { cursor = cursor + 4; return cursor; }
    i32 main() { bump(); bump(); return cursor; }`, 4104],

  ["a negative global", `
    i32 g = -7;
    i32 main() { return g + 10; }`, 3],

  ["memory, by word and by byte", `
    i32 main() {
      store(4096, 70000);
      store8(4200, 65);
      return load(4096) + load8(4200);
    }`, 70065],

  ["string literals are length-prefixed blocks", `
    i32 strlen(i32 s) { return load(s); }
    i32 strbyte(i32 s, i32 i) { return load8(s + 4 + i); }
    i32 main() { return strlen("hello") * 100 + strbyte("hi", 1); }`, 605],

  ["two literals do not share an offset", `
    i32 strlen(i32 s) { return load(s); }
    i32 main() { return strlen("abc") * 10 + strlen("de"); }`, 32],

  ["a store answers zero rather than re-reading", `
    i32 n = 0;
    i32 bump() { n = n + 1; return 4096; }
    i32 main() { store(bump(), 5); return n; }`, 1],
];

for (const [name, source, want] of forCompilers) {
  Deno.test(`wac-0: ${name} = ${want}`, async () => {
    const got = await wac0Run(source);
    if (got !== want) throw new Error(`got ${got}, want ${want}`);
  });
}

Deno.test("wac-0: every function is exported, not only main", async () => {
  const got = await wac0Run(
    `i32 twice(i32 n) { return n * 2; }\ni32 main() { return 0; }`,
    "twice",
  );
  if (got !== 0) throw new Error(`calling twice() with no argument should answer 0, got ${got}`);
});
