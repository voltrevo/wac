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
  wireHasErrors(wire: string): boolean;
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

Deno.test("a build prints warnings and decides on errors, which are different questions", () => {
  // **The one that would have broken the world.** `example/wacc.wac` — the compiler inside the `wac`
  // binary — returned 1 whenever the rendered string was non-empty, so the first warning would have
  // refused a program that compiles. It asks `wireHasErrors` now, and the rendered path carries
  // everything, so a warning reaches the reader *and* the build succeeds.
  //
  // Asserted here rather than left to the binary because the binary carries a prebuilt seed: a test
  // that ran `wac` would be testing whatever seed happened to be on disk (`issues/system/0160`).
  const warns = `struct P { i32 n; }
export i32 f(P p) { return p is null ? 1 : 0; }
`;
  const bad = `export i32 f() { return "s"; }\n`;

  const wireWarn = api.diagnoseGraph(["/m.wac"], [warns], "/m.wac");
  if (api.wireHasErrors(wireWarn)) throw new Error("a warning was counted as an error");
  if (!api.diagnoseGraphRendered(["/m.wac"], [warns], "/m.wac").includes("warning:")) {
    throw new Error("the rendered path dropped the warning, so no build would ever print one");
  }

  const wireBad = api.diagnoseGraph(["/m.wac"], [bad], "/m.wac");
  if (!api.wireHasErrors(wireBad)) throw new Error("an error was not counted as one");

  // A file with both: the error decides, and the warning is still shown.
  const both = `struct P { i32 n; }
export i32 f(P p) { i32 n = p is null ? 1 : 0; return "s"; }
`;
  const wireBoth = api.diagnoseGraph(["/m.wac"], [both], "/m.wac");
  if (!api.wireHasErrors(wireBoth)) throw new Error("an error beside a warning did not decide");
  const rendered = api.diagnoseGraphRendered(["/m.wac"], [both], "/m.wac");
  if (!rendered.includes("warning:") || !rendered.includes("error:")) {
    throw new Error(`both should be printed, got:\n${rendered}`);
  }
});

Deno.test("a type test between types that share no ancestor warns, and one that could hold does not", () => {
  const decls = `struct A { i32 a; }
struct B { i32 b; }
struct P { i32 n; }
struct Q : P { i32 m; }
`;
  const unrelated = decls + `export i32 f(A x) { return x is B ? 1 : 0; }\n`;
  const related = decls + `export i32 f(P p) { return p is Q ? 1 : 0; }\n`;

  const warned = warnings(unrelated);
  if (warned.length !== 1 || !warned[0].message.includes("share no ancestor")) {
    throw new Error(`expected one ancestor warning, got ${JSON.stringify(warned)}`);
  }
  if (errors(unrelated).length !== 0) {
    throw new Error(`a legal program was refused: ${JSON.stringify(errors(unrelated))}`);
  }
  // **The direction that matters.** `p is Q` is the ordinary narrowing this language is built on;
  // warning there would fire on most `match`-free code that uses inheritance at all.
  if (warnings(related).length !== 0) {
    throw new Error(`warned on a test that can hold: ${JSON.stringify(warnings(related))}`);
  }
});

Deno.test("a downcast that can never hold warns, and one that can does not", () => {
  const decls = `struct A { i32 a; }
struct B { i32 b; }
struct P { i32 n; }
struct Q : P { i32 m; }
`;
  const never = decls + `export i32 f(A x) { B b = x as! B; return b.b; }\n`;
  const maybe = decls + `export i32 f(P p) { Q q = p as! Q; return q.m; }\n`;

  const warned = warnings(never);
  if (warned.length !== 1 || !warned[0].message.includes("always traps")) {
    throw new Error(`expected one trap warning, got ${JSON.stringify(warned)}`);
  }
  // A downcast that *can* hold is the whole reason `as!` exists — warning there would be a warning
  // on the language's own idiom.
  if (warnings(maybe).length !== 0) {
    throw new Error(`warned on a downcast that can hold: ${JSON.stringify(warnings(maybe))}`);
  }

  // And a generic stays out of both: its chain is what this checker does not model, so "cannot know"
  // must not become "never holds".
  const generic = `struct Box<T> { T v; }
struct A { i32 a; }
export i32 f(Box<A> b) { return b.v.a; }
`;
  if (warnings(generic).length !== 0) {
    throw new Error(`warned about a generic: ${JSON.stringify(warnings(generic))}`);
  }
});
