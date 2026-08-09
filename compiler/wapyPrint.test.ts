// wapy printer tests.
//
// `spec/tour.wac` is a broad sample rather than full coverage — it has no enums and one
// generic — so printing it catches a construct the printer does not know, but the real
// coverage evidence is `wapyRoundTrip.test.ts`, which runs over all of wac-mono.
//
// The rest are the renderings worth pinning, chosen because they are the ones where the
// mapping made a decision rather than a transliteration.

import { wapyOf } from "./wapyPrint.ts";

// Local helpers rather than a JSR import, matching the house pattern in
// `compiler/*.test.ts` — this repo has no third-party dependencies and should not gain one
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

Deno.test("a loop that is not counted keeps its three clauses", () => {
  // Decrementing, so not a range. The first version hoisted the loop variable into an
  // enclosing `while`, which changes its scope and cannot round-trip — two such loops in one
  // function would declare the same name twice, which wac rejects even though Python does not.
  const out = wapy(`
    export i32 f(i32 n) {
      i32 t = 0;
      for (i32 i = n; i > 0; i--) { t += i; }
      return t;
    }
  `);
  assertStringIncludes(out, "for i: i32 = n; i > 0; i--:");
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
  assertStringIncludes(out, "y: i32 = 1 if a else 2");   // always parenthesised
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

// ── Comments ─────────────────────────────────────────────────────────────────
//
// Recovered from the gaps between adjacent tokens rather than by re-scanning the source, so
// a `//` inside a string literal cannot be mistaken for a comment — the real lexer already
// decided that.

Deno.test("comments survive, in their places", () => {
  const out = wapy(`
    // a file comment
    /** A doc comment.
     * Second line. */
    export i32 f(i32 x) {
      // above the statement
      i32 y = x + 1;   // trailing
      return y;
    }
  `);
  assertStringIncludes(out, "# a file comment");
  assertStringIncludes(out, "## A doc comment.");
  assertStringIncludes(out, "## Second line.");
  assertStringIncludes(out, "    # above the statement");
  assertStringIncludes(out, "y: i32 = x + 1  # trailing");
  // The doc comment belongs above its function, not inside it.
  const lines = out.split("\n");
  const doc = lines.findIndex((l) => l.includes("## A doc comment"));
  const def = lines.findIndex((l) => l.startsWith("def f"));
  assertEquals(doc < def && doc >= 0, true, "doc comment should precede its def");
});

Deno.test("a doc comment and a line comment stay distinguishable", () => {
  const out = wapy(`
    /** doc */
    // line
    export void f() { }
  `);
  assertStringIncludes(out, "## doc");
  assertStringIncludes(out, "# line");
  // `#` and `##` are what let the trip back tell `//` from `/** */`.
  assertEquals(out.includes("## line"), false);
});
