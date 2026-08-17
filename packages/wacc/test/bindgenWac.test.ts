// The generator, ported: `src/bindgen.wac` against `packages/wacc/tools/waccBindgen.ts`.
//
// `waccBindgen.ts` is the last piece of the toolchain that exists only in TypeScript — `waccx
// bindgen` writes glue and the `wac` binary cannot. That is a tooling-parity gap rather than a
// missing language feature, which is why it is worth closing and why the bar is what it is here.
//
// **Byte-identical, or it is not a port.** Comparing behaviour would leave two generators to keep in
// step; comparing the text means a difference is a bug in one of them and is found at the character
// where they diverge. Both modes are compared, because JavaScript is the TypeScript minus its
// annotations and a port could get one right while dropping a cast from the other.
//
// The corpus grows as the port covers more. Each program is here for a shape rather than for a
// feature list: a scalar and a string say the conversions work, a struct and an enum say the classes
// do, an array in both directions says the staging buffer does.

import { waccApi } from "../../../harness/waccBuild.ts";
import {
  generate,
  parseAliases,
  parseBindTypes,
  parseCallbacks,
  parseOutRefs,
  parseSigs,
} from "../tools/waccBindgen.ts";

type Api = {
  emitFiles(paths: string[], sources: string[], entry: string): Uint8Array;
  exportSigsFiles(paths: string[], sources: string[], entry: string): string;
  bindTypesFiles(paths: string[], sources: string[], entry: string): string;
  bindgenFiles(
    wasm: Uint8Array,
    paths: string[],
    sources: string[],
    entry: string,
    lang: string,
  ): string;
  bindgenWire(wasm: Uint8Array, sigs: string, wire: string, lang: string): string;
};

const api = await waccApi() as unknown as Api;

const CASES: [string, string][] = [
  ["a scalar and nothing else", `export i32 add(i32 a, i32 b) { return a + b; }\n`],
  [
    "a string, both ways",
    `export string greet(string who) { return "hello " + who; }\n`,
  ],
  [
    "a struct with a method",
    `struct Point {
  i32 x;
  i32 y;
  i32 sum(const this) { return this.x + this.y; }
}
export Point origin(i32 x, i32 y) { return Point(x, y); }
`,
  ],
  [
    "an enum built and matched",
    `enum Shape { Circle(i32 r), Square(i32 s) }
export i32 area(Shape s) {
  match (s) {
    case Circle(r): return 3 * r * r;
    case Square(q): return q * q;
  }
}
`,
  ],
  [
    "a numeric array in both directions",
    `export i32[] doubled(i32[] xs) {
  i32[] out = i32[xs.len()]();
  for (i32 i = 0; i < xs.len(); i++) { out[i] = xs[i] * 2; }
  return out;
}
`,
  ],
  [
    "an array of strings, whose elements are references",
    `export string[] echo(string[] xs) { return xs; }\n`,
  ],
  [
    "everything at once",
    `struct Point {
  i32 x;
  i32 y;
  i32 sum(const this) { return this.x + this.y; }
}
enum Shape { Circle(i32 r), Square(i32 s) }
export i32 add(i32 a, i32 b) { return a + b; }
export string greet(string who) { return "hello " + who; }
export Point origin(i32 x, i32 y) { return Point(x, y); }
export i32 area(Shape s) {
  match (s) {
    case Circle(r): return 3 * r * r;
    case Square(q): return q * q;
  }
}
export u8[] bytes(u8[] b) { return b; }
`,
  ],
];

/** The shapes that are not reachable from a one-file program, so they are named by their entry. */
const FILES: string[] = [
  // A callback going in, a funcref coming out, `Pending<T>` and its aliases, and 40-odd dispatchers:
  // the whole capability boundary, which is the hardest thing this generator is ever handed.
  "packages/platform/example/wc.wac",
  // The compiler itself — half a megabyte of module through the base64 writer, and the program whose
  // glue the website actually ships.
  "packages/wacc/src/api.wac",
];

/** Where two long texts first differ, as a line rather than an offset. */
function firstDifference(a: string, b: string): string {
  const x = a.split("\n"), y = b.split("\n");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) {
      return `line ${i + 1}:\n  waccBindgen.ts: ${JSON.stringify(x[i])}\n` +
        `  bindgen.wac:    ${JSON.stringify(y[i])}`;
    }
  }
  return `no line differs; lengths ${a.length} and ${b.length}`;
}

for (const [what, src] of CASES) {
  for (const lang of ["ts", "js"] as const) {
    Deno.test(`the two generators write the same ${lang} — ${what}`, () => {
      const paths = ["/t/m.wac"], sources = [src];
      const wasm = Uint8Array.from(
        api.emitFiles(paths, sources, "/t/m.wac") as unknown as number[],
      );
      const wire = api.bindTypesFiles(paths, sources, "/t/m.wac");
      const theirs = generate(
        wasm,
        parseSigs(api.exportSigsFiles(paths, sources, "/t/m.wac")),
        parseBindTypes(wire),
        parseCallbacks(wire),
        parseOutRefs(wire),
        parseAliases(wire),
        { lang },
      );
      const mine = api.bindgenFiles(wasm, paths, sources, "/t/m.wac", lang);

      // **Asserted, not merely compared.** Two empty strings are equal, and a generator that wrote
      // nothing would agree with one that wrote nothing.
      if (!theirs.includes("export function")) {
        throw new Error(`${what}: the reference generator emitted no exports`);
      }
      if (mine !== theirs) throw new Error(`${what} (${lang}) — ${firstDifference(theirs, mine)}`);
    });
  }
}

// A name the linker keyed, which no program can be made to produce on demand.
//
// `Node@2` is what the metadata carries where two files declare one name and the declaring file is
// not known, and `@` is not a TypeScript identifier: every position the generator writes a type name
// in goes through `classNameOf`, and two of them did not, producing glue that would not parse
// (`SyntaxError: Expected '{', got '@'`). The corpus above cannot reach it, because every case there
// derives its wire from a real program — so the wire is written by hand and both generators are
// handed the same one.
//
// This is the only check either generator has for that property. `test/wac/keyedenum_test.wac`
// asserts it of `bindgen.wac` alone; comparing the text here is what extends it to `waccBindgen.ts`.
const KEYED_WIRE = "E\tNode@2\tNode__two\tElement:tag:string;Text:\n";
const KEYED_SIGS = "make\tNode@2\t\n";
/** A bare wasm header — nothing here instantiates it. */
const KEYED_WASM = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);

for (const lang of ["ts", "js"] as const) {
  Deno.test(`the two generators write the same ${lang} — a linker-keyed enum name`, () => {
    const theirs = generate(
      KEYED_WASM,
      parseSigs(KEYED_SIGS),
      parseBindTypes(KEYED_WIRE),
      parseCallbacks(KEYED_WIRE),
      parseOutRefs(KEYED_WIRE),
      parseAliases(KEYED_WIRE),
      { lang },
    );
    const mine = api.bindgenWire(KEYED_WASM, KEYED_SIGS, KEYED_WIRE, lang);

    // **Asserted, not merely compared.** Two generators that both dropped the enum would agree, and
    // a keyed name that reaches nothing is sanitised in the sense that matters least.
    if (!theirs.includes("class Node$2")) {
      throw new Error(`the reference generator wrote no class for the keyed enum:\n${theirs.slice(0, 300)}`);
    }
    if (mine !== theirs) {
      throw new Error(`a linker-keyed enum name (${lang}) — ${firstDifference(theirs, mine)}`);
    }
  });
}

for (const entry of FILES) {
  for (const lang of ["ts", "js"] as const) {
    Deno.test(`the two generators write the same ${lang} — ${entry}`, async () => {
      const { wacFiles } = await import("../../../harness/wacFiles.ts");
      const files = await wacFiles(entry);
      const paths = [...files.keys()];
      const sources = paths.map((p) => files.get(p)!);
      const wasm = Uint8Array.from(api.emitFiles(paths, sources, entry) as unknown as number[]);
      const wire = api.bindTypesFiles(paths, sources, entry);
      const theirs = generate(
        wasm,
        parseSigs(api.exportSigsFiles(paths, sources, entry)),
        parseBindTypes(wire),
        parseCallbacks(wire),
        parseOutRefs(wire),
        parseAliases(wire),
        { lang },
      );
      const t0 = performance.now();
      const mine = api.bindgenFiles(wasm, paths, sources, entry, lang);
      const took = performance.now() - t0;

      if (!theirs.includes("export function")) {
        throw new Error(`${entry}: the reference generator emitted no exports`);
      }
      if (mine !== theirs) throw new Error(`${entry} (${lang}) — ${firstDifference(theirs, mine)}`);
      console.log(
        `    ${entry} (${lang}): ${(mine.length / 1024).toFixed(0)}K identical, ` +
          `${(took / 1000).toFixed(1)}s in wac`,
      );
    });
  }
}
