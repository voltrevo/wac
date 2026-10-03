// A tree built by JSX in wac, rendered by a renderer written in JavaScript.
//
// This is the claim `design/lang/0004` rests on, and the reason `Node` is in `core` rather than in a
// package: **neither side declared the type.** The wac program never names it beyond
// `import { Attr, Node } from "core";` — the compiler emits the constructors — and the JavaScript here
// never declares it at all, because the generated glue builds the class from the module's own
// metadata. Two pieces of code that share nothing but the compiler agree on a value.
//
// If the tree came from a package, this test would be the thing that could not be written: a
// renderer built against one copy of a package's `Node` cannot accept trees made against another,
// and nothing either author writes bridges it.

import { waccArtifacts } from "../../../harness/waccBuild.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const PROGRAM = [
  'import { Attr, Node, html.div, html.h1, html.br } from "core";',
  "export Node page(string who) {",
  '  return <div class="page" id={"top"}><h1>hello {who}</h1><br/></div>;',
  "}",
  // A tag function and a fragment, which is the pair that has no counterpart on the JavaScript side:
  // the host never sees `pairOf`, only the `Node` it returned (spec ch23).
  "Node pairOf(string left, string right) {",
  '  return <><"b">{left}</"b"><"i">{right}</"i"></>;',
  "}",
  "export Node pair(string l, string r) { return <pairOf left={l} right={r}/>; }",
].join("\n");

/** The `Node` a host sees: `tag` is the *variant's* name, and each variant's fields are prefixed. */
type JsNode = {
  tag: string;
  Text_text: string;
  Element_tag: string;
  Element_attrs: { name: string; value: string }[];
  Element_kids: JsNode[];
  Fragment_kids: JsNode[];
};

function render(n: JsNode): string {
  if (n.tag === "Text") return n.Text_text;
  // A fragment is its children and no tag of its own — the one case a renderer cannot guess, and the
  // reason it is a variant the compiler forces every walk to handle rather than an empty tag.
  if (n.tag === "Fragment") return n.Fragment_kids.map(render).join("");
  let out = `<${n.Element_tag}`;
  for (const a of n.Element_attrs) out += ` ${a.name}="${a.value}"`;
  const kids = n.Element_kids;
  if (kids.length === 0) return `${out}/>`;
  return `${out}>${kids.map(render).join("")}</${n.Element_tag}>`;
}

Deno.test("a JSX tree crosses the boundary and a JavaScript renderer walks it", async () => {
  const { glue } = await waccArtifacts(new Map([["/t/main.wac", PROGRAM]]), "/t/main.wac");
  const dir = await Deno.makeTempDir({ prefix: "wac-jsxboundary-" });
  try {
    const path = `${dir}/page.gen.ts`;
    await Deno.writeTextFile(path, glue);
    const mod = await import(path) as {
      page(who: string): JsNode;
      pair(l: string, r: string): JsNode;
    };

    const tree = mod.page("world");
    assertEquals(
      render(tree),
      '<div class="page" id="top"><h1>hello world</h1><br/></div>',
    );

    // **`tag` is the variant, and `Element_tag` is the element's own** — two different things that
    // read alike, and getting them the wrong way round traps rather than answering wrongly: reading
    // `Element_tag` on a `Text` dereferences a null. Pinned here because the next reader will make
    // the same mistake I did.
    assertEquals(tree.tag, "Element");
    assertEquals(tree.Element_tag, "div");
    assertEquals(tree.Element_kids.map((k) => k.tag), ["Element", "Element"]);
    assertEquals(tree.Element_kids[0].Element_kids.map((k) => k.tag), ["Text", "Text"]);

    // **A tag function leaves nothing behind at the boundary.** What crosses is the tree `pairOf`
    // returned, which is a fragment of two elements.
    const p = mod.pair("l", "r");
    assertEquals(p.tag, "Fragment");
    assertEquals(render(p), "<b>l</b><i>r</i>");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
