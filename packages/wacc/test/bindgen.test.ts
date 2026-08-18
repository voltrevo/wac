// wacc's bindgen, used the only way that proves anything: generate the glue, import it, call it.
//
// The reference's generator is 1,011 lines and covers every type wac has; this covers the numbers,
// `bool`, `string` and the numeric arrays, and *says* what it declines rather than emitting glue
// that fails at run time. What it must never do is generate something that looks right and answers
// wrong, so the test here calls every generated function and compares against the wac program's own
// arithmetic.

import { wacBind } from "../../../harness/wacBind.ts";
import {
  generate, parseBindTypes, parseCallbacks, parseOutRefs, parseSigs, supported, unsupported,
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

/**
 * A callback that itself takes a wac function — the case the reference covers and this did not.
 *
 * `higher(fn[i32(fn[i32(i32)])] h)` hands JavaScript a *function* it must be able to call. The
 * reference's generator does it by handing over the funcref's slot and wrapping it:
 * `$cbs1[$slot](((_f) => (a0) => $exports.$bind$callref_0(_f, a0))(a0))`, so what crosses is a handle
 * and a call back into the module, not a WasmGC reference — which is what `design/lang/0002` gave as
 * the reason this could not be done.
 *
 * **Asserted by calling it, not by reading the glue.** Glue that exists and answers wrong is the one
 * outcome this whole file is written to prevent, so the JavaScript side receives the wac function,
 * calls it with 41, and the answer has to be what the wac program computes.
 */
Deno.test("bindgen: a callback that takes a wac function crosses, and the function it is handed works", async () => {
  const src = `export i32 higher(fn[i32(fn[i32(i32)])] h) { return h(inc); }
i32 inc(i32 a) { return a + 1; }
`;
  const wasm = Uint8Array.from(emitFiles(["m.wac"], [src], "m.wac") as unknown as number[]);
  if (wasm.length <= 8) throw new Error("the module was declined");
  const sigs = parseSigs(exportSigs(["m.wac"], [src], "m.wac"));
  const wire = bindTypes(["m.wac"], [src], "m.wac");
  const types = parseBindTypes(wire);
  const cbs = parseCallbacks(wire);
  const outs = parseOutRefs(wire);
  const declined = unsupported(sigs, types, cbs, outs);
  if (declined.length > 0) throw new Error(`declined ${JSON.stringify(declined)}`);

  const source = generate(wasm, sigs, types, cbs, outs);
  const path = await Deno.makeTempFile({ suffix: ".gen.ts" });
  await Deno.writeTextFile(path, source);
  try {
    const glue = await import(`file://${path}`) as Record<string, CallableFunction>;
    // `h` is called by the wac program with `inc`; `f` here is that wac function, seen from
    // JavaScript. 41 + 1 = 42, and every part of the chain has to work for that to come back.
    const got = glue.higher((f: (n: number) => number) => f(41));
    if (String(got) !== "42") throw new Error(`higher answered ${got}, wanted 42`);
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("bindgen: what it cannot bind is named, not silently skipped", () => {
  const src = `struct P { i32 x; }
export i32 fine(i32 n) { return n; }
export P makeP(i32 n) { return P(n); }
export i32 viaCallback(fn[i32(i32)] cb) { return cb(1); }
export fn[i32(i32)] handOut() { return fine; }
export i32 higher(fn[i32(fn[i32(i32)])] h) { return 0; }
`;
  const sigs = parseSigs(exportSigs(["m.wac"], [src], "m.wac"));
  const wire = bindTypes(["m.wac"], [src], "m.wac");
  const types = parseBindTypes(wire);
  const cbs = parseCallbacks(wire);
  const outs = parseOutRefs(wire);
  const declined = unsupported(sigs, types, cbs, outs);
  if (!sigs.some(s => s.name === "fine" && supported(s, types, cbs, outs))) {
    throw new Error("a scalar export was declined");
  }
  // A struct crosses, a callback crosses in, a funcref crosses out, and since 2026-08-18 a funcref
  // *nested* inside a callback's signature crosses too — the test above calls one. So nothing in this
  // program is declined, and that is asserted rather than assumed: this file's rule is that what
  // cannot be bound is *named*, and an empty list has to be the truth rather than a list nobody built.
  if (declined.length !== 0) {
    throw new Error(`declined ${JSON.stringify(declined)}, wanted nothing`);
  }
  // The shape that is still declined, kept here because "nothing is declined" is a claim that needs a
  // boundary: a callback that *returns* a wac function is JavaScript handing one in, which needs a
  // registration this generator does not write. `unsupported` must still say so.
  const retSrc = `export i32 backwards(fn[fn[i32(i32)](i32)] h) { return 0; }\n`;
  const retSigs = parseSigs(exportSigs(["r.wac"], [retSrc], "r.wac"));
  const retWire = bindTypes(["r.wac"], [retSrc], "r.wac");
  const retDeclined = unsupported(
    retSigs, parseBindTypes(retWire), parseCallbacks(retWire), parseOutRefs(retWire),
  );
  if (retDeclined.length !== 1 || !retDeclined[0].startsWith("backwards")) {
    throw new Error(`a callback returning a funcref should be declined, got ${JSON.stringify(retDeclined)}`);
  }
  // And the glue that is generated holds only what it can honour — a caller reaching for `makeP`
  // gets a missing export at import time rather than a wrong answer at run time.
  const wasm = Uint8Array.from(emitFiles(["m.wac"], [src], "m.wac") as unknown as number[]);
  const source = generate(wasm, sigs, types, cbs, outs);
  if (!source.includes("export function fine")) throw new Error("the supported export is missing");
  if (!source.includes("export function viaCallback")) throw new Error("a callback parameter was declined");
  if (!source.includes("export function handOut")) throw new Error("a funcref return was declined");
  if (!source.includes("export function higher")) throw new Error("a nested funcref was declined");
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
    // A getter, not a method — the reference's generator writes one, and a caller reads
    // `c.Circle_r`. This asserted the method form and so pinned the defect [issue 0102].
    eq("its payload", c.Circle_r, 2.5);
    eq("radius(c)", g.radius(c), 2.5);
    eq("Shape.Empty().tag", g.Shape.Empty().tag, "Empty");
    eq("a string payload", g.Shape.Named("hi").Named_what, "hi");
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

Deno.test("bindgen: a wac function crosses out as a closure, and back in as a callback", async () => {
  const src = `i32 double(i32 n) { return n * 2; }
i32 negate(i32 n) { return 0 - n; }
export fn[i32(i32)] pick(bool d) { return d ? double : negate; }
export i32 twice(fn[i32(i32)] cb) { return cb(1) + cb(2); }
`;
  const wasm = Uint8Array.from(emitFiles(["m.wac"], [src], "m.wac") as unknown as number[]);
  const wire = bindTypes(["m.wac"], [src], "m.wac");
  const outs = parseOutRefs(wire);
  if (outs.length !== 1) throw new Error(`${outs.length} handed-out signatures, wanted 1`);

  const path = await Deno.makeTempFile({ suffix: ".gen.ts" });
  await Deno.writeTextFile(
    path,
    generate(
      wasm, parseSigs(exportSigs(["m.wac"], [src], "m.wac")), parseBindTypes(wire),
      parseCallbacks(wire), outs,
    ),
  );
  try {
    // deno-lint-ignore no-explicit-any
    const g = await import(`file://${path}`) as Record<string, any>;
    const wrong: string[] = [];
    const eq = (what: string, got: unknown, want: unknown) => {
      if (String(got) !== String(want)) wrong.push(`${what}: ${got}, wanted ${want}`);
    };
    eq("pick(true)(21)", g.pick(true)(21), 42);
    eq("pick(false)(21)", g.pick(false)(21), -21);
    // The round trip: out through `callref` as a closure, back in through the slot table. Neither
    // direction knows about the other, which is why this is the case worth keeping.
    eq("twice(pick(true))", g.twice(g.pick(true)), 6);
    eq("twice(pick(false))", g.twice(g.pick(false)), -3);
    if (wrong.length > 0) throw new Error(`${wrong.length} wrong answer(s):\n  ${wrong.join("\n  ")}`);
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("bindgen: two modules each declaring an S cross as two classes — 0100", async () => {
  // The type names in this metadata are the emitter's *keys*: `S` for the first declaration of a
  // name and `S@2` for a second one in another file. Both are wrong for a host — `S` means either
  // of them and `S@2` is not a name TypeScript can declare, so the glue held `export class S@2`
  // and the file did not parse. Neither compiler's corpus contains this shape, which is why it was
  // reported from outside as GitHub wac#9.
  const paths = ["a.wac", "b.wac", "main.wac"];
  const sources = [
    `export struct S { i32 x; }\nexport S mkA() { return S(1); }\n`,
    `export struct S { i32 y; i32 z; }\nexport S mkB() { return S(2, 3); }\n`,
    `import { S as SA, mkA } from "./a.wac";\n` +
    `import { S as SB, mkB } from "./b.wac";\n` +
    `export SA a() { return mkA(); }\n` +
    `export SB b() { return mkB(); }\n`,
  ];
  const wasm = Uint8Array.from(emitFiles(paths, sources, "main.wac") as unknown as number[]);
  const sigs = parseSigs(exportSigs(paths, sources, "main.wac"));
  const wire = bindTypes(paths, sources, "main.wac");
  const declined = unsupported(sigs, parseBindTypes(wire));
  if (declined.length > 0) throw new Error(`declined: ${declined.join("; ")}`);
  const path = await Deno.makeTempFile({ suffix: ".gen.ts" });
  await Deno.writeTextFile(path, generate(wasm, sigs, parseBindTypes(wire)));
  try {
    // deno-lint-ignore no-explicit-any
    const g = await import(`file://${path}`) as Record<string, any>;
    const av = g.a(), bv = g.b();
    if (av.x !== 1) throw new Error(`a() gave x=${av.x}`);
    if (bv.y !== 2 || bv.z !== 3) throw new Error(`b() gave ${bv.y},${bv.z}`);
    // Each is the class for *its* struct. A single class named `S` would answer for both, which is
    // the wrong answer this is here to rule out rather than the parse error above it.
    if (av.constructor === bv.constructor) throw new Error("both came back as one class");
  } finally {
    await Deno.remove(path);
  }
});
