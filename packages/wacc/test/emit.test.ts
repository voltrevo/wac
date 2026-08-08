// Rung 4's oracle, first slice: **run what both compilers emit and compare the answers.**
//
// The README argues at length that byte identity is the wrong oracle for this rung — it pins the type
// section's dedup order, index assignment, LEB widths and a name section, none of which is the
// language, and the reference emitter changed emitted bytes several times in the week that argument
// was written. What it proposes instead is the oracle already sitting in this repository for nothing:
// compile a program and *run* it.
//
// So this asks each program of both compilers, instantiates both modules, calls the export with the
// same arguments, and compares what comes back. Nothing here asserts an expected answer: a hand-written
// `5` would be a third opinion, and the point of a differential test is that there are only two.
//
// It is a fraction of the language — an exported `i32` function whose body is one `return` over
// literals, parameters and arithmetic — and the fraction is not the point. The point is that the shape
// is end to end, so the next rule the emitter learns is measured by running it.

import { wacCompile } from "wac/wacCompile.ts";
import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emit = mod.emit as (src: Uint8Array) => Uint8Array;
const enc = new TextEncoder();

/** The exports of a module wacc emitted for this source. */
function ours(src: string): Record<string, unknown> {
  const bytes = Uint8Array.from(emit(enc.encode(src)) as unknown as number[]);
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports;
}

/** The exports of a module the reference emitted for the same source. */
function reference(src: string): Record<string, unknown> {
  const result = wacCompile(new Map([["/main.wac", src]]), "/main.wac");
  if (!result.ok) {
    throw new Error(`the reference will not compile it: ` +
      result.diagnostics.map((d) => d.message).join("; "));
  }
  // Copied into a fresh array: the compiler's buffer is typed against its own ArrayBuffer.
  return new WebAssembly.Instance(
    new WebAssembly.Module(Uint8Array.from(result.compiled.wasm)),
    {},
  ).exports;
}

type Call = { name: string; args: number[] };

const CASES: [string, Call[]][] = [
  ["export i32 answer() { return 42; }", [{ name: "answer", args: [] }]],
  ["export i32 add(i32 a, i32 b) { return a + b; }", [
    { name: "add", args: [2, 3] },
    { name: "add", args: [-1, 1] },
    // Wrapping is the language's own answer and not a special case, so it is asked rather than avoided.
    { name: "add", args: [2147483647, 1] },
  ]],
  ["export i32 sub(i32 a, i32 b) { return a - b; }", [{ name: "sub", args: [3, 10] }]],
  ["export i32 mul(i32 a, i32 b) { return a * b; }", [
    { name: "mul", args: [6, 7] },
    { name: "mul", args: [-3, 5] },
  ]],
  ["export i32 mix(i32 a, i32 b) { return a * 2 + b - 1; }", [{ name: "mix", args: [10, 4] }]],
  ["export i32 second(i32 a, i32 b) { return b; }", [{ name: "second", args: [8, 9] }]],
  // More than one function, so the index assignment and the export table have to line up.
  ["export i32 one() { return 1; } export i32 two(i32 a) { return a + a; }", [
    { name: "one", args: [] },
    { name: "two", args: [21] },
  ]],
  // A literal wide enough to need more than one LEB byte, in both signs.
  ["export i32 big() { return 100000; }", [{ name: "big", args: [] }]],
  ["export i32 neg() { return 0 - 100000; }", [{ name: "neg", args: [] }]],
];

Deno.test("rung 4: what wacc emits runs, and answers what the reference's does", () => {
  let calls = 0;
  for (const [src, invocations] of CASES) {
    const theirs = reference(src);
    const mine = ours(src);
    for (const { name, args } of invocations) {
      const a = theirs[name] as (...xs: number[]) => number;
      const b = mine[name] as (...xs: number[]) => number;
      if (typeof a !== "function") throw new Error(`the reference exports no ${name} for ${src}`);
      if (typeof b !== "function") throw new Error(`we export no ${name} for ${src}`);
      const want = a(...args);
      const got = b(...args);
      if (got !== want) {
        throw new Error(`${name}(${args.join(", ")}) is ${got} from us and ${want} from the ` +
          `reference, for ${JSON.stringify(src)}`);
      }
      calls++;
    }
  }
  // A differential harness that called nothing would report that everything agrees.
  if (calls < 10) throw new Error(`only ${calls} calls compared`);
  console.log(`    rung 4: ${CASES.length} programs, ${calls} calls, every answer agrees`);
});

Deno.test("rung 4: the module is well-formed on its own terms", () => {
  // `WebAssembly.validate` is a second opinion about the bytes that costs nothing and is not the
  // reference's — a module can run the one function a test calls and still be malformed elsewhere.
  for (const [src] of CASES) {
    const bytes = Uint8Array.from(emit(enc.encode(src)) as unknown as number[]);
    if (!WebAssembly.validate(bytes)) {
      throw new Error(`what we emit for ${JSON.stringify(src)} is not a valid module`);
    }
    // The magic and version, which every later section is written after.
    const head = [...bytes.slice(0, 8)];
    if (head.join(",") !== "0,97,115,109,1,0,0,0") {
      throw new Error(`the header is ${head.join(" ")}`);
    }
  }
});
