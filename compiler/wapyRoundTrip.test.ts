// The round trip: wac → wapy → wac must produce the same syntax tree.
//
// This is the test that makes a second surface safe rather than a permanent tax. If the two
// forms can only differ in ways the parser cannot see, then a language feature cannot be added
// to one and forgotten in the other — the test goes red.
//
// It compares **syntax trees, not text**. Text comparison would fail on whitespace and on the
// printer's deliberate canonicalisations (redundant parentheses removed, `for` rewritten as a
// range); tree comparison fails only when meaning changed, which is the property that matters.
//
// Positions are stripped before comparing, because a reflowed file legitimately has different
// line numbers — and they are *correct* wapy positions, not wac ones, which is the point of
// `wapyRead` producing tokens rather than text. Everything else must match exactly, including
// the fields the type checker would later fill in; those are absent in both, since neither is
// checked.

import { wacLex } from "./wacLex.ts";
import { wacParse } from "./wacParse.ts";
import { wapyOf } from "./wapyPrint.ts";
import { wapyParse as parseWapy } from "./wapyParse.ts";

/**
 * Drop `line`/`col` recursively, normalise absent-vs-undefined, and sort keys.
 *
 * Keys are sorted because the trees are compared as JSON, and JSON preserves insertion order —
 * so without this the test would be asserting that the two frontends build their object
 * literals in the same order, which is not a property of the language. Every other difference
 * still fails.
 */
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (k === "line" || k === "col" || k === "span") continue;
      const val = (v as Record<string, unknown>)[k];
      if (val === undefined) continue;
      out[k] = strip(val);
    }
    return out;
  }
  return v;
}

function ast(src: string, path: string) {
  const p = wacParse(wacLex(src).tokens, path);
  if (p.errors.length) {
    throw new Error(`${path} did not parse: ${p.errors[0].message} at ${p.errors[0].line}`);
  }
  return strip(p.program);
}

/** The whole trip, returning a diff-friendly description of the first difference. */
export function roundTrip(src: string, path: string): { ok: true } | { ok: false; why: string } {
  const before = ast(src, path);
  const wapy = wapyOf(src, path).text;
  // wapy is parsed straight into the AST — there is no intermediate wac text, and no line map,
  // because the tokens carry the positions they were written at.
  const parsed = parseWapy(wapy, path);
  if (parsed.errors.length) {
    const e = parsed.errors[0];
    return { ok: false, why: `${path} (as wapy) did not parse: ${e.message} at ${e.line}:${e.col}\n--- wapy ---\n${wapy}` };
  }
  const after = strip(parsed.program);
  const a = JSON.stringify(before), b = JSON.stringify(after);
  if (a === b) return { ok: true };
  return { ok: false, why: firstDiff(a, b) + `\n--- wapy ---\n${wapy}` };
}

function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 90);
  return `trees differ at offset ${i}:\n  before: …${a.slice(from, i + 90)}\n  after:  …${b.slice(from, i + 90)}`;
}

function check(name: string, src: string) {
  Deno.test(`round trip: ${name}`, () => {
    const r = roundTrip(src, `${name}.wac`);
    if (!r.ok) throw new Error(r.why);
  });
}

// ── The constructs, one at a time, so a failure names itself ─────────────────

check("functions and calls", `
  i32 helper(i32 x) { return x * 2; }
  export i32 double(i32 x) { return helper(x); }
  export void nothing() { return; }
`);

check("precedence is preserved", `
  export i32 f(i32 a, i32 b, i32 c) {
    i32 x = (a + b) * c;
    i32 y = a + b * c;
    i32 z = (a | b) & c;
    i32 w = a - (b - c);
    bool p = a < b == b < c;
    return x + y + z + w;
  }
`);

check("all four casts", `
  export i32 f(f64 x, i32 y) {
    i32 a = x as! i32;
    i32 b = x as~ i32;
    i32 c = y as@ i32;
    i64 d = y as i64;
    return a + b + c;
  }
`);

check("structs, fields, receivers", `
  export struct P {
    f64 x;
    const f64 y;
    P create(f64 x) { return P(x, 0.0); }
    f64 get(const this) { return this.x; }
    void set(this, f64 v) { this.x = v; }
  }
  export struct Q : P { f64 z; }
`);

check("generics", `
  export struct Vec<T> { i32 n; }
  export T pick<T>(T a, T b, bool c) { return c ? a : b; }
  export Vec<i32> make() { return Vec<i32>(0); }
`);

check("enums, variants, match expression and statement", `
  export enum Opt<T> {
    Some(T v), Nil
    bool has(const this) { return match (this) { case Some(_): true, case Nil: false }; }
    T get(const this, T d) {
      match (this) {
        case Some(v): return v;
        case Nil: return d;
      }
    }
  }
`);

check("nullable, unwrap, is-null", `
  export struct Node { i32 val; Node? next; }
  export i32 sum(Node? head) {
    i32 t = 0;
    Node? cur = head;
    while (cur is not null) { t += cur!.val; cur = cur!.next; }
    if (head is null) { return 0; }
    return t;
  }
`);

check("if / else if / else chains", `
  export i32 f(i32 x) {
    if (x < 0) { return -1; }
    else if (x == 0) { return 0; }
    else if (x < 10) { return 1; }
    else { return 2; }
  }
`);

check("loops of every shape", `
  export i32 f(i32[] xs, i32 n) {
    i32 t = 0;
    for (i32 i = 0; i < xs.len(); i++) { t += xs[i]; }
    for (i32 i = 0; i < n; i += 2) { t += i; }
    for (i32 i = n; i > 0; i--) { t += i; }
    while (t > 100) { t -= 1; }
    do { t++; } while (t < 5);
    return t;
  }
`);

check("switch with default", `
  export i32 f(i32 d) {
    switch (d) {
      case 0: { return 0; }
      case 6: { return 0; }
      default: { return 1; }
    }
  }
`);

check("arrays: sized, literal, fill, nested", `
  export i32 f() {
    i32[] a = i32[5]();
    u8[] b = u8[](1, 2, 3);
    i32[] c = i32[3](fill: -1);
    u8[][] d = u8[][2](fill: u8[0]());
    return a.len() + b.len() + c.len() + d.len();
  }
`);

check("funcrefs", `
  export i32 fold(fn[i32(i32, i32)] f, i32[] xs) {
    i32 acc = 0;
    for (i32 i = 0; i < xs.len(); i++) { acc = f(acc, xs[i]); }
    return acc;
  }
`);

check("booleans, null, logical operators", `
  export bool f(bool a, bool b) {
    if (a && b) { return !a; }
    if (a || b) { return true; }
    return false;
  }
`);

check("increments as statements and expressions", `
  export i32 f(i32 x) {
    i32 y = x;
    y++;
    y--;
    i32 z = y++;
    i32 w = ++y;
    return z + w;
  }
`);

check("consts, imports, trap", `
  const i32 LIMIT = 10;
  export const f64 PI = 3.14;
  export i32 f(i32 x) {
    if (x > LIMIT) { trap; }
    return x;
  }
`);

check("a bare block", `
  export i32 f() {
    i32 a = 1;
    {
      i32 b = 2;
      a = a + b;
    }
    return a;
  }
`);

check("empty bodies", `
  export void f() { }
  export struct Empty { }
`);

// ── And the corpus, which is where anything I did not think of lives ─────────

Deno.test("round trip: spec/tour.wac", async () => {
  const src = await Deno.readTextFile(new URL("../../spec/tour.wac", import.meta.url));
  const r = roundTrip(src, "spec/tour.wac");
  if (!r.ok) throw new Error(r.why);
});

/**
 * The whole of wac-mono, when it is checked out beside this repo.
 *
 * Skipped rather than failed when it is absent, because this repo does not depend on that one —
 * but it is where the real evidence is. Every one of the last six bugs the round trip found came
 * from here and not from the cases above: `from` used as an ordinary identifier, `pass` as a
 * variable name, `None` as a variant inside a match expression, nested generic brackets. None of
 * them is exotic; all of them are things I would not have thought to write a case for.
 *
 *   deno test -A atoms/wac/wapyRoundTrip.test.ts
 */
Deno.test("round trip: all of wac-mono", async () => {
  const root = new URL("../../../wac-mono/packages/", import.meta.url);
  let pkgs: string[];
  try {
    pkgs = [];
    for await (const e of Deno.readDir(root)) if (e.isDirectory) pkgs.push(e.name);
  } catch {
    console.error("  (wac-mono not checked out beside this repo — skipped)");
    return;
  }

  const files: string[] = [];
  for (const p of pkgs) {
    try {
      for await (const e of Deno.readDir(new URL(`${p}/src/`, root))) {
        if (e.name.endsWith(".wac")) files.push(new URL(`${p}/src/${e.name}`, root).pathname);
      }
    } catch { /* a package with no src/ */ }
  }
  // A silent pass over nothing is worse than a skip: this test moved directories once and
  // kept reporting green against zero files.
  if (files.length === 0) throw new Error(`no .wac files under ${root.pathname}`);

  const bad: string[] = [];
  for (const f of files) {
    const r = roundTrip(await Deno.readTextFile(f), f);
    if (!r.ok) bad.push(`${f}\n${r.why.split("\n").slice(0, 4).join("\n")}`);
  }
  if (bad.length) {
    throw new Error(
      `${bad.length} of ${files.length} files did not round-trip:\n\n` +
        bad.slice(0, 3).join("\n\n") + (bad.length > 3 ? `\n\n…and ${bad.length - 3} more` : ""),
    );
  }
  console.error(`  ${files.length} files round-tripped identically`);
});
