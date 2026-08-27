// wac-L5, driven through every rung below it.
//
//   a wac program
//     -> the L5 compiler, an L4 program
//       -> the L4 compiler, an L3 program
//         -> the L3 compiler, an L2 program
//           -> the L2 compiler, an L1 program
//             -> L1, hand-written wac-L0
//               -> wac-L0, assembled, run
//
// Six languages and two interpreters, and nothing in the path that was not built here.

import { assemble } from "./assemble.ts";
import { l4ToL0 } from "./l4.ts";

const root = new URL("..", import.meta.url).pathname;
const SRC = 2097152, OUT = 1572864;

let cached: WebAssembly.Module | null = null;

export async function l5Compiler(): Promise<WebAssembly.Module> {
  if (cached === null) {
    const l0 = await l4ToL0(await Deno.readTextFile(`${root}boot/l5.l4`));
    cached = await WebAssembly.compile(assemble(l0).buffer as ArrayBuffer);
  }
  return cached;
}

export async function l5ToL0(program: string): Promise<string> {
  const inst = await WebAssembly.instantiate(await l5Compiler(), {});
  const memory = inst.exports.memory as WebAssembly.Memory;
  const bytes = new TextEncoder().encode(program);
  const u8 = new Uint8Array(memory.buffer);
  u8.set(bytes, SRC);
  u8[SRC + bytes.length] = 0;
  const len = (inst.exports.compile as (s: number, o: number) => number)(SRC, OUT);
  return new TextDecoder().decode(new Uint8Array(memory.buffer, OUT, len));
}

export async function l5Run(program: string, entry = "main"): Promise<number> {
  const l0 = await l5ToL0(program);
  const mod = await WebAssembly.compile(assemble(l0).buffer as ArrayBuffer);
  const inst = await WebAssembly.instantiate(mod, {});
  return (inst.exports[entry] as () => number)();
}

if (import.meta.main) {
  const program = await Deno.readTextFile(Deno.args[0]);
  if (Deno.args.includes("--l0")) console.log(await l5ToL0(program));
  else console.log(await l5Run(program));
}
