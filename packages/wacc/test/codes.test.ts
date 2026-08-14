// **Error codes, checked by value.** `issues/system/0005`'s largest single finding.
//
// Sixteen of wacc's twenty surviving mutants are error-code constants: replace `errUnexpectedChar`'s
// body with `return 0` and the whole suite stays green. The reason is written in `test/lex.test.ts`
// already — "the wac side reports codes rather than messages, so the mapping is checked by the order
// they occur in" — so positions and counts are compared against the reference and the codes are not.
// Two distinct errors could share a code, or every code could be zero, and nothing would notice.
//
// That matters more than it sounds. A code is the one field wacc uses to say *what went wrong*;
// `diag.wac` turns it into the sentence a person reads, and the rungs that compare diagnostics
// against the reference compare position and order. So the field the message is derived from is the
// field nothing checks.
//
// ## Why a table of programs rather than asserting the constants
//
// Asserting `errUnexpectedChar() === 1` would kill the mutants and prove nothing: it restates the
// constant. What is worth pinning is the **mapping** — this program produces that code — because
// that is what a reader of a diagnostic depends on and what a mutant silently breaks.
//
// So each row below is the smallest program that provokes one diagnostic, and the assertion is which
// code came out. A mutant that returns 0 from any of these constants makes some row report 0.
//
// ## And the property that catches the shared-code mistake
//
// A table alone cannot see two *different* faults sharing one code, because each row only looks at
// its own. The last test asserts the codes across the whole table are distinct, which is the shape
// `one code, two faults` describes: a shared code makes a message name one rule while the other
// fault is what happened.

import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac") as unknown as {
  dumpErrors(src: Uint8Array): Int32Array;
  dumpParseErrors(src: Uint8Array): Int32Array;
  dumpTypeErrors(src: Uint8Array): Int32Array;
};

const enc = new TextEncoder();

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

/** The code of the first diagnostic a dump reports, or -1 when it reported none. */
const firstCode = (out: Int32Array) => (out.length >= 3 ? out[0] : -1);

/**
 * One row: the smallest source that provokes one diagnostic, and the code it must carry.
 *
 * The codes are written as numbers rather than read from the constants on purpose. Reading them back
 * from `errUndefinedName()` would make this table agree with whatever the constant says, including
 * with a mutant that made it zero — which is the entire failure being closed here. The constant's
 * *name* is in a comment beside each, so a reader can find the declaration without the test being
 * able to follow it.
 */
type Row = { what: string; src: string; code: number };

/**
 * Lexer codes. `dumpErrors` reports the lexer's first and then the parser's, so a row here has to be
 * something `lex` itself refuses — an unterminated literal, an unknown escape — rather than merely
 * a character the parser then chokes on. `@` is the latter: it lexes fine and fails at code 20.
 */
const LEX: Row[] = [
  { what: "a string with no closing quote", code: 2,  // errUnterminatedString
    src: 'export i32 f() { string s = "oops; return 0; }' },
];

/** Parser codes. */
const PARSE: Row[] = [
  { what: "a type name where a type must be", code: 20,  // perrExpected
    src: "export i32 f() { 3 x = 1; return x; }" },
  { what: "nothing where an expression must be", code: 22,  // perrBadPrimary
    src: "export i32 f() { return 1 + ; }" },
];

/** Checker codes. */
const CHECK: Row[] = [
  { what: "a name nothing declares", code: 35,  // errUndefinedName
    src: "export i32 f() { return nope; }" },
  { what: "assigning to a const variable", code: 10,  // errConstVariable
    src: "export i32 f() { const i32 k = 1; k = 2; return k; }" },
  { what: "a call with the wrong number of arguments", code: 32,  // errCallArity
    src: "void g(i32 a) {} export i32 f() { g(); return 0; }" },
  { what: "a field the struct does not have", code: 39,  // errNoSuchField
    src: "struct S { i32 v; } export i32 f() { S s = S(1); return s.w; }" },
  { what: "a match on something that is not an enum", code: 72,  // errMatchNotEnum
    src: "export i32 f(i32 n) { match (n) { else: { return 0; } } return 1; }" },
];

function codesOf(rows: Row[], dump: (src: Uint8Array) => Int32Array): number[] {
  return rows.map((r) => firstCode(dump(enc.encode(r.src))));
}

Deno.test("each lexer diagnostic carries the code it is supposed to", () => {
  const got = codesOf(LEX, mod.dumpErrors);
  for (let i = 0; i < LEX.length; i++) {
    assertEquals(got[i], LEX[i].code, `${LEX[i].what}: ${JSON.stringify(LEX[i].src)}`);
  }
});

Deno.test("each parser diagnostic carries the code it is supposed to", () => {
  const got = codesOf(PARSE, mod.dumpParseErrors);
  for (let i = 0; i < PARSE.length; i++) {
    assertEquals(got[i], PARSE[i].code, `${PARSE[i].what}: ${JSON.stringify(PARSE[i].src)}`);
  }
});

Deno.test("each checker diagnostic carries the code it is supposed to", () => {
  const got = codesOf(CHECK, mod.dumpTypeErrors);
  for (let i = 0; i < CHECK.length; i++) {
    assertEquals(got[i], CHECK[i].code, `${CHECK[i].what}: ${JSON.stringify(CHECK[i].src)}`);
  }
});

Deno.test("and the codes within one phase are distinct", () => {
  // The property a per-row table cannot see. Two faults sharing a code means a reader gets a sentence
  // naming one rule when the other is what happened — and the row for each would still pass, because
  // each row only ever looks at its own answer.
  for (const [phase, rows] of [["lex", LEX], ["parse", PARSE], ["check", CHECK]] as const) {
    const seen = new Map<number, string>();
    for (const r of rows) {
      const had = seen.get(r.code);
      if (had !== undefined) {
        throw new Error(`${phase}: "${r.what}" and "${had}" both report code ${r.code}`);
      }
      seen.set(r.code, r.what);
    }
  }
});

Deno.test("a program with nothing wrong reports nothing, in every phase", () => {
  // The control. Without it, a compiler that reported code 1 for everything would pass every row
  // above that happens to expect 1 — and a compiler that reported *nothing* would fail them all,
  // which is the direction that already fails loudly. This is the other direction.
  const fine = "export i32 f() { i32 x = 1; return x + 1; }";
  assertEquals(mod.dumpErrors(enc.encode(fine)).length, 0, "the lexer");
  assertEquals(mod.dumpParseErrors(enc.encode(fine)).length, 0, "the parser");
  assertEquals(mod.dumpTypeErrors(enc.encode(fine)).length, 0, "the checker");
});
