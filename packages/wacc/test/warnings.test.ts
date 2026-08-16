// The warning channel: what it says, where it says it, and what it must not do.
//
// `issues/lang/0126` asks for three things — a channel, the rules, and *a way to measure them* — and
// says why the third matters: neither `spec/cases` (whose expectations are `compiled` or `refused`)
// nor reference recall (which counts errors) can express "warns here", so a warning that lands
// unmeasured rots exactly like the diagnostics `issues/lang/0125` is about.
//
// So this file is the measure. It asserts the wire rather than the rendered text, because the wire is
// what every consumer reads and the rendering is one consumer's choice.
//
// **The direction that matters is the false alarm.** A warning on correct code is worse than no
// warning at all: it teaches people to stop reading them, and unlike an error nobody is forced to
// deal with it. So every rule here is asserted both ways round — it fires where it should, and stays
// quiet on the shape that looks the same and is legal.

import { wacBind } from "../../../harness/wacBind.ts";

const api = await wacBind("packages/wacc/src/api.wac") as unknown as {
  diagnoseGraph(paths: string[], sources: string[], entry: string): string;
  diagnoseGraphRendered(paths: string[], sources: string[], entry: string): string;
};

/** The `(phase, message)` of every diagnostic, in order. */
function diagnostics(src: string): { phase: string; message: string }[] {
  const wire = api.diagnoseGraph(["/m.wac"], [src], "/m.wac");
  return wire.split("\n").filter((l) => l !== "").map((l) => {
    const f = l.split("\t");
    return { phase: f[3] ?? "", message: f[4] ?? "" };
  });
}

const warnings = (src: string) => diagnostics(src).filter((d) => d.phase === "warn");
const errors = (src: string) => diagnostics(src).filter((d) => d.phase !== "warn");

Deno.test("a non-null reference tested against null warns, and the program still compiles", () => {
  const src = `struct P { i32 n; }
export i32 f(P p) { return p is null ? 1 : 0; }
`;
  const warned = warnings(src);
  if (warned.length !== 1) {
    throw new Error(`expected one warning, got ${warned.length}: ${JSON.stringify(warned)}`);
  }
  if (!warned[0].message.includes("never null")) {
    throw new Error(`the wrong warning: ${warned[0].message}`);
  }
  // **And it is not an error.** `[§wac-nonnull-isnull-k8fn3wp]` makes this legal and answers false;
  // a generic like `Slot<T>.empty` has to instantiate for nullable and non-nullable `T` alike, so
  // erroring would make any such generic uninstantiable. The channel exists for exactly this.
  if (errors(src).length !== 0) {
    throw new Error(`a legal program was refused: ${JSON.stringify(errors(src))}`);
  }
});

Deno.test("and the shapes that look the same and are not warned about", () => {
  // Each of these is a place the rule could fire wrongly, and each is legal.
  const quiet: [string, string][] = [
    ["a nullable reference", `struct P { i32 n; }
export i32 f(P? p) { return p is null ? 1 : 0; }
`],
    // The type `T` stands for whatever a call site binds — nullable or not — so this checker cannot
    // know, and "cannot know" must not become "is never null".
    ["a type parameter", `struct Slot<T> { T v;
  bool empty(const this) { return this.v is null; }
}
export i32 f() { return 0; }
`],
    // `x is T` and `x is y` are different questions from `x is null` and share the node.
    ["a type test", `struct P { i32 n; }
struct Q : P { i32 m; }
export i32 f(P p) { return p is Q ? 1 : 0; }
`],
  ];
  for (const [what, src] of quiet) {
    const warned = warnings(src);
    if (warned.length !== 0) {
      throw new Error(`${what}: warned on legal code — ${JSON.stringify(warned)}`);
    }
  }
});

Deno.test("the rendered path a build decides on carries no warnings", () => {
  // **The one that would have broken the world.** `example/wacc.wac` — the compiler inside the `wac`
  // binary — prints `diagnoseGraphRendered` and returns 1 when it is non-empty. A warning reaching
  // that string refuses a program that compiles, which is the failure this channel exists to avoid
  // and would have arrived with the first warning.
  //
  // `waccx` reads the wire and decides on severity instead, which is the shape a caller should have;
  // until `wacc.wac` grows the same distinction, the rendered path is errors only.
  const src = `struct P { i32 n; }
export i32 f(P p) { return p is null ? 1 : 0; }
`;
  const rendered = api.diagnoseGraphRendered(["/m.wac"], [src], "/m.wac");
  if (rendered !== "") {
    throw new Error(`a warning reached the string a build decides on:\n${rendered}`);
  }

  // And an error still does, or the filter has eaten the thing it was meant to let through.
  const bad = `export i32 f() { return "s"; }\n`;
  if (api.diagnoseGraphRendered(["/m.wac"], [bad], "/m.wac") === "") {
    throw new Error("an error did not reach the rendered path — the filter is too wide");
  }
});
