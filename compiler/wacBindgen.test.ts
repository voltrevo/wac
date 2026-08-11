// The generated glue, generated and then *run*.
//
// `wacBindgen` writes TypeScript that a host imports and calls, and nothing here used to run any of
// it: the packages exercise the boundary through `harness/wacBind.ts`, which is a different path,
// and `tools/bindcheck.ts` reads the text without importing it. Both issues below produced a file
// that looked plausible and did not work, so these tests import what is generated and call it.

import { wacCompile } from "./wacCompile.ts";
import { wacBindgen } from "./wacBindgen.ts";

/** Generate the glue for `files` and import it, as a host would. */
async function glue(files: Map<string, string>, entry = "main.wac"): Promise<Record<string, unknown>> {
  const r = wacCompile(files, entry);
  if (!r.ok) throw new Error(`refused: ${r.diagnostics[0].message}`);
  const ts = wacBindgen(r.compiled);
  const dir = await Deno.makeTempDir({ prefix: "wac-bindgen-" });
  try {
    const path = `${dir}/gen.ts`;
    await Deno.writeTextFile(path, ts);
    return await import(`file://${path}`) as Record<string, unknown>;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("an imported alias in an exported signature names the struct it means — 0081", async () => {
  // `export P mk()` recorded its return type as `P`, the alias as written, while the struct table
  // said `Point` — so bindgen wrote `mk() — return type 'P' not yet supported in bindgen`.
  const mod = await glue(new Map([
    ["lib.wac", `export struct Point { i32 x; i32 y; }\n`],
    ["main.wac",
      `import { Point as P } from "./lib.wac";\n` +
      `export P mk() { return P(2, 3); }\n` +
      `export i32 sum(P p) { return p.x + p.y; }\n`],
  ]));
  const mk = mod.mk as () => { x: number; y: number };
  const sum = mod.sum as (p: unknown) => number;
  const p = mk();
  if (p.x !== 2 || p.y !== 3) throw new Error(`mk() gave ${p.x},${p.y}`);
  if (sum(p) !== 5) throw new Error(`sum() gave ${sum(p)}`);
});

Deno.test("two modules each declaring an S cross as two classes — 0080, 0100", async () => {
  // The helpers collided first (`Duplicate export name '$bind$s_S_new'`), and once they did not,
  // the glue declared `export class S` twice and every signature said `S`, so a lookup by that
  // name answered with whichever struct was registered last.
  const mod = await glue(new Map([
    ["a.wac", `export struct S { i32 x; }\nexport S mkA() { return S(1); }\n`],
    ["b.wac", `export struct S { i32 y; i32 z; }\nexport S mkB() { return S(2, 3); }\n`],
    ["main.wac",
      `import { S as SA, mkA } from "./a.wac";\n` +
      `import { S as SB, mkB } from "./b.wac";\n` +
      `export SA a() { return mkA(); }\n` +
      `export SB b() { return mkB(); }\n`],
  ]));
  const a = (mod.a as () => { x: number })();
  const b = (mod.b as () => { y: number; z: number })();
  if (a.x !== 1) throw new Error(`a() gave x=${a.x}`);
  if (b.y !== 2 || b.z !== 3) throw new Error(`b() gave ${b.y},${b.z}`);
  // Each is the class for *its* struct: a.wac's has no `z`, and reading one through the other's
  // accessor is the wrong answer this pair is here to rule out.
  if ("z" in a) throw new Error("a() came back as b.wac's class");
  if ("x" in b) throw new Error("b() came back as a.wac's class");
});
