// wac-1, driven through every rung below it.
//
//   a wac-1 program (structs, arrays, wasm GC)
//     -> the wac-1 compiler, a wac-0 program
//       -> the wac-0 compiler, a wx program
//         -> the wx compiler, an sx program
//           -> sx, hand-written .wax
//             -> .wax, assembled, run
//
// Five languages and two interpreters. The compiler chain is built once and reused, because that
// part is seconds and the programs are milliseconds.

import { assemble } from "./assemble.ts";
import { wac0ToWax } from "./wac0.ts";

const root = new URL("..", import.meta.url).pathname;
const SRC = 2097152, OUT = 1572864;

let cached: WebAssembly.Module | null = null;

export async function wac1Compiler(): Promise<WebAssembly.Module> {
  if (cached === null) {
    const wax = await wac0ToWax(await Deno.readTextFile(`${root}boot/wac1.wac0`));
    cached = await WebAssembly.compile(assemble(wax).buffer as ArrayBuffer);
  }
  return cached;
}

export async function wac1ToWax(program: string): Promise<string> {
  const inst = await WebAssembly.instantiate(await wac1Compiler(), {});
  const memory = inst.exports.memory as WebAssembly.Memory;
  const bytes = new TextEncoder().encode(program);
  const u8 = new Uint8Array(memory.buffer);
  u8.set(bytes, SRC);
  u8[SRC + bytes.length] = 0;
  const len = (inst.exports.compile as (s: number, o: number) => number)(SRC, OUT);
  return new TextDecoder().decode(new Uint8Array(memory.buffer, OUT, len));
}

export async function wac1Run(program: string, entry = "main"): Promise<number> {
  const wax = await wac1ToWax(program);
  const mod = await WebAssembly.compile(assemble(wax).buffer as ArrayBuffer);
  const inst = await WebAssembly.instantiate(mod, {});
  return (inst.exports[entry] as () => number)();
}

if (import.meta.main) {
  const program = await Deno.readTextFile(Deno.args[0]);
  if (Deno.args.includes("--wax")) console.log(await wac1ToWax(program));
  else console.log(await wac1Run(program));
}
