// wac-0, driven through every rung below it.
//
//   a wac-L3 program (C-family text)
//     -> the wac-L3 compiler, which is a wac-L2 program
//       -> compiled by the wac-L2 compiler, which is an sx program
//         -> run by sx, which is hand-written wac-L0
//           -> wac-L0, assembled, run
//
// Four languages and two interpreters between the source and the answer, and nothing in the path
// that was not built here.

import { assemble } from "./assemble.ts";
import { l2ToL0 } from "./l2.ts";

const root = new URL("..", import.meta.url).pathname;
const SRC = 2097152, OUT = 1572864;

let cached: WebAssembly.Module | null = null;

/** The wac-L3 compiler, itself compiled — once, because that is the slow part. */
export async function l3Compiler(): Promise<WebAssembly.Module> {
  if (cached === null) {
    const wax = await l2ToL0(await Deno.readTextFile(`${root}boot/l3.l2`));
    cached = await WebAssembly.compile(assemble(wax).buffer as ArrayBuffer);
  }
  return cached;
}

export async function l3ToL0(program: string): Promise<string> {
  const inst = await WebAssembly.instantiate(await l3Compiler(), {});
  const memory = inst.exports.memory as WebAssembly.Memory;
  const bytes = new TextEncoder().encode(program);
  const u8 = new Uint8Array(memory.buffer);
  u8.set(bytes, SRC);
  u8[SRC + bytes.length] = 0;
  const len = (inst.exports.compile as (s: number, o: number) => number)(SRC, OUT);
  return new TextDecoder().decode(new Uint8Array(memory.buffer, OUT, len));
}

export async function l3Run(program: string, entry = "main"): Promise<number> {
  const wax = await l3ToL0(program);
  const mod = await WebAssembly.compile(assemble(wax).buffer as ArrayBuffer);
  const inst = await WebAssembly.instantiate(mod, {});
  return (inst.exports[entry] as () => number)();
}

if (import.meta.main) {
  const program = await Deno.readTextFile(Deno.args[0]);
  if (Deno.args.includes("--wax")) console.log(await l3ToL0(program));
  else console.log(await l3Run(program));
}
