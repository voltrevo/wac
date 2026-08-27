// `deno run -A ts/run.ts <file.l0>` — assemble and call `main`, printing what it answers.
//
// The short loop while writing .wax by hand. `ts/assemble_test.ts` is the one that has to pass;
// this is the one that tells you why it does not.

import { assemble } from "./assemble.ts";

if (Deno.args.length < 1) {
  console.error("usage: run.ts <file.l0>");
  Deno.exit(2);
}

const src = await Deno.readTextFile(Deno.args[0]);
let bytes: Uint8Array;
try {
  bytes = assemble(src);
} catch (e) {
  console.error(`wax: ${Deno.args[0]}: ${(e as Error).message}`);
  Deno.exit(1);
}

try {
  const mod = await WebAssembly.compile(bytes.buffer as ArrayBuffer);
  const inst = await WebAssembly.instantiate(mod, {});
  const main = inst.exports.main as undefined | (() => number);
  if (main === undefined) {
    console.error("the module exports no `main`");
    Deno.exit(1);
  }
  console.log(main());
} catch (e) {
  // A validation failure names a byte offset, which is no use for finding the line. The assembler
  // does not keep a map from bytes back to lines, and building one is work this experiment has not
  // needed yet — when it does, this is where it would be spent.
  console.error(`the engine refused the module: ${(e as Error).message}`);
  Deno.exit(1);
}
