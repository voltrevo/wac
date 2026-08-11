import { generateEmit } from "./packages/wacc/test/generateEmit.ts";
import { wacCompile } from "./compiler/wacCompile.ts";
const progs = generateEmit();
for (const p of progs) {
  if (!p.context.includes("switch")) continue;
  const r = wacCompile(new Map([["main.wac", p.src]]), "main.wac");
  if (r.diagnostics.length) console.log(p.context, "→", r.diagnostics.map(d => d.message)[0]);
}
