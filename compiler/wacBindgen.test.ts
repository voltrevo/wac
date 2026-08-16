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

Deno.test("a funcref crosses in both directions, including the returned one", async () => {
  // **The direction nothing tested.** This file, and `bindcheck.ts`, and the packages' use of the
  // boundary, all exercise a funcref as a *parameter* — a host function the module calls. A funcref
  // *returned* has its own path (`outFuncrefsByType`, an exported `call_ref` shim, and a JavaScript
  // closure holding the wasm reference), and the word "funcref" did not appear in this file at all.
  //
  // What that cost was not a bug but a belief: `cbTsType`'s doc comment said a returned funcref
  // "stays unbindable — there is nothing to hand back", forty lines below the comment describing the
  // shim that hands it back. A stale sentence about a working feature survives exactly as long as
  // nothing runs the feature.
  //
  // It matters now beyond tidiness. `design/lang/0002`'s tier two makes a closure the same
  // `{funcref, env}` pair with a capture record in the env, so this is the path a closure would
  // cross on, and it should be nailed down before something leans on it.
  //
  // **Plain functions, not a bound reference.** `c.inc` as a value is tier one, which is wacc-only
  // by instruction (`§wacc-fnref-bound`) — the reference refuses it with "cannot use method 'inc' as
  // a value", so a test of *this* bindgen has to stay inside what this compiler implements.
  //
  // **`string`, and not `i32`, is what makes this test one.** Written first with `fn[i32()]` it
  // passed with the glue's whole return path deleted — V8 hands a bare wasm funcref to JavaScript as
  // a callable already, so for a signature needing no conversion the generated wrapper is not
  // load-bearing and the assertions measured the engine rather than the bindgen. With a `string`
  // return the wrapper has to run `$bind$callref_0` and `_stringFromWasm`, and removing it turns
  // `f()` into a wasm reference. Verified by mutation, both ways round.
  const mod = await glue(new Map([
    ["main.wac", `string hi() { return "hi"; }
string bye() { return "bye"; }
export fn[string()] pick(bool a) { return a ? hi : bye; }
export i32 lenOf(fn[string()] f) { return f().len(); }
`],
  ]));

  const f = (mod.pick as (a: boolean) => () => string)(true);
  if (typeof f !== "function") {
    throw new Error(`a returned funcref arrived as ${typeof f}, not something callable`);
  }
  if (f() !== "hi") throw new Error(`the returned funcref answered ${JSON.stringify(f())}, want "hi"`);

  // **Which funcref**, not merely *a* funcref: the other arm must come back as the other function.
  // Without this the test passes if the shim ignores the reference it is handed and calls whichever
  // function happens to be registered first.
  const g = (mod.pick as (a: boolean) => () => string)(false);
  if (g() !== "bye") throw new Error(`the other arm answered ${JSON.stringify(g())}, want "bye"`);

  // **And back the other way**, so the value JavaScript holds is one wac can call, not merely one
  // JavaScript can invoke — and it still knows which function it is.
  const lenOf = mod.lenOf as (h: () => string) => number;
  if (lenOf(f) !== 2) throw new Error(`lenOf(hi) gave ${lenOf(f)}, want 2`);
  if (lenOf(g) !== 3) throw new Error(`the round trip lost which function it held: ${lenOf(g)}, want 3`);
});
