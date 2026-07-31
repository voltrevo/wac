import { wacCompile } from "./atoms/wac/wacCompile.ts";
import { wacInstance } from "./atoms/wac/wacInstance.ts";
const src = `
enum E { A(i32 v), B, C }
export i32 covered(E e) { match (e) { case A(v): return v; case B: return 2; else: return 3; } }
export E mkA(i32 v) { return E.A(v); }
`;
const r = wacCompile(new Map([["main.wac", src]]), "main.wac", { coverage: true });
if (!r.ok) { console.log("compile failed:", r.diagnostics[0].message); Deno.exit(1); }
const pts = ((r.compiled as { coverage?: unknown }).coverage as { kind: string; line: number }[]);
console.log(`${pts.length} points: ${pts.map(p => p.kind).join(", ")}`);
const inst = await wacInstance(r.compiled);
const raw = inst.rawExports as Record<string, CallableFunction>;
raw.__cov_init();
raw.covered(raw.mkA(7));                       // only the A arm runs
const n = raw.__cov_len() as number;
const counts: number[] = [];
for (let i = 0; i < n; i++) counts.push(raw.__cov_get(i) as number);
console.log("after running only the A arm:", counts);
console.log("arms never run are reported as zero:", counts.filter(c => c === 0).length, "of", pts.length);
