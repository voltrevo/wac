// The generator emits JavaScript as well as TypeScript, and the JavaScript runs.
//
// A browser cannot import TypeScript. That is the whole reason the site's playground compiles what a
// reader types with the *reference* compiler — it needs glue the page can evaluate, and wacc's
// generator emitted `.ts` only. It was the last non-bootstrap use of the reference in the
// repository. `issues/lang/0105`.
//
// **JavaScript is this output minus its annotations**, so it is one generator with a mode rather than
// two generators to keep in step. What that leaves is worth stating: the two outputs are the same
// number of lines and the same code, and a difference between them can only be a type.
//
// The assertion is the running, not the reading. A generator that dropped a cast it needed, or kept
// one it could not, would still *look* like JavaScript.

import { waccApi } from "../../../harness/waccBuild.ts";
import {
  generate,
  parseAliases,
  parseBindTypes,
  parseCallbacks,
  parseOutRefs,
  parseSigs,
} from "../tools/waccBindgen.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

// One program covering every shape the glue converts: a scalar, a string, a struct with a method, an
// enum built and matched, and an array in both directions.
const SRC = `struct Point {
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
export i32[] doubled(i32[] xs) {
  i32[] out = i32[xs.len()]();
  for (i32 i = 0; i < xs.len(); i++) { out[i] = xs[i] * 2; }
  return out;
}
`;

const paths = ["/t/m.wac"], sources = [SRC];
const api = await waccApi();
const wasm = Uint8Array.from(api.emitFiles(paths, sources, "/t/m.wac") as unknown as number[]);
const wire = api.bindTypesFiles(paths, sources, "/t/m.wac");
const args = [
  wasm,
  parseSigs(api.exportSigsFiles(paths, sources, "/t/m.wac")),
  parseBindTypes(wire),
  parseCallbacks(wire),
  parseOutRefs(wire),
  parseAliases(wire),
] as const;

Deno.test("the JavaScript mode emits no types, and the same code otherwise", () => {
  const ts = generate(...args, { lang: "ts" });
  const js = generate(...args, { lang: "js" });

  // Line for line: the mode removes annotations rather than taking another path through the
  // generator, and a difference in *shape* would mean it had.
  assertEquals(js.split("\n").length, ts.split("\n").length, "same number of lines");

  const annotated = js.split("\n").filter((l) =>
    / as (number|string|bigint|boolean|unknown|Uint8Array|BufferSource|CallableFunction|const)\b/
      .test(l) ||
    /\((\$?\w+): |\)\s*: [A-Za-z"(]/.test(l)
  );
  assertEquals(annotated, [], "these lines still carry a type");
});

Deno.test("and what it emits runs, for every shape the glue converts", async () => {
  const js = generate(...args, { lang: "js" });
  const dir = await Deno.makeTempDir({ prefix: "wac-jsbindgen-" });
  try {
    // **`.js`, and imported as such.** Deno will not parse TypeScript out of a `.js` file, which is
    // exactly the browser's rule and the reason this test is written this way round.
    const path = `${dir}/glue.js`;
    await Deno.writeTextFile(path, js);
    const mod = await import(path) as {
      add(a: number, b: number): number;
      greet(who: string): string;
      origin(x: number, y: number): { sum(): number; x: number };
      area(s: unknown): number;
      doubled(xs: number[]): Int32Array;
      Shape: { Circle(r: number): unknown };
    };

    assertEquals(mod.add(2, 3), 5, "a scalar");
    assertEquals(mod.greet("world"), "hello world", "a string, both ways");
    assertEquals(mod.origin(4, 5).sum(), 9, "a struct class, and a method on it");
    assertEquals(mod.origin(4, 5).x, 4, "and a field accessor");
    assertEquals(mod.area(mod.Shape.Circle(2)), 12, "an enum variant, built here and matched there");
    assertEquals([...mod.doubled([1, 2, 3])], [2, 4, 6], "an array in both directions");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
