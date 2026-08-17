// `wac.json5`, read and checked — `design/lang/0009` D6 and D9.
//
// The overlap rule is the part worth testing hardest, because it is the one that makes the rest of
// the design safe: D9 says a specifier has at most one possible mapping and there is no
// longest-prefix tie-break, so a table that admits two matches has no defined meaning at all. Every
// pair the decision names is here, both orders, and so are the pairs it explicitly allows — a
// checker that rejected `wac/` beside `wac2/` would satisfy every "must reject" case and be wrong.

import { wacBind } from "../../../harness/wacBind.ts";

type MappingRef = {
  readonly name: string;
  readonly git: string;
  readonly ref: string;
  readonly subdir: string;
  readonly isPrefix: boolean;
};
type ManifestRef = {
  readonly ok: boolean;
  readonly code: number;
  readonly detail: string;
  // A `Mapping[]` field crosses as an ordinary JavaScript array — `length` and `[i]`, not the
  // `.len()`/`.get(i)` shape a struct-wrapped array takes in, say, `packages/git`'s ref reports.
  readonly imports: readonly MappingRef[];
};
type MatchRef = { readonly found: boolean; readonly index: number; readonly suffix: string };

type Mod = {
  readManifest(src: Uint8Array): ManifestRef;
  matchSpecifier(m: ManifestRef, spec: string): MatchRef;
};

let cached: Mod | null = null;
async function mod(): Promise<Mod> {
  if (cached === null) cached = await wacBind("packages/wacpkg/src/manifest.wac") as unknown as Mod;
  return cached;
}

const enc = new TextEncoder();

/** Codes, mirrored from `src/manifest.wac`. Checked against the source below, as `packages/json` does. */
const M = {
  OK: 0,
  NOT_JSON5: 1,
  NOT_OBJECT: 2,
  IMPORTS_KIND: 3,
  MAPPING_KIND: 4,
  NO_GIT: 5,
  NO_REF: 6,
  SUBDIR_KIND: 7,
  EMPTY_NAME: 8,
  OVERLAP: 9,
  SUBDIR_ESCAPE: 10,
};

Deno.test("the TypeScript codes match the wac ones", async () => {
  const src = await Deno.readTextFile("packages/wacpkg/src/manifest.wac");
  const found = new Map<string, number>();
  for (const m of src.matchAll(/export i32 M_([A-Z0-9_]+)\(\)\s*{\s*return (\d+);/g)) {
    found.set(m[1], Number(m[2]));
  }
  const problems: string[] = [];
  for (const [name, code] of Object.entries(M)) {
    if (found.get(name) !== code) problems.push(`M.${name} is ${code} here, ${found.get(name)} in wac`);
  }
  for (const [name, code] of found) {
    if (!(name in M)) problems.push(`M_${name}() = ${code} is missing from M`);
  }
  if (problems.length > 0) throw new Error("codes disagree:\n  " + problems.join("\n  "));
  if (found.size === 0) throw new Error("no codes were read from the source — the pattern is wrong");
});

async function read(text: string): Promise<ManifestRef> {
  return (await mod()).readManifest(enc.encode(text));
}

Deno.test("an empty manifest is valid, and so is one with no imports", async () => {
  for (const text of ["{}", "{ }", "// nothing\n{}", "{ name: 'x' }"]) {
    const m = await read(text);
    if (!m.ok) throw new Error(`${text}: rejected with code ${m.code}`);
    if (m.imports.length !== 0) throw new Error(`${text}: expected no mappings`);
  }
});

Deno.test("a mapping is read whole, including the trailing slash", async () => {
  const m = await read(`{
    imports: {
      // the prefix form
      'std/': { git: 'https://example.invalid/std', ref: 'main' },
      'acme': { git: 'https://example.invalid/acme', ref: 'v1', subdir: 'packages/acme' },
    },
  }`);
  if (!m.ok) throw new Error(`rejected with code ${m.code} (${m.detail})`);
  if (m.imports.length !== 2) throw new Error(`expected 2 mappings, got ${m.imports.length}`);

  const std = m.imports[0];
  if (std.name !== "std/" || !std.isPrefix) throw new Error(`std/: ${std.name}, prefix=${std.isPrefix}`);
  if (std.ref !== "main" || std.subdir !== "") throw new Error(`std/: ref=${std.ref} subdir=${std.subdir}`);

  const acme = m.imports[1];
  if (acme.name !== "acme" || acme.isPrefix) throw new Error(`acme: ${acme.name}, prefix=${acme.isPrefix}`);
  if (acme.subdir !== "packages/acme") throw new Error(`acme: subdir=${acme.subdir}`);
});

Deno.test("overlapping names are refused, and neighbouring ones are not", async () => {
  const entry = (n: string) => `'${n}': { git: 'g', ref: 'r' }`;
  const table = (a: string, b: string) => `{ imports: { ${entry(a)}, ${entry(b)} } }`;

  // Every pair D9 names, and both orders — the check compares two names and could easily be
  // right in one direction only.
  const clash = [
    ["wac/", "wac/packages/json/"],
    ["foo", "foo/"],
    ["a", "a"],            // JSON5 keeps duplicate members; the manifest must not
    ["x/", "x/y"],
    ["p", "p/q/"],
  ];
  const fine = [
    ["wac/", "wac2/"],
    ["foo", "foobar"],
    ["a/", "b/"],
    ["ab/", "a/"],          // `a/` is not a prefix of `ab/`: the slash has to match too
  ];

  const wrong: string[] = [];
  for (const [a, b] of clash) {
    for (const [x, y] of [[a, b], [b, a]]) {
      const m = await read(table(x, y));
      if (m.ok) wrong.push(`${x} beside ${y}: accepted, and one specifier could match both`);
      else if (m.code !== M.OVERLAP) wrong.push(`${x} beside ${y}: code ${m.code}, want OVERLAP`);
      else if (!m.detail.includes(x) || !m.detail.includes(y)) {
        wrong.push(`${x} beside ${y}: the message does not name both — ${m.detail}`);
      }
    }
  }
  for (const [a, b] of fine) {
    const m = await read(table(a, b));
    if (!m.ok) wrong.push(`${a} beside ${b}: refused with code ${m.code}, but no specifier matches both`);
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("a specifier matches at most one mapping, and prefixes keep their suffix", async () => {
  const m = await read(`{ imports: {
    'std/': { git: 'g', ref: 'r' },
    'acme': { git: 'g', ref: 'r' },
  } }`);
  const mm = await mod();
  const cases: [string, number, string][] = [
    ["std/vec.wac", 0, "vec.wac"],
    ["std/a/b.wac", 0, "a/b.wac"],
    ["acme", 1, ""],
    ["std", -1, ""],          // the prefix form does not match the bare name
    // ...nor the name with nothing after it. `std/` would resolve to the mapping's root with an
    // empty path, which names no module. Found by planting `>=` for `>` in the length test and
    // watching every case above still pass: `std` is one byte shorter than `std/`, so it never
    // reached the comparison the mutation changed.
    ["std/", -1, ""],
    ["acme/x", -1, ""],       // the exact form does not match anything under it
    ["other", -1, ""],
  ];
  const wrong: string[] = [];
  for (const [spec, index, suffix] of cases) {
    const got = mm.matchSpecifier(m, spec);
    const gotIndex = got.found ? got.index : -1;
    if (gotIndex !== index || (got.found && got.suffix !== suffix)) {
      wrong.push(`${spec}: got ${gotIndex}/${JSON.stringify(got.suffix)}, want ${index}/${JSON.stringify(suffix)}`);
    }
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("a subdir that leaves its checkout is refused", async () => {
  const cases = ["..", "../x", "a/../..", "a/../../b", "/abs", "a/../b"];
  const wrong: string[] = [];
  for (const sub of cases) {
    const m = await read(`{ imports: { 'a': { git: 'g', ref: 'r', subdir: '${sub}' } } }`);
    if (m.ok) wrong.push(`${sub}: accepted`);
    else if (m.code !== M.SUBDIR_ESCAPE) wrong.push(`${sub}: code ${m.code}, want SUBDIR_ESCAPE`);
  }
  // `a/../b` is refused too, and that is the point of checking the text rather than the
  // normalised path: it stays inside, but a mapping has no reason to be written that way and
  // allowing it means the escape check has to trust a normaliser.
  for (const sub of ["", "a", "a/b", "packages/std"]) {
    const m = await read(`{ imports: { 'a': { git: 'g', ref: 'r', subdir: '${sub}' } } }`);
    if (!m.ok) wrong.push(`${sub}: refused with code ${m.code}`);
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("each malformed shape gets its own code", async () => {
  const cases: [string, number][] = [
    ["{", M.NOT_JSON5],
    ["[]", M.NOT_OBJECT],
    ["1", M.NOT_OBJECT],
    ["{ imports: [] }", M.IMPORTS_KIND],
    ["{ imports: { a: 1 } }", M.MAPPING_KIND],
    ["{ imports: { a: {} } }", M.NO_GIT],
    ["{ imports: { a: { git: 1, ref: 'r' } } }", M.NO_GIT],
    ["{ imports: { a: { git: 'g' } } }", M.NO_REF],
    ["{ imports: { a: { git: 'g', ref: 1 } } }", M.NO_REF],
    ["{ imports: { a: { git: 'g', ref: 'r', subdir: 1 } } }", M.SUBDIR_KIND],
    ["{ imports: { '': { git: 'g', ref: 'r' } } }", M.EMPTY_NAME],
    ["{ imports: { '/': { git: 'g', ref: 'r' } } }", M.EMPTY_NAME],
  ];
  const wrong: string[] = [];
  for (const [text, code] of cases) {
    const m = await read(text);
    if (m.ok) wrong.push(`${text}: accepted`);
    else if (m.code !== code) wrong.push(`${text}: code ${m.code}, want ${code}`);
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});
