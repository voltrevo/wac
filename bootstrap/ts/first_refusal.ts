// `deno run -A ts/first_refusal.ts <file.wac> [upto]` — the first thing wac-L5 would not compile,
// and which function it is inside, which names the construct without bisecting for it.
//
// This is the other half of `bisect_real_wac.ts`: the bisector finds the smallest failing prefix,
// this says what in it failed. Not a test — it reports, it does not judge.

import { l5ToL0 } from "./l5.ts";

if (Deno.args.length < 1) {
  console.error("usage: first_refusal.ts <file.wac> [upto]");
  Deno.exit(2);
}

const lines = (await Deno.readTextFile(Deno.args[0])).split("\n");
const upto = Deno.args[1] ? +Deno.args[1] : lines.length;
const l0 = (await l5ToL0(lines.slice(0, upto).join("\n"))).split("\n");

const marks = l0.filter((x) => x.startsWith("!!")).length;
console.log(`${l0.length} lines emitted, ${marks} refusal(s)`);

const at = l0.findIndex((x) => x.startsWith("!!"));
if (at < 0) Deno.exit(0);

let f = at;
while (f > 0 && !l0[f].startsWith("func ")) f--;
console.log(`inside: ${l0[f]}`);
console.log(`refusal: ${l0[at]}`);
console.log("emitted just before it:");
console.log(l0.slice(Math.max(f, at - 8), at).join("\n"));

// Every *distinct* refusal, so one run says how many different things are missing rather than how
// many times the commonest one appears.
const kinds = new Map<string, number>();
for (const x of l0) if (x.startsWith("!!")) kinds.set(x, (kinds.get(x) ?? 0) + 1);
if (kinds.size > 1) {
  console.log(`\n${kinds.size} distinct refusals:`);
  for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(5)}  ${k.slice(0, 90)}`);
  }
}
