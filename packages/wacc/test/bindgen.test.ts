// wacc's bindgen, used the only way that proves anything: generate the glue, import it, call it.
//
// The reference's generator is 1,011 lines and covers every type wac has; this covers the numbers,
// `bool`, `string` and the numeric arrays, and *says* what it declines rather than emitting glue
// that fails at run time. What it must never do is generate something that looks right and answers
// wrong, so the test here calls every generated function and compares against the wac program's own
// arithmetic.

import { wacBind } from "../../../harness/wacBind.ts";
import { generate, parseSigs, supported, unsupported } from "../tools/waccBindgen.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emitFiles = mod.emitFiles as (p: string[], s: string[], e: string) => Uint8Array;
const exportSigs = mod.exportSigsFiles as (p: string[], s: string[], e: string) => string;

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
`;
  const sigs = parseSigs(exportSigs(["m.wac"], [src], "m.wac"));
  const declined = unsupported(sigs);
  if (!sigs.some(s => s.name === "fine" && supported(s))) throw new Error("a scalar export was declined");
  if (declined.length !== 1 || !declined[0].startsWith("makeP")) {
    throw new Error(`declined ${JSON.stringify(declined)}, wanted just makeP`);
  }
  // And the glue that is generated holds only what it can honour — a caller reaching for `makeP`
  // gets a missing export at import time rather than a wrong answer at run time.
  const wasm = Uint8Array.from(emitFiles(["m.wac"], [src], "m.wac") as unknown as number[]);
  const source = generate(wasm, sigs);
  if (!source.includes("export function fine")) throw new Error("the supported export is missing");
  if (source.includes("export function makeP")) throw new Error("glue was generated for a struct return");
});
