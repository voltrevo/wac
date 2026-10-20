// A tree built by markup in wac, rendered by a renderer written in JavaScript.
//
// **Neither side shares a declaration with the other.** The tree is the program's own — markup names no
// type (`design/lang/0017`): the program's enum builds its text, quoted tags and fragments with methods
// named by core's `markup` symbols — and the JavaScript here never declares it at all, because the
// generated glue builds the class from the module's own metadata. Two pieces of code that share nothing
// but the compiler agree on a value.
//
// `design/lang/0004` put `Node` in `core` so that this would be possible. It is possible without that,
// which is what this test now says.

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
  'import { markup } from "core";',
  "export struct Attr { string name; string value; }",
  "export enum Node {",
  "  Element(string tag, Attr[] attrs, Node[] kids),",
  "  Text(string text),",
  "  Fragment(Node[] kids),",
  "  Node [markup.text](string text) { return Node.Text(text); }",
  "  Node [markup.fragment](Node[] kids) { return Node.Fragment(kids); }",
  "  Node [markup.element](string tag, string[] names, string[] values, Node[] kids) {",
  '    Attr[] attrs = Attr[].filled(names.len(), Attr("", ""));',
  "    for (i32 i = 0; i < names.len(); i++) { attrs[i] = Attr(names[i], values[i]); }",
  "    return Node.Element(tag, attrs, kids);",
  "  }",
  "}",
  "export Node page(string who) {",
  '  return <"div" class="page" id={"top"}><"h1">hello {who}</"h1"><"br"/></"div">;',
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
