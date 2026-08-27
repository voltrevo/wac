// sx's own tests: a table of programs and what they answer.
//
// Each runs in a fresh instance, because `$boot` builds the global environment and the heap only
// ever goes up — a shared instance would make every test depend on the ones before it, and the
// first failure would be blamed on the wrong program.

import { assemble } from "./assemble.ts";

const root = new URL("..", import.meta.url).pathname;
const source = await Deno.readTextFile(`${root}boot/sx.wax`);
const bytes = assemble(source);
const compiled = await WebAssembly.compile(bytes.buffer as ArrayBuffer);

const AT = 4096; // clear of the data segments this module already places

async function run(program: string): Promise<number> {
  const inst = await WebAssembly.instantiate(compiled, {});
  const mem = new Uint8Array((inst.exports.memory as WebAssembly.Memory).buffer);
  const text = new TextEncoder().encode(program);
  mem.set(text, AT);
  mem[AT + text.length] = 0;
  return (inst.exports.run_at as (at: number) => number)(AT);
}

const cases: [string, number][] = [
  ["1", 1],
  ["-7", -7],
  ["(+ 1 2)", 3],
  ["(- 10 4)", 6],
  ["(* 6 7)", 42],
  ["(+ (* 2 3) (* 4 5))", 26],

  // `if` and the one false value. Everything but NIL is true, so `<` answering a fixnum is enough.
  ["(if (< 1 2) 10 20)", 10],
  ["(if (< 2 1) 10 20)", 20],
  ["(if (= 3 3) 7 8)", 7],
  ["(if (= 3 4) 7 8)", 8],

  // Pairs, and the tag bit that distinguishes them from fixnums.
  ["(car (cons 4 5))", 4],
  ["(cdr (cons 4 5))", 5],
  ["(if (pair? (cons 1 2)) 1 0)", 1],
  ["(if (pair? 3) 1 0)", 0],
  ["(car (cdr (cons 1 (cons 2 3))))", 2],

  // `quote`, which is the reader and the evaluator disagreeing on purpose.
  ["(car (quote (8 9)))", 8],

  // Closures: applied straight off, bound by `def`, and taking more than one parameter.
  ["((fn (n) (* n 2)) 21)", 42],
  ["((fn (a b) (- a b)) 10 3)", 7],
  ["(def id (fn (x) x)) (id 99)", 99],
  ["(def twice (fn (f x) (f (f x)))) (def inc (fn (n) (+ n 1))) (twice inc 5)", 7],

  // Recursion, which needs `$lookup` to fall back to the globals: the closure is built before the
  // name it calls itself by exists.
  ["(def fact (fn (n) (if (< n 2) 1 (* n (fact (- n 1)))))) (fact 6)", 720],
  ["(def fib (fn (n) (if (< n 2) n (+ (fib (- n 1)) (fib (- n 2)))))) (fib 15)", 610],

  // A list built and walked by an interpreted program rather than by the reader.
  [
    "(def len (fn (l) (if (pair? l) (+ 1 (len (cdr l))) 0)))" +
    "(len (quote (1 2 3 4 5)))",
    5,
  ],
  [
    "(def sum (fn (l) (if (pair? l) (+ (car l) (sum (cdr l))) 0)))" +
    "(sum (quote (10 20 30)))",
    60,
  ],

  // A symbol of odd length, which is what found the alignment bug: it makes the heap pointer odd,
  // and an object at an odd address has an even value, which the tag bit reads as a fixnum.
  ["(def abc (fn (x) x)) (abc 5)", 5],
  ["(def abcd (fn (x) x)) (abcd 5)", 5],
];

for (const [program, want] of cases) {
  Deno.test(`sx: ${program.length > 56 ? program.slice(0, 53) + "…" : program} = ${want}`, async () => {
    const got = await run(program);
    if (got !== want) throw new Error(`got ${got}, want ${want}`);
  });
}

// Strings, added so that the rung above could write a lexer. They share the symbol layout, so the
// same two primitives read either — and `str?`/`sym?` are how a program tells them apart.
const strCases: [string, number][] = [
  [`(sym-len "hello")`, 5],
  [`(sym-byte "hi" 1)`, 105],
  [`(if (str? "x") 1 0)`, 1],
  [`(if (str? (quote x)) 1 0)`, 0],
  [`(if (sym? "x") 1 0)`, 0],
  [`(sym-len "")`, 0],
  // A comment is a comment. It was not until 2026-08-27: `;` was neither skipped nor a delimiter,
  // so every comment in the source was read as code and evaluated. Harmless until one of them
  // contained a parenthesis, at which point the compiler ran its own documentation.
  [`; this is not code\n(+ 1 2)`, 3],
  [`(+ 1 ; nor this (load 4)\n 2)`, 3],
];

for (const [program, want] of strCases) {
  Deno.test(`sx: ${JSON.stringify(program)} = ${want}`, async () => {
    const got = await run(program);
    if (got !== want) throw new Error(`got ${got}, want ${want}`);
  });
}
