// Where a specifier actually lands: D9's confinement, and D7's `@/`.
//
// Matching a mapping name is the easy half. This is the half that decides what a mapped import may
// *reach* — a package given `subdir: "packages/acme"` must not be able to read the file above it —
// and the half where being slightly wrong is a hole rather than a bug.

import { wacBind } from "../../../harness/wacBind.ts";

type LocatedRef = { readonly ok: boolean; readonly code: number; readonly path: string };
type Mod = {
  locateIn(manifestSrc: Uint8Array, spec: string): LocatedRef;
  mappingFor(manifestSrc: Uint8Array, spec: string): number;
  atPath(spec: string, projectRoot: string): string;
  isAt(spec: string): boolean;
  manifestName(): string;
};

let cached: Mod | null = null;
async function mod(): Promise<Mod> {
  if (cached === null) cached = await wacBind("packages/wacpkg/src/wacpkg.wac") as unknown as Mod;
  return cached;
}

const enc = new TextEncoder();
const b = (s: string) => enc.encode(s);

const M = b(`{ imports: {
  'whole/': { git: 'g', ref: 'r' },
  'sub/':   { git: 'g', ref: 'r', subdir: 'packages/acme' },
  'deep/':  { git: 'g', ref: 'r', subdir: 'a/b' },
  'exact':  { git: 'g', ref: 'r', subdir: 'packages/one' },
} }`);

const SUBDIR_ESCAPE = 10;

Deno.test("the suffix is appended to the mapping's subdir", async () => {
  const m = await mod();
  const cases: [string, string][] = [
    ["whole/src/a.wac", "src/a.wac"],
    ["whole/a.wac", "a.wac"],
    ["sub/src/a.wac", "packages/acme/src/a.wac"],
    ["deep/c.wac", "a/b/c.wac"],
    // An exact mapping has no suffix, so it lands on the subdir itself.
    ["exact", "packages/one"],
  ];
  const wrong: string[] = [];
  for (const [spec, want] of cases) {
    const got = m.locateIn(M, spec);
    if (!got.ok) wrong.push(`${spec}: refused with code ${got.code}`);
    else if (got.path !== want) wrong.push(`${spec}: ${got.path}, want ${want}`);
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("a suffix that leaves the checkout is refused, and one that does not is kept", async () => {
  const m = await mod();
  // The pair that makes the *order* of the rule matter. `deep/` has `subdir: a/b`, so `../c.wac`
  // lands on `a/c.wac` and is inside; `whole/` has none, so the same suffix is outside. A check on
  // the suffix alone gets one of these two wrong whichever way it is written.
  const inside: [string, string][] = [
    ["deep/../c.wac", "a/c.wac"],
    ["deep/../../x.wac", "x.wac"],
    ["sub/../other/a.wac", "packages/other/a.wac"],
    ["whole/a/../b.wac", "b.wac"],
    ["sub/./a.wac", "packages/acme/a.wac"],
  ];
  const outside = [
    "whole/../x.wac",
    "whole/../../x.wac",
    "deep/../../../x.wac",
    "sub/../../../etc/passwd",
  ];
  const wrong: string[] = [];
  for (const [spec, want] of inside) {
    const got = m.locateIn(M, spec);
    if (!got.ok) wrong.push(`${spec}: refused (code ${got.code}) but it stays inside`);
    else if (got.path !== want) wrong.push(`${spec}: ${got.path}, want ${want}`);
  }
  for (const spec of outside) {
    const got = m.locateIn(M, spec);
    if (got.ok) wrong.push(`${spec}: accepted as ${got.path}, and it is outside the checkout`);
    else if (got.code !== SUBDIR_ESCAPE) wrong.push(`${spec}: code ${got.code}, want ${SUBDIR_ESCAPE}`);
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("a specifier no mapping claims locates nowhere", async () => {
  const m = await mod();
  const wrong: string[] = [];
  for (const spec of ["other/a.wac", "whole", "./a.wac", "", "exactly"]) {
    if (m.mappingFor(M, spec) !== -1) wrong.push(`${spec}: matched a mapping`);
    if (m.locateIn(M, spec).ok) wrong.push(`${spec}: located somewhere`);
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("`@/` is relative to the project root, not to the compiler's directory", async () => {
  const m = await mod();
  const cases: [string, string, string][] = [
    ["@/src/a.wac", "proj", "proj/src/a.wac"],
    ["@/a.wac", "proj/nested", "proj/nested/a.wac"],
    ["@/a.wac", ".", "a.wac"],
    ["@/a.wac", "", ""],                 // no root: the caller must report D7's compile error
    ["@/./x/../a.wac", "proj", "proj/a.wac"],
    ["@/", "proj", "proj"],
    // Not project references, so not this function's business.
    ["./a.wac", "proj", ""],
    ["a.wac", "proj", ""],
    ["@", "proj", ""],
    ["@x/a.wac", "proj", ""],
  ];
  const wrong: string[] = [];
  for (const [spec, root, want] of cases) {
    const got = m.atPath(spec, root);
    if (got !== want) wrong.push(`${JSON.stringify(spec)} in ${JSON.stringify(root)}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  for (const [spec, isAt] of [["@/a", true], ["@/", true], ["@", false], ["@x", false], ["./a", false], ["", false]] as [string, boolean][]) {
    if (m.isAt(spec) !== isAt) wrong.push(`isAt(${JSON.stringify(spec)}) is ${!isAt}`);
  }
  if (m.manifestName() !== "wac.json5") wrong.push(`the manifest is called ${m.manifestName()}`);
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});
