// `deno run -A ts/bench.ts <file.wac>` — the three phases of the ladder, timed apart.
//
// The counterpart to `ladder --bench`, printing the same table so the two hosts can be read side
// by side. Building the ladder is paid once per process; compiling and assembling are paid per
// program, and the assemble is not free — on a program the size of wacc it is the step that turns
// 183,861 lines of text into bytes.
//
// One cold run per process, and no averaging. The ladder is built from the interpreter on the
// first call and cached after, so a second run in the same process would measure the cache.

import { assemble } from "./assemble.ts";
import { l5Compiler } from "./l5.ts";

const SRC = 16777216, OUT = 4194304;

if (Deno.args.length < 1) {
  console.error("usage: bench.ts <file.wac>");
  Deno.exit(2);
}
const path = Deno.args[0];
const program = await Deno.readTextFile(path);

const t0 = performance.now();
const inst = await WebAssembly.instantiate(await l5Compiler(), {});
const built = performance.now() - t0;

const t1 = performance.now();
const memory = inst.exports.memory as WebAssembly.Memory;
const bytes = new TextEncoder().encode(program);
const u8 = new Uint8Array(memory.buffer);
u8.set(bytes, SRC);
u8[SRC + bytes.length] = 0;
const len = (inst.exports.compile as (s: number, o: number) => number)(SRC, OUT);
const l0 = new TextDecoder().decode(new Uint8Array(memory.buffer, OUT, len));
const compiled = performance.now() - t1;

const t2 = performance.now();
const wasm = assemble(l0);
const assembled = performance.now() - t2;

const ms = (n: number) => String(Math.round(n)).padStart(6);
console.log(`host                    deno`);
console.log(`input                   ${path}`);
console.log(`                        ${program.split("\n").length - 1} lines of wac`);
console.log();
console.log(`build the ladder        ${ms(built)} ms   l1.l0 -> L2 -> L3 -> L4 -> L5, assembled and instantiated`);
console.log(`compile to wac-L0       ${ms(compiled)} ms   ${l0.split("\n").length - 1} lines out`);
console.log(`assemble to wasm        ${ms(assembled)} ms   ${wasm.length} bytes`);
console.log(`                        ---------`);
console.log(`total                   ${ms(built + compiled + assembled)} ms`);
