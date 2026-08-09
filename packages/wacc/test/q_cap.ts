import { wacCompile } from "wac/wacCompile.ts";
const src = `import { Read } from core;\nexport i32 f(Read r) { return 1; }`;
const r = wacCompile(new Map([["/main.wac", src]]), "/main.wac");
if (!r.ok) { console.log("refused:", JSON.stringify(r.diagnostics.slice(0, 3))); Deno.exit(0); }
const b = Uint8Array.from(r.compiled.wasm);
console.log(`${b.length} bytes, valid=${WebAssembly.validate(b)}`);
// walk sections, dump the import section
let i = 8;
while (i < b.length) {
  const id = b[i];
  let n = 0, sh = 0, j = i + 1;
  for (;;) { const c = b[j++]; n |= (c & 127) << sh; sh += 7; if (!(c & 128)) break; }
  if (id === 2) {
    console.log("import section bytes:", [...b.slice(j, j + Math.min(n, 80))].map((x) => x.toString(16).padStart(2, "0")).join(" "));
    console.log("as text:", new TextDecoder().decode(b.slice(j, j + Math.min(n, 80))).replace(/[^\x20-\x7e]/g, "."));
  }
  console.log(`section ${id}: ${n} bytes`);
  i = j + n;
}
