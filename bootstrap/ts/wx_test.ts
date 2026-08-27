// wx's tests: each runs the whole ladder.
//
//   the program -> sx (hand-written .wax) -> the wx compiler (sx source) -> .wax -> assembler -> wasm
//
// Nothing is stubbed and no step is skipped, which is the point: a passing test here is evidence
// that every rung below it works, and a failure needs bisecting downwards rather than reading.

import { wxRun, wxToWax } from "./wx.ts";

const cases: [string, string, number][] = [
  ["a call and arithmetic", `
    (fn add ((a i32) (b i32)) i32 (+ a b))
    (fn main () i32 (add 40 2))
    (export main)`, 42],

  ["operator precedence is parentheses", `
    (fn main () i32 (* (+ 1 2) (- 10 4)))
    (export main)`, 18],

  ["if, both arms", `
    (fn pick ((n i32)) i32 (if (< n 5) 100 200))
    (fn main () i32 (+ (pick 1) (pick 9)))
    (export main)`, 300],

  ["let and set in a while", `
    (fn main () i32
      (do (let i 1) (let total 0)
          (while (<= i 10) (set total (+ total i)) (set i (+ i 1)))
          total))
    (export main)`, 55],

  // The one that would have shipped silently: `while`'s labels were globals, so an inner loop
  // rebound the outer one's, and the outer `br` — emitted after the body — branched to the inner
  // loop. The generated assembly looks entirely reasonable.
  ["a while inside a while", `
    (fn main () i32
      (do (let i 0) (let n 0)
          (while (< i 3)
            (do (let j 0)
                (while (< j 4) (set n (+ n 1)) (set j (+ j 1))))
            (set i (+ i 1)))
          n))
    (export main)`, 12],

  ["recursion", `
    (fn fib ((n i32)) i32 (if (< n 2) n (+ (fib (- n 1)) (fib (- n 2)))))
    (fn main () i32 (fib 20))
    (export main)`, 6765],

  ["globals, load and store", `
    (memory 1)
    (global cursor 1024)
    (fn push ((v i32)) i32 (do (store cursor v) (set cursor (+ cursor 4)) v))
    (fn main () i32
      (do (push 11) (push 22) (push 33)
          (+ (load 1024) (+ (load 1028) (load 1032)))))
    (export main)`, 66],

  ["bytes, which is what a compiler writes", `
    (memory 1)
    (fn main () i32
      (do (store8 100 65) (store8 101 66) (+ (load8 100) (load8 101))))
    (export main)`, 131],

  ["comparison and negation", `
    (fn main () i32
      (+ (* 100 (if (not (> 1 2)) 1 0))
         (+ (* 10 (if (>= 3 3) 1 0)) (if (!= 4 4) 1 0))))
    (export main)`, 110],

  ["a negative literal survives the decimal writer", `
    (fn main () i32 (- 0 (- 0 (+ -7 -3))))
    (export main)`, -10],
];

for (const [name, program, want] of cases) {
  Deno.test(`wx: ${name} = ${want}`, async () => {
    const got = await wxRun(program);
    if (got !== want) throw new Error(`got ${got}, want ${want}`);
  });
}

Deno.test("wx: the compiler is deterministic", async () => {
  const p = `(fn main () i32 (+ 1 2))\n(export main)`;
  const a = await wxToWax(p);
  const b = await wxToWax(p);
  if (a !== b) throw new Error("two runs of the compiler disagreed");
});
