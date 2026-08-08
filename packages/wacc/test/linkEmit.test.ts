// Rung 4 across files: a program is more than one file, and the answers still have to agree.
//
// 297 of the 336 corpus files were declined for "an import" — the single largest thing standing
// between this emitter and the rung above it, since `wacc` itself is eight files and cannot compile
// itself until it can compile a program that has imports at all.
//
// What is asserted is what the differential oracle always asserts: **run what both compilers emit
// and compare the answers**. The cases are the shapes an import can carry — a function, a struct, a
// method, an enum matched in a file that never named its type, a constant, a string, a diamond and
// a three-deep chain — plus the two failures that must be *named* rather than guessed at, because
// both would otherwise look like a program that merely does nothing.

import { wacCompile } from "wac/wacCompile.ts";
import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emitFiles = mod.emitFiles as (p: string[], s: string[], e: string) => Uint8Array;
const blockedFiles = mod.blockedFiles as (p: string[], s: string[], e: string) => string;

const cases: [string, Record<string, string>][] = [
  ["a function", {
    "/main.wac": `import { add } from "./lib.wac";\nexport i32 f() { return add(2, 3); }`,
    "/lib.wac": `export i32 add(i32 a, i32 b) { return a + b; }`,
  }],
  ["a struct", {
    "/main.wac": `import { P } from "./lib.wac";\nexport i32 f() { P p = P(3, 4); return p.x * p.y; }`,
    "/lib.wac": `export struct P { i32 x; i32 y; }`,
  }],
  ["a method", {
    "/main.wac": `import { P } from "./lib.wac";\nexport i32 f() { P p = P(3, 4); return p.area(); }`,
    "/lib.wac": `export struct P { i32 x; i32 y; i32 area(const this) { return this.x * this.y; } }`,
  }],
  ["an enum across files", {
    "/main.wac": `import { K, mk } from "./lib.wac";\nexport i32 f() { K k = mk(2); match (k) { case A: return 1; case B: return 2; case C(v): return v * 10; } }`,
    "/lib.wac": `export enum K { A, B, C(i32 v) }\nexport K mk(i32 n) { if (n == 0) { return K.A; } if (n == 1) { return K.B; } return K.C(n); }`,
  }],
  ["a diamond", {
    "/main.wac": `import { l } from "./l.wac";\nimport { r } from "./r.wac";\nexport i32 f() { return l() + r(); }`,
    "/l.wac": `import { base } from "./base.wac";\nexport i32 l() { return base() + 1; }`,
    "/r.wac": `import { base } from "./base.wac";\nexport i32 r() { return base() + 2; }`,
    "/base.wac": `export i32 base() { return 10; }`,
  }],
  ["a path with ..", {
    "/src/main.wac": `import { two } from "../lib/two.wac";\nexport i32 f() { return two() * 21; }`,
    "/lib/two.wac": `export i32 two() { return 2; }`,
  }],
  ["a constant", {
    "/main.wac": `import { N } from "./lib.wac";\nexport i32 f() { return N + 1; }`,
    "/lib.wac": `export const i32 N = 41;`,
  }],
  ["a string across files", {
    "/main.wac": `import { greet } from "./lib.wac";\nexport i32 f() { return (greet() + "!").len(); }`,
    "/lib.wac": `export string greet() { return "hello"; }`,
  }],
  ["three deep", {
    "/main.wac": `import { b } from "./b.wac";\nexport i32 f() { return b(); }`,
    "/b.wac": `import { c } from "./c.wac";\nexport i32 b() { return c() * 2; }`,
    "/c.wac": `import { d } from "./d.wac";\nexport i32 c() { return d() * 3; }`,
    "/d.wac": `export i32 d() { return 7; }`,
  }],
];

Deno.test("rung 4: many files, one module, the same answers", () => {
  const disagree: string[] = [];
  let compared = 0;
  for (const [name, files] of cases) {
    const entry = Object.keys(files)[0];
    const r = wacCompile(new Map(Object.entries(files)), entry);
    if (!r.ok) throw new Error(`the reference refuses the ${name} case, so it is not a case`);
    const paths = Object.keys(files);
    const sources = paths.map((p) => files[p]);
    const why = blockedFiles(paths, sources, entry);
    if (why !== "") {
      disagree.push(`${name}: declined — ${why}`);
      continue;
    }
    const call = (bytes: Uint8Array<ArrayBuffer>) =>
      (new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports.f as () => unknown)();
    const want = call(Uint8Array.from(r.compiled.wasm));
    let got: unknown;
    try {
      got = call(Uint8Array.from(emitFiles(paths, sources, entry) as unknown as number[]));
    } catch (e) {
      got = `threw: ${(e as Error).message.slice(0, 60)}`;
    }
    compared++;
    if (String(want) !== String(got)) disagree.push(`${name}: ours=${got} reference=${want}`);
  }
  // The canary: a run that linked nothing would compare nothing and report agreement.
  if (compared !== cases.length) {
    throw new Error(`only ${compared} of ${cases.length} cases were run and compared`);
  }
  if (disagree.length !== 0) throw new Error(`across files:\n  ` + disagree.join("\n  "));
});

Deno.test("rung 4: the two ways linking fails say which one it was", () => {
  // A file that was never supplied is not the same as a file with nothing in it, and a module built
  // from the second would be a wrong answer rather than a missing one.
  const missing = blockedFiles(
    ["/main.wac"],
    [`import { x } from "./gone.wac";\nexport i32 f() { return x(); }`],
    "/main.wac",
  );
  if (missing !== "an import of a file that was not supplied") {
    throw new Error(`a missing import was reported as ${JSON.stringify(missing)}`);
  }
  // Two files declaring one name is the cost of linking by concatenation: the pool cannot hold two
  // meanings for a name, and picking the first silently is how a call reaches the wrong function.
  const clash = blockedFiles(
    ["/main.wac", "/lib.wac"],
    [
      `import { g } from "./lib.wac";\nexport i32 f() { return g(); }\ni32 h() { return 1; }`,
      `export i32 g() { return 2; }\ni32 h() { return 3; }`,
    ],
    "/main.wac",
  );
  if (clash !== "two files declaring h") {
    throw new Error(`a name clash was reported as ${JSON.stringify(clash)}`);
  }
});
