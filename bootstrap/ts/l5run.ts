// `deno run -A ts/l5run.ts <file.wac> [export]` — one program through **wac-L5 itself**, run.
//
// **The gap this fills.** Everything else here asks wac-L5 to build `wacc` and then asks questions
// of `wacc`: `spec_cases.ts` runs `spec/cases` through the compiler wac-L5 produced, `ladder.test.ts`
// checks that the ladder closes. Both are about the top rung's *output*. Neither can answer "what
// does wac-L5 do with this program", and that is a different question, because wac-L5 implements a
// subset of wac and its gaps are invisible from above — a construct it drops silently is a construct
// `wacc` handles correctly, so no test built on `wacc` can see it.
//
// `issues/lang/0287b` is what that costs. wac-L5 emits every module-level variable as zero and skips
// its initialiser, so `i32 G = 7; return G;` answers **0** — and no `spec/cases` entry can reproduce
// it, because those run through `wacc`, which answers 7. Finding it needed exactly this script, and
// writing it as a scratch file each time is how it stayed unfound.
//
// Refusals come out as they are: wac-L5 writes each one as an `!!` line naming the source line and
// the token it stopped on. Nothing is run when there are any, because the emitted module is a
// truncated one.
//
//     $ deno run -A ts/l5run.ts /tmp/g.wac
//     f() = 0
//
//     $ deno run -A ts/l5run.ts /tmp/const.wac
//     REFUSED
//       !! wac-L5: line 2: unexpected token ; before }

import { l5ToL0 } from "./l5.ts";
import { assemble } from "../js/assemble.js";

const path = Deno.args[0];
if (!path) {
  console.error("usage: l5run.ts <file.wac> [export]   — the export defaults to `f`, then `main`");
  Deno.exit(2);
}

const l0 = await l5ToL0(await Deno.readTextFile(path));

const refused = l0.split("\n").filter((l) => l.startsWith("!!"));
if (refused.length > 0) {
  console.log("REFUSED");
  for (const line of refused) console.log(`  ${line}`);
  Deno.exit(1);
}

const inst = await WebAssembly.instantiate(
  await WebAssembly.compile(assemble(l0).buffer as ArrayBuffer),
  {},
);
const exports = inst.exports as Record<string, unknown>;

// Named, or the first of the two conventional ones, or whatever single export there is — so a probe
// written in thirty seconds does not also have to remember what it called its function.
const wanted = Deno.args[1];
const callable = Object.keys(exports).filter((k) => typeof exports[k] === "function");
const name = wanted ?? (callable.includes("f") ? "f" : callable.includes("main") ? "main" : callable[0]);
if (!name) {
  console.error(`no callable export in ${path} — it has: ${Object.keys(exports).join(", ") || "(none)"}`);
  Deno.exit(1);
}
if (typeof exports[name] !== "function") {
  console.error(`${path} has no export \`${name}\` — it has: ${callable.join(", ") || "(none)"}`);
  Deno.exit(1);
}

console.log(`${name}() = ${(exports[name] as () => unknown)()}`);
