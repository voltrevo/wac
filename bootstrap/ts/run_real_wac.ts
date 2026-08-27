// `deno run -A ts/run_real_wac.ts <entry.wac> <driver.wac>` — compile a real wac program with
// wac-L5, run it, and when it traps say where in the wac-L0 the frames are.
//
// The stage after validating. A module the engine accepts can still be wrong, and the only way to
// find out is to run it: this is the oracle the whole ladder is aimed at, because a compiler that
// produces a module nobody runs has not been checked against anything.
//
// The driver is concatenated after the entry's flattened graph and supplies `main`. It cannot be
// handed bytes from outside — wasm GC arrays are not constructible from JavaScript — so it embeds
// what it wants to compile as a string literal and answers a number.

import { flatten, l5ToL0 } from "./l5.ts";
import { assembleMapped } from "./assemble.ts";

if (Deno.args.length < 2) {
  console.error("usage: run_real_wac.ts <entry.wac> <driver.wac>");
  Deno.exit(2);
}

const src = await flatten(Deno.args[0]) + "\n" + await Deno.readTextFile(Deno.args[1]);
const l0 = await l5ToL0(src);
const lines = l0.split("\n");
const refusals = (l0.match(/^!!/gm) ?? []).length;
console.log(`${lines.length} lines of wac-L0, ${refusals} refusal(s)`);
if (refusals > 0) Deno.exit(1);

const { bytes, map } = assembleMapped(l0);
console.log(`${bytes.length} bytes`);

// Which function a wac-L0 line is inside, for naming a frame.
const fnAt = (line: number): string => {
  for (let i = line - 1; i >= 0; i--) if (lines[i].startsWith("func ")) return lines[i].split(" ")[1];
  return "?";
};
const lineAt = (off: number): number => {
  let best = map[0]?.line ?? 0;
  for (const k of map) if (k.at <= off) best = k.line;
  return best;
};

const mod = await WebAssembly.compile(bytes.buffer as ArrayBuffer);
const inst = await WebAssembly.instantiate(mod, {});
const main = inst.exports.main as undefined | (() => number);
if (main === undefined) {
  console.error("the driver exports no `main`");
  Deno.exit(1);
}

const started = performance.now();
try {
  const answer = main();
  console.log(`main() = ${answer}   (${Math.round(performance.now() - started)} ms)`);

  // If the driver hands bytes back one at a time, they are a module — so run it. This is the
  // only check here that is not about wac-L5 at all: it asks whether what the *compiled
  // compiler* produced is a program, which no amount of validating the outer module can say.
  const byteAt = inst.exports.byteAt as undefined | ((i: number) => number);
  if (byteAt !== undefined && answer > 0) {
    const inner = new Uint8Array(answer);
    for (let i = 0; i < answer; i++) inner[i] = byteAt(i);
    console.log(`\nthe module it built is ${inner.length} bytes`);
    try {
      const m2 = await WebAssembly.compile(inner.buffer as ArrayBuffer);
      const i2 = await WebAssembly.instantiate(m2, {});
      const names = Object.keys(i2.exports);
      const f = i2.exports.answer as undefined | (() => number);
      console.log(`it exports ${names.join(", ")}`);
      if (f !== undefined) console.log(`and its answer() answers ${f()}`);
    } catch (e2) {
      console.log(`the engine refused it: ${(e2 as Error).message.slice(0, 160)}`);
    }
  }
} catch (e) {
  const err = e as Error;
  console.log(`trapped: ${err.message}   (${Math.round(performance.now() - started)} ms)`);
  const frames = [...(err.stack ?? "").matchAll(/wasm-function\[\d+\]:(0x[0-9a-f]+)/g)];
  console.log(`\n${frames.length} frames, innermost first:`);
  for (const f of frames.slice(0, 14)) {
    const off = parseInt(f[1], 16);
    const line = lineAt(off);
    console.log(`  ${f[1].padStart(9)}  ${fnAt(line).padEnd(30)} wac-L0 line ${line}`);
  }
  Deno.exit(1);
}
