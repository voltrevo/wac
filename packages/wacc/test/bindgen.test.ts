// wacc's bindgen, used the only way that proves anything: generate the glue, import it, call it.
//
// The reference's generator is 1,011 lines and covers every type wac has; this covers the numbers,
// `bool`, `string` and the numeric arrays, and *says* what it declines rather than emitting glue
// that fails at run time. What it must never do is generate something that looks right and answers
// wrong, so the test here calls every generated function and compares against the wac program's own
// arithmetic.

import { wacBind } from "../../../harness/wacBind.ts";
import {
  generate, parseBindTypes, parseCallbacks, parseSigs, supported, unsupported,
} from "../tools/waccBindgen.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emitFiles = mod.emitFiles as (p: string[], s: string[], e: string) => Uint8Array;
const exportSigs = mod.exportSigsFiles as (p: string[], s: string[], e: string) => string;
const bindTypes = mod.bindTypesFiles as (p: string[], s: string[], e: string) => string;

const SRC = `export i32 addTwo(i32 a, i32 b) { return a + b; }
export f64 half(f64 x) { return x / 2.0; }
export bool isBig(i32 n) { return n > 100; }
export i64 wide(i64 a) { return a * 2; }
export string greet(string who) { return "hi " + who; }
export u8[] echo(u8[] b) { return b; }
export i32[] doubled(i32[] xs) {
  i32[] out = i32[xs.len()](fill: 0);
  for (i32 i = 0; i < xs.len(); i++) { out[i] = xs[i] * 2; }
  return out;
}
export i32 total(i32[] xs) { i32 t = 0; for (i32 i = 0; i < xs.len(); i++) { t = t + xs[i]; } return t; }
export void ignored() { }
`;

Deno.test("bindgen: the generated glue calls the module and answers what wac answers", async () => {
  const wasm = Uint8Array.from(emitFiles(["m.wac"], [SRC], "m.wac") as unknown as number[]);
  if (wasm.length <= 8) throw new Error("the module was declined");
  const sigs = parseSigs(exportSigs(["m.wac"], [SRC], "m.wac"));
  if (sigs.length !== 9) throw new Error(`${sigs.length} exported signatures, wanted 9`);
  if (unsupported(sigs).length > 0) {
    throw new Error(`declined what it should cover: ${unsupported(sigs).join(", ")}`);
  }

  const source = generate(wasm, sigs);
  const path = await Deno.makeTempFile({ suffix: ".gen.ts" });
  await Deno.writeTextFile(path, source);
  try {
    const glue = await import(`file://${path}`) as Record<string, CallableFunction>;
    const wrong: string[] = [];
    const eq = (what: string, got: unknown, want: unknown) => {
      if (String(got) !== String(want)) wrong.push(`${what}: ${got}, wanted ${want}`);
    };
    eq("addTwo(2, 3)", glue.addTwo(2, 3), 5);
    eq("half(9)", glue.half(9), 4.5);
    eq("isBig(101)", glue.isBig(101), true);
    eq("isBig(1)", glue.isBig(1), false);
    eq("wide(21n)", glue.wide(21n), 42n);
    eq("greet", glue.greet("world"), "hi world");
    // A string that is not ASCII, because the buffer carries bytes and the length is in bytes.
    eq("greet(é)", glue.greet("café"), "hi café");
    eq("echo", Array.from(glue.echo(new Uint8Array([1, 2, 250])) as Uint8Array).join(","), "1,2,250");
    eq("doubled", Array.from(glue.doubled(new Int32Array([1, -2, 3])) as Int32Array).join(","), "2,-4,6");
    eq("total", glue.total(new Int32Array([10, 20, 12])), 42);
    glue.ignored();
    if (wrong.length > 0) throw new Error(`${wrong.length} wrong answer(s):\n  ${wrong.join("\n  ")}`);
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("bindgen: what it cannot bind is named, not silently skipped", () => {
  const src = `struct P { i32 x; }
export i32 fine(i32 n) { return n; }
export P makeP(i32 n) { return P(n); }
export i32 viaCallback(fn[i32(i32)] cb) { return cb(1); }
export fn[i32(i32)] handOut() { return handOut; }
`;
  const sigs = parseSigs(exportSigs(["m.wac"], [src], "m.wac"));
  const wire = bindTypes(["m.wac"], [src], "m.wac");
  const types = parseBindTypes(wire);
  const cbs = parseCallbacks(wire);
  const declined = unsupported(sigs, types, cbs);
  if (!sigs.some(s => s.name === "fine" && supported(s, types, cbs))) {
    throw new Error("a scalar export was declined");
  }
  // A struct crosses, and so does a callback *in*. What is left is a funcref going the other way —
  // a wac function handed to the host — which needs `$bind$callref_*`, a helper this emitter does
  // not write yet. It is named rather than skipped, which is the whole rule here.
  if (declined.length !== 1 || !declined[0].startsWith("handOut")) {
    throw new Error(`declined ${JSON.stringify(declined)}, wanted just handOut`);
  }
  // And the glue that is generated holds only what it can honour — a caller reaching for `makeP`
  // gets a missing export at import time rather than a wrong answer at run time.
  const wasm = Uint8Array.from(emitFiles(["m.wac"], [src], "m.wac") as unknown as number[]);
  const source = generate(wasm, sigs, types, cbs);
  if (!source.includes("export function fine")) throw new Error("the supported export is missing");
  if (!source.includes("export function viaCallback")) throw new Error("a callback parameter was declined");
  if (source.includes("export function handOut")) throw new Error("glue was generated for a funcref return");
});

const TYPED = `struct Point { i32 x; i32 y;
  i32 sum(const this) { return this.x + this.y; }
  Point origin() { return Point(0, 0); }
}
enum Shape { Empty, Circle(f64 r), Named(string what) }
export Point shift(Point p, i32 by) { return Point(p.x + by, p.y); }
export f64 radius(Shape s) { return match (s) { case Circle(r): r, else: 0.0 }; }
export Shape circle(f64 r) { return Shape.Circle(r); }
`;

Deno.test("bindgen: a struct and an enum cross as classes holding the reference", async () => {
  const wasm = Uint8Array.from(emitFiles(["m.wac"], [TYPED], "m.wac") as unknown as number[]);
  const sigs = parseSigs(exportSigs(["m.wac"], [TYPED], "m.wac"));
  const types = parseBindTypes(bindTypes(["m.wac"], [TYPED], "m.wac"));
  if (types.length !== 2) throw new Error(`${types.length} bound types, wanted Point and Shape`);
  if (unsupported(sigs, types).length > 0) {
    throw new Error(`declined: ${unsupported(sigs, types).join(", ")}`);
  }

  const path = await Deno.makeTempFile({ suffix: ".gen.ts" });
  await Deno.writeTextFile(path, generate(wasm, sigs, types));
  try {
    // deno-lint-ignore no-explicit-any
    const g = await import(`file://${path}`) as Record<string, any>;
    const wrong: string[] = [];
    const eq = (what: string, got: unknown, want: unknown) => {
      if (String(got) !== String(want)) wrong.push(`${what}: ${got}, wanted ${want}`);
    };

    const p = g.Point.$of(3, 4);
    eq("Point.$of(3,4).sum()", p.sum(), 7);
    eq("p.x", p.x, 3);
    p.y = 10;                                    // a setter writes through the reference
    eq("p.sum() after p.y = 10", p.sum(), 13);
    eq("Point.origin().sum()", g.Point.origin().sum(), 0);
    // A wrapper handed straight back into the module: nothing is copied, so the same object
    // reaches wac and comes back out as another wrapper.
    eq("shift(p, 1).x", g.shift(p, 1).x, 4);

    const c = g.Shape.Circle(2.5);
    eq("Shape.Circle(2.5).tag", c.tag, "Circle");
    eq("its payload", c.Circle_r(), 2.5);
    eq("radius(c)", g.radius(c), 2.5);
    eq("Shape.Empty().tag", g.Shape.Empty().tag, "Empty");
    eq("a string payload", g.Shape.Named("hi").Named_what(), "hi");
    // Round-tripping through wac: the enum comes back as a wrapper, not as a number.
    eq("circle(9).tag", g.circle(9).tag, "Circle");

    if (wrong.length > 0) throw new Error(`${wrong.length} wrong answer(s):\n  ${wrong.join("\n  ")}`);
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("bindgen: a JavaScript function crosses as a callback wac can call", async () => {
  const src = `export i32 twice(fn[i32(i32)] cb) { return cb(1) + cb(2); }
export i32 apply(fn[i32(i32)] f, i32 n) { return f(f(n)); }
export bool anyOf(fn[bool(i32)] p, i32 a, i32 b) { return p(a) || p(b); }
`;
  const wasm = Uint8Array.from(emitFiles(["m.wac"], [src], "m.wac") as unknown as number[]);
  const wire = bindTypes(["m.wac"], [src], "m.wac");
  const cbs = parseCallbacks(wire);
  // Two distinct signatures, and the numbering is the module's import order — `cb0` is the one the
  // module imports first, and a generator that guessed would answer the wrong callback.
  if (cbs.length !== 2) throw new Error(`${cbs.length} callback signatures, wanted 2`);
  if (cbs[0].wac !== "fn[i32(i32)]") throw new Error(`cb0 is ${cbs[0].wac}`);

  const sigs = parseSigs(exportSigs(["m.wac"], [src], "m.wac"));
  const path = await Deno.makeTempFile({ suffix: ".gen.ts" });
  await Deno.writeTextFile(path, generate(wasm, sigs, parseBindTypes(wire), cbs));
  try {
    // deno-lint-ignore no-explicit-any
    const g = await import(`file://${path}`) as Record<string, any>;
    const wrong: string[] = [];
    const eq = (what: string, got: unknown, want: unknown) => {
      if (String(got) !== String(want)) wrong.push(`${what}: ${got}, wanted ${want}`);
    };
    eq("twice(x => x * 10)", g.twice((n: number) => n * 10), 30);
    eq("apply(x => x + 1, 5)", g.apply((n: number) => n + 1, 5), 7);
    // A second signature, and a `bool` coming back out of a callback.
    eq("anyOf(n => n > 3, 1, 9)", g.anyOf((n: number) => n > 3, 1, 9), true);
    eq("anyOf(n => n > 30, 1, 9)", g.anyOf((n: number) => n > 30, 1, 9), false);
    if (wrong.length > 0) throw new Error(`${wrong.length} wrong answer(s):\n  ${wrong.join("\n  ")}`);
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("bindgen: the seventeenth distinct callback is a diagnosis, not a wrong answer", async () => {
  // Its own module, because the slots are per instance and per signature: a test that had already
  // passed two functions in was measuring 14 rather than 16, which is how this was written the
  // first time.
  const src = `export i32 apply(fn[i32(i32)] f, i32 n) { return f(n); }\n`;
  const wasm = Uint8Array.from(emitFiles(["m.wac"], [src], "m.wac") as unknown as number[]);
  const wire = bindTypes(["m.wac"], [src], "m.wac");
  const path = await Deno.makeTempFile({ suffix: ".gen.ts" });
  await Deno.writeTextFile(
    path,
    generate(wasm, parseSigs(exportSigs(["m.wac"], [src], "m.wac")), parseBindTypes(wire), parseCallbacks(wire)),
  );
  try {
    // deno-lint-ignore no-explicit-any
    const g = await import(`file://${path}`) as Record<string, any>;
    const held: ((n: number) => number)[] = [];
    for (let i = 0; i < 16; i++) held.push((n: number) => n + i);
    for (const f of held) g.apply(f, 0);
    // Passing one already registered costs no slot, which is what the `indexOf` is for.
    for (const f of held) g.apply(f, 0);
    if (g.apply(held[3], 10) !== 13) throw new Error("a re-registered callback answered wrongly");
    let threw = "";
    try { g.apply((n: number) => n - 1, 0); } catch (e) { threw = (e as Error).message; }
    if (!threw.includes("16")) throw new Error(`a 17th callback gave ${threw || "no error"}`);
  } finally {
    await Deno.remove(path);
  }
});
