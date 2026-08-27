// Point wac-L5 at real wac and count what it refuses.
//
//   deno run -A ts/against_real_wac.ts ../wac/core ../wac/packages/wacc/src
//
// This is the only honest gauge of how far L5 is, and it is deliberately not a test: the number is
// expected to be wrong for a long time, and a test that fails every day is a test nobody reads.
// Three bars, because they fail differently — a refusal is a missing feature, an assembly error is
// a bad emission, and a validation error is a type the compiler believed and the engine did not.

import { l5ToL0 } from "./l5.ts";
import { assemble } from "./assemble.ts";

const files: string[] = [];
for (const dir of Deno.args) {
  for (const e of Deno.readDirSync(dir)) {
    if (e.isFile && e.name.endsWith(".wac")) files.push(`${dir}/${e.name}`);
  }
}
files.sort();

let parsed = 0, assembled = 0, validated = 0;
const failures: string[] = [];
for (const f of files) {
  const src = await Deno.readTextFile(f);
  const lines = src.split("\n").length;
  let l0 = "";
  try { l0 = await l5ToL0(src); }
  catch (e) { failures.push(`${f} (${lines}L) compile: ${(e as Error).message.split("\n")[0].slice(0, 54)}`); continue; }
  const marks = l0.split("\n").filter((x) => x.startsWith("!!")).length;
  if (marks > 0) { failures.push(`${f} (${lines}L) ${marks} refusal(s)`); continue; }
  parsed++;
  let bytes: Uint8Array;
  try { bytes = assemble(l0); } catch (e) {
    failures.push(`${f} (${lines}L) assemble: ${(e as Error).message.slice(0, 54)}`); continue;
  }
  assembled++;
  try { await WebAssembly.compile(bytes.buffer as ArrayBuffer); validated++; }
  catch (e) { failures.push(`${f} (${lines}L) validate: ${(e as Error).message.split("\n")[0].slice(0, 50)}`); }
}
console.log(`${files.length} real wac files`);
console.log(`  parsed with no refusal   ${parsed}`);
console.log(`  assembled                ${assembled}`);
console.log(`  validated as wasm        ${validated}`);
if (failures.length) { console.log("\nfirst failures:"); for (const f of failures.slice(0, 12)) console.log("  " + f); }
