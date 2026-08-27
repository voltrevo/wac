// The second rung, driven end to end.
//
//   a wac-L2 program (s-expressions)
//     -> sx, interpreting boot/l2.l1, which is itself wac-L1 source
//       -> wac-L0 assembly text, read back out of wac-L1's linear memory
//         -> the assembler
//           -> wasm
//
// Nothing here compiles anything. Every step is either the hand-written interpreter or the
// dual-implemented assembler, which is the property the ladder is for.

import { assemble } from "./assemble.ts";

const root = new URL("..", import.meta.url).pathname;

let sxModule: WebAssembly.Module | null = null;

async function sx(): Promise<WebAssembly.Module> {
  if (sxModule === null) {
    const src = await Deno.readTextFile(`${root}boot/l1.l0`);
    sxModule = await WebAssembly.compile(assemble(src).buffer as ArrayBuffer);
  }
  return sxModule;
}

/** Run wac-L1 source, and read back the NUL-terminated text at the address it answers. */
export async function l1Text(source: string): Promise<string> {
  const inst = await WebAssembly.instantiate(await sx(), {});
  const memory = inst.exports.memory as WebAssembly.Memory;
  const AT = 8192;
  const bytes = new TextEncoder().encode(source);
  new Uint8Array(memory.buffer).set(bytes, AT);
  new Uint8Array(memory.buffer)[AT + bytes.length] = 0;

  const answer = (inst.exports.run_at as (at: number) => number)(AT);

  // **After the call, not before.** `$alloc` grows the memory, and growing detaches the buffer this
  // was read from — a view taken earlier is empty by the time there is anything to read through it.
  const out = new Uint8Array(memory.buffer);
  let end = answer;
  while (end < out.length && out[end] !== 0) end++;
  return new TextDecoder().decode(out.subarray(answer, end));
}

/** Compile a wac-L2 program to .wax by running the wac-L2 compiler under wac-L1. */
export async function l2ToL0(program: string): Promise<string> {
  const compiler = await Deno.readTextFile(`${root}boot/l2.l1`);
  return await l1Text(`${compiler}\n(compile (quote (${program})))\n`);
}

/** ...and all the way to an answer. */
export async function l2Run(program: string): Promise<number> {
  const wax = await l2ToL0(program);
  const mod = await WebAssembly.compile(assemble(wax).buffer as ArrayBuffer);
  const inst = await WebAssembly.instantiate(mod, {});
  return (inst.exports.main as () => number)();
}

if (import.meta.main) {
  if (Deno.args.length < 1) {
    console.error("usage: l2.ts <file.l2> [--wax]");
    Deno.exit(2);
  }
  const program = await Deno.readTextFile(Deno.args[0]);
  const wax = await l2ToL0(program);
  if (Deno.args.includes("--wax")) {
    console.log(wax);
  } else {
    const mod = await WebAssembly.compile(assemble(wax).buffer as ArrayBuffer);
    const inst = await WebAssembly.instantiate(mod, {});
    console.log((inst.exports.main as () => number)());
  }
}
