import { wacLex } from "wac/wacLex.ts";
import { wacParse, type Program } from "wac/wacParse.ts";
import { wacResolve } from "wac/wacResolve.ts";
import { wacTypeCheck } from "wac/wacTypeCheck.ts";
function ref(src: string) {
  const { tokens } = wacLex(src);
  const { program } = wacParse(tokens, "/main.wac");
  const programs = new Map<string, Program>([["/main.wac", program]]);
  return wacTypeCheck(wacResolve("/main.wac", programs), programs)
    .filter((e: any) => e.severity !== "warning").map((e: any) => `${e.line}:${e.col} ${e.message}`);
}
const cases = [
  "export i32 bad(i32 x) { return x ? 1 : 2; }",
  "export void bad(bool c) { i32 x = c ? 1 : true; }",
  "export void ok(bool c) { i32 x = c ? 1 : 2; }",
  "export void bad() { i32[] a = i32[true](); }",
  "export void ok() { i32[] a = i32[3](); }",
  "export bool bad(i32 x) { return x is null; }",
  "export bool bad(i32 a, i32 b) { return a is b; }",
  "struct P { i32 x; } export bool ok(P? p) { return p is null; }",
  "struct P { i32 x; } export bool ok2(P a, P b) { return a is b; }",
  "struct P { i32 x; } export P bad(P p) { return p!; }",
  "struct P { i32 x; } export P ok3(P? p) { return p!; }",
  "export void bad(bool x) { switch (x) { default: { } } }",
  "export void bad(i32 x) { switch (x) { case true: { } default: { } } }",
  "export void ok(i32 x) { switch (x) { case 1: { } default: { } } }",
  "struct Point { i32 x; i32 y; } export void bad() { Point p = Point { x: 1, y: 2, z: 3 }; }",
  "struct Point { i32 x; i32 y; } export void bad() { Point p = Point { x: 1 }; }",
  "struct Point { i32 x; i32 y; } export void ok() { Point p = Point { x: 1, y: 2 }; }",
  "export i32 bad(i32 x) { return x as i32; }",
];
for (const s of cases) console.log((ref(s).join(" | ") || "ok").padEnd(58), JSON.stringify(s.slice(0, 62)));
