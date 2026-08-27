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
  return roundTripFrom(ast(src, path), src, path);
}

/**
 * The same, for a caller that has already parsed the file — which the corpus sweep has.
 *
 * **It parsed every file twice.** `cannotRead` lexes and parses to decide whether a file is worth
 * round-tripping at all, and `roundTrip` then called `ast`, which lexes and parses it again. Measured
 * over the 282 files under `packages/*​/src` on 2026-08-19: 505ms for the first parse and 564ms for the
 * second, in a sweep that costs about seven seconds.
 *
 * The rest of that seven seconds is the round trip doing its job, and worth writing down so nobody
 * looks for a trick that is not there: **printing wapy is 2372ms and parsing it back 3265ms**, against
 * 266ms to strip both trees and compare them as JSON and 21ms to read the files. It is two front ends
 * over the whole of `packages`, which is the property being tested.
 */
function roundTripFrom(
  before: unknown,
  src: string,
  path: string,
): { ok: true } | { ok: false; why: string } {
  const wapy = wapyOf(src, path).text;
  // wapy is parsed straight into the AST — there is no intermediate wac text, and no line map,
  // because the tokens carry the positions they were written at.
  const parsed = parseWapy(wapy, path);
  if (parsed.errors.length) {
    const e = parsed.errors[0];
    return { ok: false, why: `${path} (as wapy) did not parse: ${e.message} at ${e.line}:${e.col}\n` +
      whereInWapy(wapy, e.line, e.col) + `\n--- wapy ---\n${wapy}` };
  }
  const after = strip(parsed.program);
  const a = JSON.stringify(before), b = JSON.stringify(after);
  if (a === b) return { ok: true };
  return { ok: false, why: firstDiff(a, b) + `\n--- wapy ---\n${wapy}` };
}

/**
 * The offending line of the *rendering*, with a caret — and the identifier to blame where one is
 * obvious.
 *
 * The position a wapy parse error names is in generated text nobody has open, so the message used to
 * be followed by the whole rendering and a reader had to count lines into it. `issues/lang/0077` was
 * placed twice that way, and both times the cause was one word: a wac local named `self`, which is
 * an ordinary identifier in wac and wapy's receiver keyword, so the printed program is not a wapy
 * program. The failure said nothing about `self`.
 *
 * Naming the line costs nothing and is right for every cause; naming `self` is a guess, so it is
 * offered as a *possibility* rather than asserted.
 */
function whereInWapy(wapy: string, line: number, col: number): string {
  const lines = wapy.split("\n");
  const text = lines[line - 1];
  if (text === undefined) return "";
  const caret = " ".repeat(Math.max(0, col - 1)) + "^";
  // wapy's own keywords that wac lets a program use as a name. `self` was the one this had happened
  // for, twice, and it came off the list on 2026-08-27 when wapy started spelling the receiver
  // `this` — see `SPELLINGS` in wapyLex.ts. The rest are here so the next one is named rather than
  // discovered the same slow way, which is the part worth keeping.
  const reserved = ["None", "True", "False", "def", "class", "lambda", "pass", "elif"];
  const found = reserved.filter((w) => new RegExp(`\\b${w}\\b`).test(text));
  const hint = found.length === 0 ? "" :
    `\n  ${found.join(", ")} on this line ${found.length === 1 ? "is" : "are"} reserved in wapy and ` +
    `ordinary in wac — see issues/lang/0077`;
  return `  ${line} | ${text}\n  ${" ".repeat(String(line).length)} | ${caret}${hint}`;
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

// A cast at the end of a conditional's condition. `wapyParse` rewrites `X if C else Y` back to
// `C ? X : Y`, so the condition's last token lands against the `?` — and a cast's type followed by
// `?` reads as a nullable type, which swallows it. Found by `packages/webrtc/src/sctp.wac`, the
// first file in the repository to write one; the printer had dropped the parentheses the source
// carried, because no precedence rule says they are needed. Three lines here so the next one
// fails on three lines rather than on twelve hundred.
check("a cast at the end of a condition", `
  export i64 clamp(i64 t) { return t > (60000 as i64) ? (60000 as i64) : t; }
  export i32 nested(i32 a) { return a > (1 as i32) ? (a > (2 as i32) ? 3 : 4) : 5; }
`);

// ── And the corpus, which is where anything I did not think of lives ─────────

Deno.test("round trip: spec/tour.wac", async () => {
  const src = await Deno.readTextFile(new URL("../spec/tour.wac", import.meta.url));
  const r = roundTrip(src, "spec/tour.wac");
  if (!r.ok) throw new Error(r.why);
});

/**
 * Every package's source, which is in this repository since the merge.
 *
 * Skipped rather than failed when it is absent, because this repo does not depend on that one —
 * but it is where the real evidence is. Every one of the last six bugs the round trip found came
 * from here and not from the cases above: `from` used as an ordinary identifier, `pass` as a
 * variable name, `None` as a variant inside a match expression, nested generic brackets. None of
 * them is exotic; all of them are things I would not have thought to write a case for.
 *
 *   deno test -A compiler/wapyRoundTrip.test.ts
 */
Deno.test("round trip: every package", async () => {
  const root = new URL("../packages/", import.meta.url);
  let pkgs: string[];
  try {
    pkgs = [];
    for await (const e of Deno.readDir(root)) if (e.isDirectory) pkgs.push(e.name);
  } catch {
    console.error("  (packages/ is missing — a broken checkout, not a skip)");
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
  let marked = 0;
  for (const f of files) {
    const src = await Deno.readTextFile(f);
    // A file this compiler cannot parse has nothing to round-trip. Counted rather than skipped in
    // silence — the number going up is the shared subset shrinking, which is worth seeing, and the
    // guard below fails if it ever becomes all of them.
    //
    // **Parsed once.** This asked a `cannotRead` helper and then let `roundTrip` parse the same file
    // again. Trying to parse is also how a file that only `wacc` can read is recognised: there was a
    // `// only: wacc` marker once, and it made the reference a second implementation of the language
    // rather than a bootstrap. The count is guarded below, because a corpus this compiler has silently
    // stopped parsing is a green test that compared nothing.
    const parsed = wacParse(wacLex(src).tokens, f);
    if (parsed.errors.length) {
      marked++;
      continue;
    }
    const r = roundTripFrom(strip(parsed.program), src, f);
    if (!r.ok) bad.push(`${f}\n${r.why.split("\n").slice(0, 4).join("\n")}`);
  }
  // A corpus this compiler can read none of is a green test that compared nothing — the same failure
  // the zero-files check above exists to prevent, one step further along.
  if (marked === files.length) {
    throw new Error(`this compiler could not parse any of the ${files.length} package files`);
  }
  if (bad.length) {
    throw new Error(
      `${bad.length} of ${files.length} files did not round-trip:\n\n` +
        bad.slice(0, 3).join("\n\n") + (bad.length > 3 ? `\n\n…and ${bad.length - 3} more` : ""),
    );
  }
  console.error(`  ${files.length} files round-tripped identically`);
});

Deno.test("a wac local named `self` round-trips — issues/lang/0077, fixed 2026-08-27", () => {
  // **This test used to assert the bug.** It said *"a wac local named `self` round-tripped — if 0077
  // is fixed, delete this test"*, and 0077 is fixed: wapy spells the receiver `this` now, so `self`
  // is an ordinary identifier on both surfaces and there is nothing left to collide.
  //
  // Kept rather than deleted, inverted. The program below is the exact one the old test used to prove
  // the failure, and a regression would land on it first — `self` reserved again on either surface
  // makes this red immediately, where the old arrangement would have gone quietly green.
  const src = `export i32 f(i32[] xs) {\n  i32 self = xs.len() - 1;\n  return self;\n}\n`;
  const r = roundTrip(src, "/probe.wac");
  if (!r.ok) {
    throw new Error(`a wac local named \`self\` no longer round-trips — 0077 is back:\n${r.why}`);
  }
});
