// **The same ladder under two engines, compared.**
//
// `ts/` drives every rung through Deno and `rust-ladder/` drives the same rungs through V8 from
// Rust. This checks that the wac-L0 they produce is identical — which is the argument the two
// assemblers already make, one level up: a rung that only ever ran under one engine is a rung
// whose behaviour nobody has checked.
//
// It is not the same as the two assemblers agreeing. That differential covers reading a format;
// this one covers *running* five compilers, where the differences an engine can introduce are
// the interesting ones — whether a module validates, whether a memory grew, what a trap does.
//
// Skips unless `rust-ladder/target/release/ladder` has been built, because a Deno suite should
// not require a Rust toolchain to be green.

import { l5ToL0 } from "./l5.ts";

const HERE = new URL(".", import.meta.url).pathname;
const BIN = `${HERE}../rust-ladder/target/release/ladder`;

async function binIsBuilt(): Promise<boolean> {
  try {
    await Deno.stat(BIN);
    return true;
  } catch {
    return false;
  }
}

// Chosen to reach what a rung below cannot express: wasm GC, an enum with payloads, `match`,
// concatenation, a filled array, a generic.
const PROGRAM = `
struct Point { i32 x; i32 y; }
enum Shape { Dot(Point p), Line(Point a, Point b) }
T id<T>(T v) { return v; }
i32 span(Shape s) {
  match (s) {
    case Dot(p): { return p.x + p.y; }
    case Line(a, b): { return (b.x - a.x) + (b.y - a.y); }
  }
  return 0;
}
i32 main() {
  string label = "hello" + " " + "world";
  i32[] ns = i32[4](fill: 3);
  return span(Shape.Line(Point(1, 2), Point(11, 22))) + label.len() + ns[3] + id(0);
}
`;

Deno.test({
  name: "the ladder produces the same wac-L0 under Deno and under V8 from Rust",
  ignore: !(await binIsBuilt()),
  fn: async () => {
    const tmp = await Deno.makeTempFile({ suffix: ".wac" });
    await Deno.writeTextFile(tmp, PROGRAM);
    try {
      const ran = await new Deno.Command(BIN, { args: [tmp, "--l0"] }).output();
      if (!ran.success) {
        throw new Error(`the Rust ladder failed: ${new TextDecoder().decode(ran.stderr)}`);
      }
      const fromRust = new TextDecoder().decode(ran.stdout);
      const fromDeno = await l5ToL0(PROGRAM);
      if (fromRust !== fromDeno) {
        const a = fromRust.split("\n");
        const b = fromDeno.split("\n");
        const at = a.findIndex((l, i) => l !== b[i]);
        throw new Error(
          `the two hosts disagree at line ${at + 1} of ${a.length}/${b.length}:\n` +
            `  rust: ${a[at]}\n  deno: ${b[at]}`,
        );
      }
    } finally {
      await Deno.remove(tmp);
    }
  },
});
