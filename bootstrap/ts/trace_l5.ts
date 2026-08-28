// `deno run -A ts/trace_l5.ts <file.wac>` — when *the compiler* traps, say where in `bootstrap/boot/l5.l4`.
//
// `bootstrap/ts/run_real_wac.ts` names the frames of a program wac-L5 built. This names the frames of
// wac-L5 itself, which is the case that had no instrument: a trap inside the compiler arrives as
// `array element access out of bounds` and eight anonymous wasm frames, which says nothing about
// which array, which table, or which line of the rung.
//
// The trick is the same either way. The compiler is wac-L0 text before it is a module, so
// `assembleMapped` can hand back a map from byte offset to line — and a trap's stack is byte
// offsets. The wac-L0 line then names the function, and `bootstrap/boot/l5.l4` is one search away.

import { l4ToL0 } from "./l4.ts";
import { flatten } from "./l5.ts";
import { assembleMapped } from "../js/assemble.js";

if (Deno.args.length < 1) {
  console.error("usage: trace_l5.ts <file.wac>");
  Deno.exit(2);
}

const root = new URL("..", import.meta.url).pathname;
const SRC = 16777216, OUT = 4194304;

const l0 = await l4ToL0(await Deno.readTextFile(`${root}boot/l5.l4`));
const lines = l0.split("\n");
const { bytes, map } = assembleMapped(l0);
console.log(`wac-L5 is ${lines.length} lines of wac-L0, ${bytes.length} bytes`);

const fnAt = (line: number): string => {
  for (let i = line - 1; i >= 0; i--) if (lines[i].startsWith("func ")) return lines[i].split(" ")[1];
  return "?";
};
const lineAt = (off: number): number => {
  let best = map[0]?.line ?? 0;
  for (const k of map) if (k.at <= off) best = k.line;
  return best;
};

const inst = await WebAssembly.instantiate(
  await WebAssembly.compile(bytes.buffer as ArrayBuffer),
  {},
);
const memory = inst.exports.memory as WebAssembly.Memory;
const program = await flatten(Deno.args[0]);
const src = new TextEncoder().encode(program);
const u8 = new Uint8Array(memory.buffer);
u8.set(src, SRC);
u8[SRC + src.length] = 0;

try {
  const len = (inst.exports.compile as (s: number, o: number) => number)(SRC, OUT);
  console.log(`no trap: ${len} bytes of wac-L0 out`);
} catch (e) {
  const err = e as Error;
  console.log(`\nthe compiler trapped: ${err.message}\n`);
  const frames = [...(err.stack ?? "").matchAll(/wasm-function\[\d+\]:(0x[0-9a-f]+)/g)];
  console.log(`${frames.length} frames, innermost first:`);
  for (const f of frames.slice(0, 12)) {
    const line = lineAt(parseInt(f[1], 16));
    console.log(`  ${f[1].padStart(9)}  ${fnAt(line).padEnd(28)} wac-L0 line ${line}`);
  }
}
