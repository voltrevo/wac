// wapy printer tests.
//
// `spec/tour.wac` is the whole language in one file that compiles and self-tests, so printing
// it is a coverage test for free: a construct the printer does not know shows up as an
// `unhandled` tally rather than as plausible-looking output.
//
// The rest are the renderings worth pinning, chosen because they are the ones where the
// mapping made a decision rather than a transliteration.

import { wapyOf } from "./wapy.ts";

// Local helpers rather than a JSR import, matching the house pattern in
// `atoms/wac/*.test.ts` — this repo has no third-party dependencies and should not gain one
// for two assertions.
function assertEquals(got: unknown, want: unknown, msg = ""): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error(`${msg}\n  got:  ${g}\n  want: ${w}`);
}

function assertStringIncludes(hay: string, needle: string): void {
  if (!hay.includes(needle)) {
    throw new Error(`missing: ${JSON.stringify(needle)}\n--- output ---\n${hay}`);
  }
}

function wapy(src: string): string {
  return wapyOf(src, "test.wac").text;
}

Deno.test("the language tour prints with no unhandled construct", async () => {
  const src = await Deno.readTextFile(new URL("../spec/tour.wac", import.meta.url));
  const { text, unhandled } = wapyOf(src, "spec/tour.wac");
  assertEquals(unhandled, [], `unhandled: ${unhandled.join(", ")}`);
  // A printer that emitted nothing would also have no unhandled constructs.
  if (text.split("\n").length < 300) throw new Error(`suspiciously short: ${text.split("\n").length} lines`);
});

Deno.test("a counted for becomes a range, and the loop variable stays scoped", () => {
  const out = wapy(`
    export i32 f(i32[] xs) {
      i32 t = 0;
      for (i32 i = 0; i < xs.len(); i++) { t += xs[i]; }
      for (i32 i = 0; i < xs.len(); i++) { t += xs[i]; }
      return t;
    }
  `);
  assertStringIncludes(out, "for i in range(0, xs.len()):");
  // Twice, and neither declares `i` — which is the point: hoisting it would produce two
  // declarations of the same name in one scope, which wac rejects even though Python does not.
  assertEquals(out.match(/for i in range/g)?.length, 2);
  assertEquals(out.includes("i: i32 = 0"), false);
});

Deno.test("a step other than ++ becomes range's third argument", () => {
  const out = wapy(`
    export i32 f(i32 n) {
      i32 t = 0;
      for (i32 i = 0; i < n; i += 2) { t += i; }
      return t;
    }
  `);
  assertStringIncludes(out, "for i in range(0, n, 2):");
});

Deno.test("a loop that is not counted falls back, and says so", () => {
  // Decrementing, so not a range. The fallback hoists the variable and cannot round-trip,
  // which is exactly why it is marked in the output rather than left to be discovered.
  const out = wapy(`
    export i32 f(i32 n) {
      i32 t = 0;
      for (i32 i = n; i > 0; i--) { t += i; }
      return t;
    }
  `);
  assertStringIncludes(out, "# for: not a counted loop");
  assertStringIncludes(out, "while i > 0:");
});

Deno.test("receiver forms map onto self", () => {
  const out = wapy(`
    export struct P {
      f64 x;
      P create(f64 x) { return P(x); }
      f64 get(const this) { return this.x; }
      void set(this, f64 v) { this.x = v; }
    }
  `);
  assertStringIncludes(out, "def create(x: f64) -> P:");   // static: no receiver
  assertStringIncludes(out, "def get(const self) -> f64:");
  assertStringIncludes(out, "def set(self, v: f64) -> void:");
  // Uses of `this` in the body have to agree with the signature.
  assertStringIncludes(out, "return self.x");
  assertEquals(out.includes("this"), false);
});

Deno.test("nullable, unwrap and is-null", () => {
  const out = wapy(`
    export struct Node { i32 val; Node? next; }
    export i32 sum(Node? head) {
      i32 t = 0;
      Node? cur = head;
      while (cur is not null) { t += cur!.val; cur = cur!.next; }
      return t;
    }
  `);
  assertStringIncludes(out, "next: Node | None");
  assertStringIncludes(out, "while cur is not None:");
  assertStringIncludes(out, "t += cur!.val");   // postfix unwrap survives; see wapy.ts
});

Deno.test("generics, subtyping and enums", () => {
  const out = wapy(`
    export struct Shape { f64 x; }
    export struct Rect : Shape { f64 w; }
    export struct Vec<T> { i32 n; }
    export enum Opt<T> { Some(T v), Nil
      bool has(const this) { return match (this) { case Some(_): true, case Nil: false }; }
    }
  `);
  assertStringIncludes(out, "class Rect(Shape):");
  assertStringIncludes(out, "class Vec[T]:");
  assertStringIncludes(out, "class Opt[T](enum):");
  assertStringIncludes(out, "Some(v: T)");
  // match stays an expression — folding it into Python's statement form would make the
  // reverse direction guess at intent.
  assertStringIncludes(out, "return match self { case Some(_): True, case Nil: False }");
});

Deno.test("operators that have Python spellings take them", () => {
  const out = wapy(`
    export bool f(bool a, bool b, i32 x) {
      if (a && b) { return !a; }
      if (a || b) { return true; }
      i32 y = a ? 1 : 2;
      return x as~ bool;
    }
  `);
  assertStringIncludes(out, "if a and b:");
  assertStringIncludes(out, "return not a");
  assertStringIncludes(out, "if a or b:");
  assertStringIncludes(out, "y: i32 = 1 if a else 2");
  assertStringIncludes(out, "return x as~ bool");   // casts keep their spelling
});

Deno.test("an empty body is pass, not nothing", () => {
  const out = wapy(`export void f() { }`);
  assertStringIncludes(out, "def f() -> void:\n    pass");
});

Deno.test("a file that does not parse throws rather than printing rubbish", () => {
  let threw = false;
  try { wapy(`export i32 f( {`); } catch { threw = true; }
  assertEquals(threw, true);
});
