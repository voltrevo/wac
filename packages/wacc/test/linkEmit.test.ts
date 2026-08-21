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
  // Two files, one name, and each file means its own. This is what file-scoped names buy: `sha256`
  // and `sha512` both declare a `K`, three files declare an `itoa64`, and before this the whole
  // module was declined rather than a call reaching the wrong one.
  ["a name both files declare", {
    "/main.wac": `import { g } from "./lib.wac";\nexport i32 f() { return h() * 10 + g(); }\ni32 h() { return 1; }`,
    "/lib.wac": `export i32 g() { return h(); }\ni32 h() { return 2; }`,
  }],
  ["a struct both files declare", {
    "/main.wac": `import { g } from "./lib.wac";\nstruct P { i32 a; }\nexport i32 f() { P p = P(3); return p.a * 10 + g(); }`,
    "/lib.wac": `struct P { i32 b; i32 c; }\nexport i32 g() { P p = P(4, 5); return p.c; }`,
  }],
  // An import says *which name* it brings in, so a file that imports one of two `enc`s gets the one
  // it asked for. Before this the import list was read as "which files", and two files with the name
  // meant the module was declined.
  ["one of two names with the same spelling", {
    "/main.wac": `import { enc } from "./a.wac";\nimport { q } from "./b.wac";\nexport i32 f() { return enc(10) + q(); }`,
    "/a.wac": `export i32 enc(i32 x) { return x + 1; }`,
    "/b.wac": `export i32 enc(i32 x) { return x + 100; }\nexport i32 q() { return enc(5); }`,
  }],
  // `import { decode as b64decode }` — the caller writes a name no file declares.
  ["an aliased import", {
    "/main.wac": `import { decode as b64decode } from "./a.wac";\nexport i32 f() { return b64decode(20); }`,
    "/a.wac": `export i32 decode(i32 x) { return x * 2; }`,
  }],
  ["an aliased type", {
    "/main.wac": `import { P as Point } from "./a.wac";\nexport i32 f() { Point p = Point(3, 4); return p.x * p.y; }`,
    "/a.wac": `export struct P { i32 x; i32 y; }`,
  }],
  // The root of the tree the compiler ships, and both compilers have to agree about what it holds.
  // `Read` is the one type in the *root*, and a `match` over its three variants is the whole of what
  // a consumer does with one. Written bare here, which is the older of the two spellings the root
  // takes — the quoted `"core"` reaches the same module and is covered by
  // `§wac-core-unquoted-3nqk7vd`.
  ["a capability import", {
    "/main.wac": `import { Read } from "core";\nexport i32 f() { Read r = Read.Data(u8[](1, 2, 3)); ` +
      `match (r) { case Data(b): { return b.len(); } case End: { return 0; } case Failed(w): { return -1; } } }`,
  }],
  ["a capability across files", {
    "/main.wac": `import { Read } from "core";\nimport { mk } from "./lib.wac";\n` +
      `export i32 f() { match (mk(2)) { case Data(b): { return b.len() * 10; } case End: { return 1; } ` +
      `case Failed(w): { return w.len(); } } }`,
    "/lib.wac": `import { Read } from "core";\nexport Read mk(i32 n) { if (n == 0) { return Read.End; } ` +
      `if (n == 1) { return Read.Failed("io"); } return Read.Data(u8[n]()); }`,
  }],
  ["a capability through a funcref", {
    "/main.wac": `import { Read } from "core";\nRead once() { return Read.Data(u8[](9)); }\n` +
      `i32 total(fn[Read()] source) { match (source()) { case Data(b): { return b.len(); } ` +
      `case End: { return 0; } case Failed(w): { return -1; } } }\n` +
      `export i32 f() { return total(once); }`,
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
  // **And it names the key**, which it did not until `issues/lang/0157`: the message was inferred from
  // a sentinel and could name nothing, so a reader was told a file was missing and left to work out
  // which. `linkFiles` records the key at the line that decides it. Asserted as a prefix plus the path
  // rather than as one literal, because what matters is that both halves are there.
  if (!missing.startsWith("an import of a file that was not supplied")) {
    throw new Error(`a missing import was reported as ${JSON.stringify(missing)}`);
  }
  if (!missing.includes("/gone.wac")) {
    throw new Error(`a missing import did not name the file: ${JSON.stringify(missing)}`);
  }
  // A name two files declare is fine — each file means its own. A name a file reaches for that
  // **two of its imports** declare is not: the import list says which files, not which names came
  // from which, so picking either is a guess. It is declined rather than guessed at, which is how a
  // call stopped reaching a `pemBlock` with a different signature.
  const ambiguous = blockedFiles(
    ["/main.wac", "/a.wac", "/b.wac"],
    [
      `import { p } from "./a.wac";\nimport { q } from "./b.wac";\nexport i32 f() { return enc(1); }`,
      `export i32 p() { return 1; }\nexport i32 enc(i32 x) { return x; }`,
      `export i32 q() { return 2; }\nexport i32 enc(i32 x) { return x + 1; }`,
    ],
    "/main.wac",
  );
  // **And says which name**, because "a name" sent the reader back to the file to find out which one
  // — and the five corpus files this decline covered took one grep each to diagnose once it said.
  if (ambiguous !== "the name enc, which more than one file declares") {
    throw new Error(`an ambiguous name was reported as ${JSON.stringify(ambiguous)}`);
  }
});
