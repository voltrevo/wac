// Generates `test/vendor/json5.json` from `json5`, the reference implementation of the format
// `packages/json`'s JSON5 mode reads.
//
//     deno run -A packages/json/tools/vendorJson5.ts > packages/json/test/vendor/json5.json
//
// Run by hand. The corpus is committed, so the tests need no network and cannot start passing
// because a download failed. `json5` on npm is the implementation the specification at json5.org
// is written against, so "what does JSON5 say" and "what does this package say" have one answer
// here rather than being a reading of the prose.
//
// **What the menu cannot emit, so a clean sweep does not claim it.** Every input below is built
// from the fragment lists in `cases`, and two shapes are left out deliberately because the
// comparison itself would be wrong rather than because they work:
//
//   - **Duplicate member names.** `JsonObject` keeps every one; a JavaScript object keeps the
//     last, so `JSON.stringify` on the reference side would drop members that our text has. The
//     JSON parser has the same property and `roundtrip.test.ts` covers it there.
//   - **Names that look like array indices.** `{"2":1,"1":2}` comes back from `JSON.stringify` in
//     numeric order, because that is what a JavaScript object does with integer-like keys. Ours
//     is in source order. The disagreement is the oracle's representation, not the parse.
//
// Both are properties of routing the reference's answer through a JavaScript object, so they
// would not be fixed by a different corpus — they need a different oracle, and the JSON-superset
// invariant in `json5.test.ts` is that oracle for exactly these shapes.

import JSON5 from "npm:json5@2.2.3";

/** Every whitespace character JSON5 has and JSON does not, one per entry. */
const SPACES = [
  "\u000B", "\u000C", "\u00A0", "\u1680", "\u2000", "\u2001", "\u2005", "\u200A",
  "\u2028", "\u2029", "\u202F", "\u205F", "\u3000", "\uFEFF",
];

const NUMBERS = [
  "0", "1", "-1", "+1", "1.", "-1.", "+1.", ".5", "-.5", "+.5", "1.5", "0.0", "-0",
  "0x0", "0x1f", "0X1F", "-0x10", "+0x10", "0xdeadbeef", "0xFFFFFFFFFFFFFFFF", "0x",
  "Infinity", "-Infinity", "+Infinity", "NaN", "-NaN", "+NaN", "infinity", "nan",
  "1e5", "1E5", "1e+5", "1e-5", "1.e5", ".5e5", "1.5e5", "1e", ".e5", ".",
  "01", "00", "08", "-01", "1_0", "0b11", "0o17", "1n", "- 1", "+ 1", "--1", "0x1p3",
  "9007199254740993", "1e309", "1e-400", "0.1", "1.7976931348623157e308",
];

const STRINGS = [
  `"a"`, `'a'`, `''`, `""`, `'a"b'`, `"a'b"`, `'\\''`, `"\\""`, `'\\"'`, `"\\'"`,
  `'\\v'`, `'\\0'`, `'\\01'`, `'\\1'`, `'\\9'`, `'\\x41'`, `'\\x4'`, `'\\xzz'`, `'\\x'`,
  `'\\q'`, `'\\A'`, `'\\\\'`, `'\\n'`, `'\\u0041'`, `'\\u00'`, `'\\é'`, `'\\\u2028'`,
  `'a\\\nb'`, `'a\\\rb'`, `'a\\\r\nb'`, `'a\\\u2028b'`, `'a\\\u2029b'`,
  `'a\nb'`, `'a\tb'`, `'é'`, `'\u00e9'`, `'a`, `"a`, `'a"`, `"a'`,
];

const KEYS = [
  "a", "$", "_", "$a", "_a", "a1", "a_b", "A", "null", "true", "false", "Infinity", "NaN",
  "1a", "a-b", "a b", "", "-a", ".a", "é", "\\u0041", "'a'", `"a"`, "'a\"b'",
  // The same two in the *second* position. A name is scanned by two different pieces of code —
  // the first character decides whether there is a name at all — and a list that only ever put
  // the interesting character first left both of the continuation branches unreached.
  "aé", "a\\u0041", "a1é", "$a\\u0042",
];

const COMMENTS = [
  "//c\n1", "// c\n1", "//\n1", "1//c", "1//c\n", "/*c*/1", "1/*c*/", "/*c*/", "//c",
  "/**/1", "/***/1", "/*/*/1", "/*c1", "/1", "1/", "[/*c*/1]", "[1/*c*/]", "[1,/*c*/2]",
  "{/*c*/a:1}", "{a/*c*/:1}", "{a:/*c*/1}", "{a:1/*c*/}", "{a:1,/*c*/}",
  "//c\u2028 1", "//c\u2029 1", "/*\n*/1",
];

const STRUCTURE = [
  "[]", "{}", "[1,2,]", "[1,2,,]", "[,]", "[,1]", "[1,,2]", "{a:1,}", "{a:1,,}", "{,}", "{,a:1}",
  "[[1,],]", "{a:{b:1,},}", "[{a:1,},]", "{a:[1,]}", "1,", "[1] [2]", "{a:1}{b:2}", "",
  " ", "\n", "[", "]", "{", "}", "[1", "{a:1", "{a}", "{a:}", "{:1}", "{a::1}", "{a:1:2}",
];

function build(): string[] {
  const out: string[] = [...NUMBERS, ...STRINGS, ...COMMENTS, ...STRUCTURE];
  for (const s of SPACES) {
    out.push(`${s}1`, `1${s}`, `[${s}1${s}]`, `{${s}a${s}:${s}1${s}}`, `${s}`);
  }
  for (const k of KEYS) out.push(`{${k}:1}`, `{${k}:1,b:2}`);
  // Every number and string also inside a container, so the value parser is reached from all
  // three of its call sites rather than only as a whole document.
  for (const n of [...NUMBERS, ...STRINGS]) out.push(`[${n}]`, `{a:${n}}`);
  return out;
}

const rows = build().map((input) => {
  try {
    const value = JSON5.parse(input);
    return { input, json: JSON.stringify(value) ?? "undefined" };
  } catch {
    return { input, json: null };
  }
});

const seen = new Set<string>();
const unique = rows.filter((r) => (seen.has(r.input) ? false : (seen.add(r.input), true)));

console.log(JSON.stringify({
  source: "npm:json5@2.2.3 — the reference implementation of json5.org 1.0.0",
  note: "json is JSON.stringify of the parsed value; null means the reference rejected the input",
  cases: unique,
}, null, 2));
