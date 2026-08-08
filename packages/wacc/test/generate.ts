// Programs by cross product, for a differential sweep against the reference.
//
// Every grid in this package so far has had **hand-written axes** — the cast grid measured numeric
// pairs and so missed the whole `bool` row; the reachability grid varied where a fault sits and not
// which kind of node holds it. Both gaps were invisible until something else found them, which is the
// argument for generating the axes instead of listing them: a type added here appears in every
// context at once, and a context added here is asked about every type.
//
// This is not a specification of anything. It is a *program source*, and the sweep that consumes it
// asks the reference what each program means. Nothing here encodes an expectation — the moment this
// file believed it knew which programs were wrong, it would be a second implementation to disagree
// with rather than an input to a comparison.

/** The declarations every generated program can refer to. Kept small: it is prepended to each one. */
export const PRELUDE =
  "struct P { i32 x; } struct Base { i32 b; } struct Sub : Base { i32 s; } " +
  "enum E { A, B } struct Box<T> { T v; } ";

/**
 * The types each hole is filled with.
 *
 * Every family the checker distinguishes, one representative each: the integer widths differ in
 * signedness and size, `f32`/`f64` in width, and the reference kinds — array, struct, child struct,
 * nullable, enum, generic instantiation, funcref — differ in almost every rule.
 */
export const TYPES = [
  "i32",
  "i64",
  "u32",
  "u64",
  "f32",
  "f64",
  "bool",
  "string",
  "i32[]",
  "u8[]",
  "P",
  "P?",
  "Base",
  "Sub",
  "E",
  "Box<i32>",
  "fn[i32(i32)]",
];

/** Binary operators, which differ in what they demand of their operands and in what they produce. */
const BINOPS = ["+", "-", "*", "/", "%", "&", "|", "^", "<<", ">>", ">>>",
  "==", "!=", "<", "<=", ">", ">=", "&&", "||"];

/** The four cast spellings, which are a claim about what is happening rather than synonyms. */
const CASTS = ["as", "as!", "as~", "as@"];

export type Cell = { context: string; src: string };

/** A program per (context, type…) combination, in a stable order so a failure names a repeatable cell. */
export function generate(): Cell[] {
  const out: Cell[] = [];
  const add = (context: string, body: string) => out.push({ context, src: PRELUDE + body });

  for (const a of TYPES) {
    // One type: the contexts that ask a question about a value on its own.
    add("cond", `export void f(${a} a) { if (a) { } }`);
    add("while", `export void f(${a} a) { while (a) { } }`);
    add("not", `export void f(${a} a) { bool r = !a; }`);
    add("neg", `export void f(${a} a) { ${a} r = -a; }`);
    add("bitnot", `export void f(${a} a) { ${a} r = ~a; }`);
    add("incr", `export void f(${a} a) { a++; }`);
    add("unwrap", `export void f(${a} a) { a!; }`);
    add("isnull", `export void f(${a} a) { bool r = a is null; }`);
    add("call", `export void f(${a} a) { a(); }`);
    add("member", `export void f(${a} a) { a.x; }`);
    add("method", `export void f(${a} a) { a.nosuch(); }`);
    add("len", `export void f(${a} a) { a.len(); }`);
    add("switch", `export void f(${a} a) { switch (a) { default: { } } }`);
    add("arrsize", `export void f(${a} a) { i32[] v = i32[a](); }`);
    add("param", `export void f(${a} a) { }`);
    add("field", `struct Q { ${a} v; } export void f() { }`);
    add("default", `struct Q { ${a} v; } export void f() { Q q = Q(); }`);
    add("arrdefault", `export void f() { ${a}[] v = ${a}[2](); }`);

    // **Valid by construction.** Everything above is a fault looking for a rule, and only 5% of the
    // programs came out accepted — so the no-false-alarm half of the sweep, which is the half that
    // catches a checker being *wrong* rather than merely incomplete, was barely exercised. The
    // reference corpus proved the gap: it caught a nullable child going into a nullable parent, a
    // shape this file could not produce.
    //
    // These say nothing about which types support what. Each wraps the type in a declaration that
    // makes the use well-formed *whatever the type is* — a struct with a field of it, an array of it,
    // a function taking and returning it — so the axis stays generated rather than curated.
    add("ok-field", `struct W { ${a} v; } export ${a} f(W w) { return w.v; }`);
    add("ok-fieldset", `struct W { ${a} v; } export void f(W w, ${a} a) { w.v = a; }`);
    add("ok-method",
      `struct W { ${a} v; ${a} get(const this) { return this.v; } } export ${a} f(W w) { return w.get(); }`);
    add("ok-ctor", `struct W { ${a} v; } export W f(${a} a) { return W(a); }`);
    add("ok-elem", `export ${a} f(${a}[] xs) { return xs[0]; }`);
    add("ok-elemset", `export void f(${a}[] xs, ${a} a) { xs[0] = a; }`);
    add("ok-len", `export i32 f(${a}[] xs) { return xs.len(); }`);
    add("ok-call", `${a} g(${a} b) { return b; } export ${a} f(${a} a) { return g(a); }`);
    add("ok-funcref",
      `${a} g(${a} b) { return b; } export ${a} f(${a} a) { fn[${a}(${a})] h = g; return h(a); }`);
    add("ok-ternary", `export ${a} f(bool c, ${a} x, ${a} y) { return c ? x : y; }`);
    add("ok-widen", `export void f(${a} a) { ${a}? v = a; }`);
    add("ok-return-widen", `export ${a}? f(${a} a) { return a; }`);
    add("ok-unwrap", `export ${a} f(${a}? a) { return a!; }`);
    add("ok-isnull", `export bool f(${a}? a) { return a is null; }`);
    add("ok-nullfield", `struct W { ${a}? v; } export void f() { W w = W(); }`);
    add("ok-arrfill", `export void f(${a} a) { ${a}[] v = ${a}[2](fill: a); }`);
    add("ok-arrlit", `export void f(${a} a) { ${a}[] v = ${a}[](a, a); }`);
    add("ok-block", `export void f(${a} a, bool c) { if (c) { ${a} v = a; } else { ${a} w = a; } }`);
    add("ok-loop", `export void f(${a} a) { for (i32 i = 0; i < 2; i++) { ${a} v = a; } }`);
    add("ok-shadow", `export void f(${a} a) { { ${a} v = a; } { ${a} v = a; } }`);

    for (const b of TYPES) {
      // Two types: the contexts that put one where the other is expected.
      add("init", `export void f(${a} a) { ${b} v = a; }`);
      add("return", `export ${b} f(${a} a) { return a; }`);
      add("assign", `export void f(${a} a, ${b} b) { b = a; }`);
      add("arg", `void g(${b} b) { } export void f(${a} a) { g(a); }`);
      add("ctorarg", `struct Q { ${b} v; } export void f(${a} a) { Q q = Q(a); }`);
      add("elem", `export void f(${a} a) { ${b}[] v = ${b}[](a); }`);
      add("index", `export void f(${a} a, ${b} b) { a[b]; }`);
      add("compound", `export void f(${a} a, ${b} b) { a += b; }`);
      add("ternary", `export void f(bool c, ${a} a, ${b} b) { ${a} r = c ? a : b; }`);

      for (const op of CASTS) {
        add(`cast ${op}`, `export void f(${a} a) { ${b} v = a ${op} ${b}; }`);
      }
    }
  }

  // Operators get their own loop so the type pairs stay readable above.
  for (const a of TYPES) {
    for (const b of TYPES) {
      for (const op of BINOPS) {
        // The result goes into a slot of the **left** operand's type, so the cell asks two questions
        // at once: whether the operator accepts these operands, and whether what it produces is what
        // that side was. An earlier version wrapped the result in `is null` to force a diagnostic,
        // which measured the wrapper — every cell became a question about `is null` on a `bool`.
        add(`binop ${op}`, `export void f(${a} a, ${b} b) { ${a} r = a ${op} b; }`);
      }
    }
  }
  return out;
}

/**
 * A program the reference certainly rejects, and one it certainly accepts.
 *
 * The sweep asserts it finds both. A differential harness that compares nothing reports that
 * everything agrees, and every number it prints looks reassuring — these two are what make that
 * failure loud instead of silent.
 */
export const CANARY_REJECTED = 'export void f() { i32 x = "s"; }';
export const CANARY_ACCEPTED = "export i32 f(i32 a) { return a; }";
