// The single-file slice, on files whose imports are *not* supplied.
//
// This is the surface `corpusCheck` uses and the one rung 3 states its invariant against: a file
// checked alone must be silent about everything that depends on another module. The corpus asserts
// that over the repository, which is the widest evidence there is — and it only covers shapes the
// repository happens to contain. `issues/lang/0096` was one it did not: a file that matches on an
// *imported* enum while declaring an enum of its own that spells a variant the same way.
//
// Written as programs rather than as cases in `spec/cases`, because a case supplies every file it
// names and the reference resolves them. The defect lives in what a checker does with a name whose
// declaration it cannot see, which is a state a whole-program compiler never occupies.

import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const dumpTypeErrors = mod.dumpTypeErrors as (src: Uint8Array) => Int32Array;
const enc = new TextEncoder();

/** The codes this checker reports for one file, with nothing else supplied. */
function codes(src: string): number[] {
  const flat = Array.from(dumpTypeErrors(enc.encode(src)));
  const out: number[] = [];
  for (let i = 0; i < flat.length; i += 3) out.push(flat[i]);
  return out;
}

const IMPORTED = `import { Unzipped, unzip } from "./a.wac";\n`;
const LOCAL = `enum Object { Ok(i32 kind, u8[] content), Bad(string why) }\n`;

Deno.test("checked alone: a match on an imported enum says nothing about a local same-named variant", () => {
  // The reported shape: `raw` was bound to the *local* `Ok`'s first payload — an `i32` — and every
  // use of it reported. `packages/git`'s `object.wac`, before it renamed its variants.
  const src = IMPORTED + LOCAL + `export i32 f(u8[] file) {
  match (unzip(file)) {
    case Bad(why): { return 0; }
    case Ok(raw): { return raw.len(); }
  }
}
`;
  const got = codes(src);
  if (got.length > 0) throw new Error(`refused a file whose subject is imported: codes ${got.join(",")}`);
});

Deno.test("checked alone: the arm's siblings are quiet too when the subject is imported", () => {
  // Arity, exhaustiveness and `is` resolve variants the same way, and a bare name that collides with
  // an imported enum's is exactly what none of them can settle.
  const shapes: [string, string][] = [
    ["a binding count the local enum would refuse",
     `export i32 f(u8[] b) { match (unzip(b)) { case Bad(w): { return 0; } case Ok(a, c): { return 1; } } }`],
    ["arms that cover the imported enum but not the local one",
     `export i32 f(u8[] b) { match (unzip(b)) { case Ok(raw): { return 1; } case Bad(w): { return 0; } } }`],
    ["a type test on an imported value",
     `export i32 f(u8[] b) { return unzip(b) is Ok ? 1 : 0; }`],
    ["a payload read through a narrowed import",
     `export i32 f(u8[] b) { match (unzip(b)) { case Ok(raw): { return raw.len(); } case Bad(w): { return w.len(); } } }`],
  ];
  const loud: string[] = [];
  for (const [what, body] of shapes) {
    const got = codes(IMPORTED + LOCAL + body + "\n");
    if (got.length > 0) loud.push(`${what}: codes ${got.join(",")}`);
  }
  if (loud.length > 0) throw new Error(`refused ${loud.length} of ${shapes.length}:\n  ${loud.join("\n  ")}`);
});

Deno.test("checked alone: a local enum is still checked, so the rule above is not blanket silence", () => {
  // The canary. Every assertion here is that something is *not* reported, and the way to pass those
  // by accident is to report nothing at all — so one program that must be refused, in the same file
  // shape, with the same names.
  const src = LOCAL + `export i32 f() {
  match (Object.Ok(1, u8[0]())) {
    case Ok(kind, content): { return kind; }
  }
}
`;
  const got = codes(src);
  if (got.length === 0) {
    throw new Error("a local match missing an arm was accepted — the checker is silent, not correct");
  }
});
