// Point wac-L5 at real wac and see how far each entry point gets.
//
//   deno run -A ts/against_real_wac.ts ../wac/core ../wac/packages/wacc/src
//
// This is the only honest gauge of how far L5 is, and it is deliberately not a test: the number is
// expected to be wrong for a long time, and a test that fails every day is a test nobody reads.
//
// Each file is taken as an entry point and its whole import graph is flattened, because a wac file
// on its own is not a program — measuring them one at a time counts the same missing feature once
// per file that mentions it and never once as the thing that stopped a build.
//
// Four bars, because they fail differently: a refusal is a missing feature, an assembly error is a
// bad emission, a validation error is a type the compiler believed and the engine did not, and a
// module that validates is done.
//
// **The function count is in the row on purpose.** A file of nothing but generic declarations
// emits nothing at all and validates, which reads as success and is not one — `core/vec.wac` is
// 254 lines and two functions, because a template with no instantiation has no code in it.

import { flatten, l5ToL0 } from "./l5.ts";
import { assemble } from "../js/assemble.js";

const files: string[] = [];
for (const dir of Deno.args) {
  for (const e of Deno.readDirSync(dir)) {
    if (e.isFile && e.name.endsWith(".wac")) files.push(`${dir}/${e.name}`);
  }
}
files.sort();

let validated = 0;
let lines = 0;
for (const f of files) {
  const name = f.split("/").slice(-2).join("/");
  const say = (n: number, fns: string, what: string) =>
    console.log(`${name.padEnd(26)} ${String(n).padStart(6)} lines ${fns.padStart(5)} fn  ${what}`);
  let n = 0;
  try {
    const src = await flatten(f);
    n = src.split("\n").length;
    const l0 = await l5ToL0(src);
    const fns = String((l0.match(/^func /gm) ?? []).length);
    const refusals = (l0.match(/^!!/gm) ?? []).length;
    if (refusals > 0) {
      say(n, fns, `${refusals} refusal(s)`);
      lines += n;
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = assemble(l0);
    } catch (e) {
      say(n, fns, `wax: ${(e as Error).message.slice(0, 58)}`);
      lines += n;
      continue;
    }
    try {
      await WebAssembly.compile(bytes.buffer as ArrayBuffer);
      say(n, fns, `validates, ${bytes.length} bytes`);
      validated++;
    } catch (e) {
      say(n, fns, `engine: ${(e as Error).message.slice(0, 56)}`);
    }
    lines += n;
  } catch (e) {
    say(n, "-", (e as Error).message.slice(0, 64));
  }
}

console.log(`\n${validated} of ${files.length} entry points validate, over ${lines} lines flattened`);
