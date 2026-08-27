// `deno run -A ts/validate_real_wac.ts <file.wac>` — compile real wac all the way to a module the
// engine accepts, and when it does not, say which of our functions it objected to.
//
// The engine names a function by index, which is no use on its own: index 236 of a hundred
// thousand lines of wac-L0 is a number, not a place. This walks the same `func` directives the
// assembler does, in the same order, so the index lands on a name.
//
// This is the instrument for the stage after refusals: `first_refusal.ts` says what wac-L5 would
// not read, this says what it read and emitted wrongly. Neither judges — they report.

import { l5ToL0 } from "./l5.ts";
import { assembleMapped } from "./assemble.ts";

if (Deno.args.length < 1) {
  console.error("usage: validate_real_wac.ts <file.wac>");
  Deno.exit(2);
}

const l0 = await l5ToL0(await Deno.readTextFile(Deno.args[0]));
const lines = l0.split("\n");
const refusals = lines.filter((x) => x.startsWith("!!")).length;
console.log(`${lines.length} lines of wac-L0, ${refusals} refusal(s)`);

// Imported functions come first in the index space, exactly as in the binary.
const names: string[] = [];
const at: number[] = [];
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].split(" ");
  if (t[0] === "import" && t[3] === "func") { names.push(t[4]); at.push(i); }
}
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].split(" ");
  if (t[0] === "func") { names.push(t[1]); at.push(i); }
}
console.log(`${names.length} functions`);

let bytes: Uint8Array;
let map: { at: number; line: number }[];
try {
  ({ bytes, map } = assembleMapped(l0));
} catch (e) {
  console.log(`wax refused it: ${(e as Error).message}`);
  Deno.exit(1);
}
console.log(`assembled: ${bytes.length} bytes`);

try {
  await WebAssembly.compile(bytes.buffer as ArrayBuffer);
  console.log("VALIDATES");
  Deno.exit(0);
} catch (e) {
  const msg = (e as Error).message;
  console.log(msg.slice(0, 300));
  const m = msg.match(/function #(\d+)/);
  if (m !== null) {
    const n = +m[1];
    console.log(`function #${n} is ${names[n] ?? "past the end"}, at wac-L0 line ${at[n] + 1}`);
  }
  // The byte offset the engine reports is a number rather than a place until the map turns it
  // into a line — which is the difference between reading two hundred lines and reading one.
  const off = +(msg.match(/@\+(\d+)/)?.[1] ?? -1);
  if (off < 0) Deno.exit(1);
  let best = map[0];
  for (const k of map) if (k.at <= off) best = k;
  console.log(`\nthe engine stopped at wac-L0 line ${best.line}, in context:`);
  const lo = Math.max(0, best.line - 12);
  for (let i = lo; i < Math.min(lines.length, best.line + 3); i++) {
    console.log(`${i + 1 === best.line ? ">>" : "  "} ${lines[i]}`);
  }
  Deno.exit(1);
}
