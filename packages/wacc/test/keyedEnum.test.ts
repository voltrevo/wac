// A name the linker keyed, reaching the generated glue.
//
// Two files declaring one name are kept apart by a key — `Node@2` — and where the declaring file is
// known that key is spelled as a qualified name instead (`Node___packages_tor_src_network`). Where
// it is *not* known, the key itself is what the metadata carries, and `@` is not a TypeScript
// identifier. Every position the generator writes a type name in goes through `classNameOf`, which
// sanitises it; two did not, and produced glue that would not parse:
//
//     static Element(tag: string, attrs: Attr[], kids: Node$2[]): Node@2 {
//     SyntaxError: Expected '{', got '@'
//
// It took `core` gaining an enum with a payload — and `packages/tor` already having a `Node` — for
// anything to have two of them. This asks the generator directly rather than trying to reproduce
// the condition, because the condition is "a path table that was not loaded" and the property is
// "no name reaches the output unsanitised".

import { generate } from "../tools/waccBindgen.ts";

Deno.test("a keyed name is sanitised in every position the glue writes it", () => {
  // The smallest module that has one: an enum with a payload, named as the linker keys a second
  // declaration. The wasm is a bare header — nothing here instantiates it.
  const wasm = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
  const glue = generate(
    wasm,
    [{ name: "make", ret: "Node@2", params: [] }],
    [{
      kind: "enum",
      name: "Node@2",
      bind: "Node__two",
      fields: [],
      variants: [
        { name: "Element", payload: [{ name: "tag", type: "string" }] },
        { name: "Text", payload: [] },
      ],
      methods: [],
    }],
  );

  // The glue's own doc comments quote the wac name, `@` and all, which is right — a comment is not
  // an identifier. Only code is checked.
  const offending = glue.split("\n")
    .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*"))
    .filter((l) => /[A-Za-z0-9_]@/.test(l));
  if (offending.length > 0) {
    throw new Error(
      `${offending.length} line(s) carry a keyed name TypeScript cannot parse:\n  ${offending[0]}`,
    );
  }

  // And the enum is actually in there — a generator that dropped it would also have no `@`.
  if (!glue.includes("class Node$2")) {
    throw new Error(`no class for the keyed enum; glue begins:\n${glue.slice(0, 300)}`);
  }
});
