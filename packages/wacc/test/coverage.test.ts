// Coverage instrumentation: a counter per branch point, and a table saying what each one is.
//
// The names are the reference's — `__cov_init`, `__cov_len`, `__cov_get` — so a consumer written
// against one compiler works against the other. The representation is ours: the counters live in a
// global `i32[]` rather than in linear memory, where the staging buffer already is.
//
// What is asserted here is what a coverage reader actually relies on: that a counter says how many
// times its point ran, that the table's `i`th row describes `__cov_get(i)`, and that a function
// nobody called is visible as such rather than as a body whose branches happened not to fire.

import { wacBind } from "../../../harness/wacBind.ts";
import { loadCorpus } from "./corpus.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emitFiles = mod.emitFiles as (p: string[], s: string[], e: string) => Uint8Array;
const emitCovered = mod.emitFilesCovered as (p: string[], s: string[], e: string) => Uint8Array;
const covTable = mod.covTableFiles as (p: string[], s: string[], e: string) => string;

const SRC = `export i32 classify(i32 n) {
  if (n > 10) { return 1; }
  i32 t = 0;
  for (i32 i = 0; i < n; i++) { t = t + i; }
  switch (n) { case 0: { return 100; } case 1: { return 200; } default: { return t; } }
}
export i32 nobodyCalls(i32 n) { return n; }
`;

Deno.test("coverage: a counter says how many times its point ran", () => {
  const bytes = Uint8Array.from(emitCovered(["m.wac"], [SRC], "m.wac") as unknown as number[]);
  if (bytes.length <= 8) throw new Error("the instrumented module was declined");
  const rows = covTable(["m.wac"], [SRC], "m.wac").trim().split("\n").map(l => l.split("\t"));
  const ex = new WebAssembly.Instance(
    new WebAssembly.Module(bytes as BufferSource), {},
  ).exports as Record<string, CallableFunction>;

  const len = ex.__cov_len() as number;
  if (len !== rows.length) throw new Error(`${len} counters and ${rows.length} table rows`);
  if (len < 6) throw new Error(`only ${len} points — the instrumentation is not reaching the branches`);

  /** The counts, keyed by `kind@line` so a test reads like the program. */
  const run = (f: string, arg: number): Map<string, number> => {
    (ex.__cov_init as CallableFunction)();
    (ex[f] as CallableFunction)(arg);
    const out = new Map<string, number>();
    for (let i = 0; i < len; i++) {
      out.set(`${rows[i][3]}@${rows[i][1]}#${i}`, ex.__cov_get(i) as number);
    }
    return out;
  };
  const kinds = rows.map(r => r[3]);
  const at = (m: Map<string, number>, kind: string, nth: number) => {
    let seen = 0;
    for (let i = 0; i < len; i++) {
      if (kinds[i] !== kind) continue;
      if (seen++ === nth) return m.get(`${rows[i][3]}@${rows[i][1]}#${i}`)!;
    }
    throw new Error(`no ${kind} point #${nth} — the table has ${kinds.join(", ")}`);
  };

  // Three arguments, three routes through one function.
  const three = run("classify", 3);
  const twenty = run("classify", 20);
  const zero = run("classify", 0);

  const wrong: string[] = [];
  // The early return: the `then` arm runs and nothing after it does.
  if (at(twenty, "then", 0) !== 1) wrong.push("classify(20) did not take the `then` arm");
  if (at(twenty, "loop", 0) !== 0) wrong.push("classify(20) entered the loop after returning");
  // A loop counter counts *iterations*, which is what makes it worth having.
  if (at(three, "loop", 0) !== 3) wrong.push(`classify(3) ran the loop ${at(three, "loop", 0)} times, wanted 3`);
  if (at(three, "then", 0) !== 0) wrong.push("classify(3) took the `then` arm");
  if (at(three, "else", 0) !== 1) wrong.push("classify(3) missed the `else` arm");
  // The arms of a switch are distinguishable from each other.
  if (at(zero, "case", 0) !== 1) wrong.push("classify(0) did not take the first case");
  if (at(three, "case", 0) !== 0) wrong.push("classify(3) took the first case");
  // A function nobody called has a point that never fires — the fact a "which lines ran" report is
  // built from, and the one a body-only instrumentation cannot state.
  const entries = kinds.filter(k => k === "entry").length;
  if (entries < 2) wrong.push(`${entries} entry points for two functions`);
  if (at(three, "entry", 1) !== 0) wrong.push("an uncalled function's entry point fired");

  if (wrong.length > 0) throw new Error(`${wrong.length} disagreement(s):\n  ${wrong.join("\n  ")}`);
});

Deno.test("coverage: instrumenting is opt-in, and the corpus is unchanged without it", async () => {
  const entries = await loadCorpus("packages/wacc/test/coverage.test.ts");
  const paths = entries.map(([name]) => name);
  const sources = entries.map(([, src]) => src);
  let compared = 0, instrumented = 0;
  const same: string[] = [];
  for (const [file] of entries.slice(0, 40)) {
    const plain = Uint8Array.from(emitFiles(paths, sources, file) as unknown as number[]);
    const cov = Uint8Array.from(emitCovered(paths, sources, file) as unknown as number[]);
    compared++;
    if (plain.length <= 8) continue;
    if (!WebAssembly.validate(cov)) throw new Error(`${file}: the instrumented module does not validate`);
    instrumented++;
    // The instrumented build must differ — a build that instruments nothing would pass every
    // assertion above by accident.
    if (cov.length === plain.length) same.push(file);
  }
  if (instrumented < 20) throw new Error(`only ${instrumented} modules were instrumented`);
  console.log(`    coverage: ${instrumented} of ${compared} modules instrumented and valid`);
  if (same.length > 0) throw new Error(`instrumenting changed nothing in:\n  ${same.slice(0, 5).join("\n  ")}`);
});
