// Binary search for the smallest prefix that fails, cutting only at top-level boundaries.
//
// **The boundary finder has to lex.** Counting braces over raw text counts the ones inside `"{"` and
// `'}'` and block comments, and this file has enough of them to end six deep — which made an earlier
// version of this test the first 4% of the file and call it the whole thing.
//   deno run -A ts/bisect_real_wac.ts <flattened.wac>
//
// Answers the smallest prefix that wac-L5 will not compile, which is the fastest way from "a real
// file fails" to "this construct is missing". Pair it with `ts/against_real_wac.ts`, which counts.

import { l5ToL0 } from "./l5.ts";

const text = await Deno.readTextFile(Deno.args[0]);
const stops: number[] = [];
let depth = 0, line = 1;
for (let i = 0; i < text.length; i++) {
  const c = text[i];
  if (c === "\n") { line++; if (depth === 0) stops.push(line - 1); continue; }
  if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; i--; continue; }
  if (c === "/" && text[i + 1] === "*") {
    i += 2;
    while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) { if (text[i] === "\n") line++; i++; }
    i++; continue;
  }
  if (c === '"' || c === "'") {
    const q = c; i++;
    while (i < text.length && text[i] !== q) { if (text[i] === "\\") i++; if (text[i] === "\n") line++; i++; }
    continue;
  }
  if (c === "{") depth++;
  else if (c === "}") depth--;
}
const lines = text.split("\n");
console.log(`${lines.length} lines, ${stops.length} boundaries, last at ${stops[stops.length - 1]}`);

const ok = async (st: number) => {
  try { const l0 = await l5ToL0(lines.slice(0, st).join("\n"));
        return !l0.split("\n").some((x) => x.startsWith("!!")); }
  catch { return false; }
};
if (await ok(stops[stops.length - 1])) { console.log("the whole file compiles with no refusal"); Deno.exit(0); }
let lo = 0, hi = stops.length - 1;
while (lo < hi) {
  const mid = (lo + hi) >> 1;
  if (await ok(stops[mid])) lo = mid + 1; else hi = mid;
}
const bad = stops[lo], good = lo > 0 ? stops[lo - 1] : 0;
console.log(`smallest failing prefix ends at line ${bad}; ${good} is fine`);
console.log(lines.slice(good, Math.min(bad, good + 18)).join("\n").slice(0, 900));
