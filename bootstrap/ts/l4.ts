// wac-1, driven through every rung below it.
//
//   a wac-L4 program (structs, arrays, wasm GC)
//     -> the wac-L4 compiler, a wac-L3 program
//       -> the wac-L3 compiler, a wac-L2 program
//         -> the wac-L2 compiler, an sx program
//           -> sx, hand-written wac-L0
//             -> wac-L0, assembled, run
//
// Five languages and two interpreters. The compiler chain is built once and reused, because that
// part is seconds and the programs are milliseconds.

import { assemble } from "./assemble.ts";
import { l3ToL0 } from "./l3.ts";

const root = new URL("..", import.meta.url).pathname;
const SRC = 2097152, OUT = 1572864;

let cached: WebAssembly.Module | null = null;

export async function l4Compiler(): Promise<WebAssembly.Module> {
  if (cached === null) {
    const wax = await l3ToL0(await Deno.readTextFile(`${root}boot/l4.l3`));
    cached = await WebAssembly.compile(assemble(wax).buffer as ArrayBuffer);
  }
  return cached;
}

export async function l4ToL0(program: string): Promise<string> {
  const inst = await WebAssembly.instantiate(await l4Compiler(), {});
  const memory = inst.exports.memory as WebAssembly.Memory;
  const bytes = new TextEncoder().encode(program);
  const u8 = new Uint8Array(memory.buffer);
  u8.set(bytes, SRC);
  u8[SRC + bytes.length] = 0;
  const len = (inst.exports.compile as (s: number, o: number) => number)(SRC, OUT);
  return new TextDecoder().decode(new Uint8Array(memory.buffer, OUT, len));
}

export async function l4Run(program: string, entry = "main"): Promise<number> {
  const wax = await l4ToL0(program);
  const mod = await WebAssembly.compile(assemble(wax).buffer as ArrayBuffer);
  const inst = await WebAssembly.instantiate(mod, {});
  return (inst.exports[entry] as () => number)();
}

if (import.meta.main) {
  const program = await Deno.readTextFile(Deno.args[0]);
  if (Deno.args.includes("--wax")) console.log(await l4ToL0(program));
  else console.log(await l4Run(program));
}
