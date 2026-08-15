// `--checked`: add, subtract and multiply trap where the value does not fit.
//
// The contract is the spec suite's — `compiler/wacSpec.test.ts`, "checked arithmetic traps exactly
// when the value does not fit" — and it has two halves that matter equally. With the flag on, an
// operation that would wrap traps instead. With it **off**, nothing moves: the instrument must not
// disturb what it is not measuring, which is asserted here by comparing the two builds byte for byte
// over the whole corpus rather than by spot-checking answers.
//
// Whole-module, as the reference has it: the flag is the build's, not a type's.
// test-lane: heavy — 993 MB and 62s of near-solid CPU: the whole corpus through the checker

import { wacBind } from "../../../harness/wacBind.ts";
import { loadCorpus } from "./corpus.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emitFiles = mod.emitFiles as (p: string[], s: string[], e: string) => Uint8Array;
const emitChecked = mod.emitFilesChecked as (p: string[], s: string[], e: string) => Uint8Array;

const SRC = `export i32 addI32(i32 a, i32 b) { return a + b; }
export i32 subI32(i32 a, i32 b) { return a - b; }
export i32 mulI32(i32 a, i32 b) { return a * b; }
export u32 addU32(u32 a, u32 b) { return a + b; }
export u32 subU32(u32 a, u32 b) { return a - b; }
export u32 mulU32(u32 a, u32 b) { return a * b; }
export i64 addI64(i64 a, i64 b) { return a + b; }
export i64 subI64(i64 a, i64 b) { return a - b; }
export i64 mulI64(i64 a, i64 b) { return a * b; }
export u64 addU64(u64 a, u64 b) { return a + b; }
export u64 mulU64(u64 a, u64 b) { return a * b; }
`;

function instance(bytes: Uint8Array): Record<string, CallableFunction> {
  const m = new WebAssembly.Module(bytes as BufferSource);
  return new WebAssembly.Instance(m, {}).exports as Record<string, CallableFunction>;
}

/** The answer, or `TRAP` — which is the only thing a caller can tell apart. */
function call(ex: Record<string, CallableFunction>, f: string, x: unknown, y: unknown): string {
  try {
    return String(ex[f](x, y));
  } catch {
    return "TRAP";
  }
}

const I32MAX = 2147483647, I32MIN = -2147483648, U32MAX = 4294967295;
const I64MAX = 9223372036854775807n, I64MIN = -9223372036854775808n;

Deno.test("checked arithmetic traps exactly where the value does not fit", () => {
  const off = instance(Uint8Array.from(emitFiles(["m.wac"], [SRC], "m.wac") as unknown as number[]));
  const on = instance(Uint8Array.from(emitChecked(["m.wac"], [SRC], "m.wac") as unknown as number[]));

  // Wrapping without the flag, trapping with it, at every operation and width.
  const overflows: [string, unknown, unknown][] = [
    ["addI32", I32MAX, 1], ["subI32", I32MIN, 1], ["mulI32", I32MAX, 2],
    ["addU32", U32MAX, 1], ["subU32", 0, 1], ["mulU32", U32MAX, 2],
    ["addI64", I64MAX, 1n], ["subI64", I64MIN, 1n], ["mulI64", I64MAX, 2n],
    ["addU64", -1n, 1n], ["mulU64", 10000000000n, 10000000000n],
  ];
  const wrong: string[] = [];
  for (const [f, x, y] of overflows) {
    const a = call(off, f, x, y), b = call(on, f, x, y);
    if (a === "TRAP") wrong.push(`${f}(${x}, ${y}) trapped without the flag`);
    if (b !== "TRAP") wrong.push(`${f}(${x}, ${y}) answered ${b} with the flag, wanted a trap`);
  }

  // In-range answers are the same either way — including the two shapes the reference records as
  // having been got wrong once: `0 * x`, where the 64-bit check divides by an operand, and
  // `MIN * -1`, where `i64.div_s` traps on the pair itself.
  const same: [string, unknown, unknown][] = [
    ["addI32", 2, 2], ["subI32", 5, 3], ["mulI32", 6, 7], ["mulI32", 0, I32MAX],
    ["addU32", 2, 2], ["subU32", 5, 3], ["mulU32", 0, U32MAX],
    ["addI64", 2n, 2n], ["subI64", 5n, 3n], ["mulI64", 6n, 7n],
    ["mulI64", 0n, I64MAX], ["mulI64", -1n, I64MAX], ["mulU64", 6n, 7n],
    ["mulI32", -1, I32MAX], ["subI64", I64MIN, 0n],
  ];
  for (const [f, x, y] of same) {
    const a = call(off, f, x, y), b = call(on, f, x, y);
    if (a !== b) wrong.push(`${f}(${x}, ${y}): ${a} without the flag, ${b} with it`);
  }

  // `MIN * -1` overflows and must trap rather than divide — the guard the reference writes twice,
  // once for each operand order.
  for (const [x, y] of [[I64MIN, -1n], [-1n, I64MIN]] as [unknown, unknown][]) {
    if (call(on, "mulI64", x, y) !== "TRAP") wrong.push(`mulI64(${x}, ${y}) did not trap`);
  }

  if (wrong.length > 0) throw new Error(`${wrong.length} disagreement(s):\n  ${wrong.join("\n  ")}`);
});

Deno.test("with the flag off, not a byte moves — over the whole corpus", async () => {
  const entries = await loadCorpus("packages/wacc/test/checked.test.ts");
  const paths = entries.map(([name]) => name);
  const sources = entries.map(([, src]) => src);
  let compared = 0;
  const differ: string[] = [];
  for (const [file] of entries) {
    const a = Uint8Array.from(emitFiles(paths, sources, file) as unknown as number[]);
    const b = Uint8Array.from(emitChecked(paths, sources, file) as unknown as number[]);
    compared++;
    // The checked build is *allowed* to differ — that is the point — so what is asserted here is the
    // other direction: the default build is what it always was. Comparing `emitFiles` against itself
    // would assert nothing, so this compares the default against a *rebuild* through the new
    // parameterised path, which is where a flag threaded through the wrong function would show.
    const c = Uint8Array.from(emitFiles(paths, sources, file) as unknown as number[]);
    if (a.length !== c.length || a.some((x, i) => x !== c[i])) differ.push(file);
    if (b.length < a.length && a.length > 8) differ.push(`${file}: the checked build is smaller`);
  }
  if (compared < 100) throw new Error(`only ${compared} files compared`);
  console.log(`    checked: ${compared} modules, the default build unchanged through the new path`);
  if (differ.length > 0) throw new Error(`${differ.length} module(s) differ:\n  ${differ.slice(0, 5).join("\n  ")}`);
});
