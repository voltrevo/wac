// `deno run -A ts/l5run.ts <file.wac> [export]` — one program through **wac-L5 itself**, run.
//
// **The gap this fills**, which is narrower than "you could not do this". `l5Run` in `l5.ts` has
// always run a program through wac-L5 and `l5.test.ts` uses it a hundred times. What there was no
// way to do from a shell was ask *one* file the question — and, more to the point, `l5Run` gives you
// an answer or an exception, and says nothing about a **refusal**: wac-L5 writes those as `!!` lines
// into the module it emits, so a refused program comes back as a broken module rather than as a
// reason. Both halves in one command is the whole of this file.
//
// Worth having because the ladder's other harnesses ask questions of wac-L5's *output* —
// `spec_cases.ts` runs `spec/cases` through the `wacc` that wac-L5 built, `ladder.test.ts` checks
// the ladder closes — and a construct the top rung mishandles is one `wacc` handles correctly, so
// nothing built on `wacc` can see it. `issues/lang/0287b` is what that cost: wac-L5 answered **0**
// for `i32 G = 7; return G;`, and no `spec/cases` entry could reproduce it, because a spec case runs
// through `wacc`, which answers 7.
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
