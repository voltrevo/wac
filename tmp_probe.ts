import { wacCompile } from "./atoms/wac/wacCompile.ts";
import { wacInstance } from "./atoms/wac/wacInstance.ts";
const src = `
export string greet()   { return "hi"; }
export string unicode() { return "héllo → 😀"; }
export string empty()   { return ""; }
export u8[]  bytes()    { return u8[](104, 105, 255); }
export i32[] ints()     { return i32[](1, -2, 3); }
export u32[] unsigned() { return u32[](0xFF000000, 5); }
export i64[] wide()     { return i64[](1000000000000, -1); }
export f64[] floats()   { return f64[](1.5, -2.5); }
export i32   plain()    { return 42; }
export void  nothing()  { }
`;
const r = wacCompile(new Map([["main.wac", src]]), "main.wac");
if (!r.ok) { console.log("compile:", r.diagnostics[0].message); Deno.exit(1); }
const i = await wacInstance(r.compiled);
for (const f of ["greet","unicode","empty","bytes","ints","unsigned","wide","floats","plain","nothing"]) {
  console.log(`  ${f.padEnd(9)} = ${JSON.stringify(i.call(f, []), (_, v) => typeof v === "bigint" ? `${v}n` : v)}`);
}
