// The programs the wac spec says must be rejected, extracted from the spec's own test file.
//
// `spec/spec/*.md` carries 409 tagged assertions and `compiler/wacSpec.test.ts` executes them, one
// `Deno.test` per tag, named after it. The rejection ones call `err(...)` with a complete single-file
// program that must fail to compile — so the spec already contains a corpus of programs a type
// checker has to reject, and it is a better one than anything hand-written here: it is the language's
// own statement of what is illegal, it grows when the language does, and each case carries the tag
// that governs it.
//
// Extracted rather than copied. A copy is a second corpus that drifts the first time the spec gains a
// case, and the whole point of rung 3's oracle is that nothing here restates the language.
//
// Only `err(...)`, not `errMulti(...)`: multi-file cases need the resolver's import graph, and this
// slice of the checker reports nothing that depends on another module.

const SPEC_TEST = new URL(
  "../../../compiler/wacSpec.test.ts",
  import.meta.url,
).pathname;

export type SpecCase = { tag: string; name: string; src: string };

/**
 * The program a template literal *holds*, not the text it is written with.
 *
 * `'\\n'` in the file is `'\n'` in the program — one escape, spelled twice because a template
 * literal eats the first. Handing the written form to a lexer produces a character literal
 * containing a backslash and an `n`, which is not a program the spec ever ran: two of its accepted
 * programs came back as parse errors that way, and the reading — not the compiler — was wrong.
 */
function unescapeTemplate(raw: string): string {
  return raw.replace(/\\([\s\S])/g, (_, ch) => (ch === "`" || ch === "$" || ch === "\\" ? ch : "\\" + ch));
}

/**
 * Every `err(...)` program in the spec tests, with the tag of the test it belongs to.
 *
 * The shape being matched is stable and simple — a `Deno.test` whose name opens with the tag, whose
 * body calls `err` with one template literal:
 *
 *     Deno.test("[§wac-castop-lossy-k3myl2r] x as~ i64 is a compile error", () => {
 *       err(`export i64 bad(i32 x) { return x as~ i64; }`);
 *     });
 *
 * A test with several `err(...)` calls contributes each of them, all under the same tag.
 */
/**
 * Every `run(...)` program in the spec tests — the half of the contract that says what is **legal**.
 *
 * `specRejections` is what the language forbids; this is what it permits, and a checker has to be
 * held to both. Silence on these is the invariant this package treats as absolute, stated against
 * the specification rather than against the other implementation: a program the spec runs is a
 * program that compiles, whatever anything else thinks of it.
 *
 * Same scan as the rejections, one helper name along.
 */
export function specAcceptances(): SpecCase[] {
  return specPrograms(/\brun\(`([\s\S]*?)`\)/g);
}

export function specRejections(): SpecCase[] {
  return specPrograms(/\berr\(`([\s\S]*?)`\)/g);
}

function specPrograms(call: RegExp): SpecCase[] {
  const text = Deno.readTextFileSync(SPEC_TEST);
  const out: SpecCase[] = [];

  // Scanned in document order rather than by matching whole test bodies. A body regex has to know
  // where the test ends, and `\n});` is wrong for any body containing a nested block — it stopped at
  // the first one and found 67 of the 116 `err(` calls in the file. Position order needs no such
  // knowledge: every `err(...)` belongs to the last tag declared above it, which is exactly how the
  // file is laid out and does not depend on brace nesting.
  const marks: { at: number; tag: string; name: string }[] = [];
  for (const m of text.matchAll(/Deno\.test\(\s*"(\[§(wac-[a-z0-9-]+)\][^"]*)"/g)) {
    marks.push({ at: m.index!, tag: m[2], name: m[1] });
  }
  for (const e of text.matchAll(call)) {
    // A template literal with an interpolation is a generated program rather than a fixed one; skip
    // it rather than hand `${...}` to a lexer as source.
    if (e[1].includes("${")) continue;
    let owner = marks[0];
    for (const mark of marks) {
      if (mark.at < e.index!) owner = mark;
      else break;
    }
    if (owner === undefined) continue;
    out.push({ tag: owner.tag, name: owner.name, src: unescapeTemplate(e[1]) });
  }
  return out;
}
