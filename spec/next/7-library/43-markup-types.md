# 43 — Markup types

Markup builds a tree of `Node`, declared in `core` so that every program and every repository builds the same one
([23](../3-expressions/23-interpolation-and-markup.md)).

```wac
// fragment — from core
struct Attr {
  string name;
  string value;
}

enum Node {
  Element(string tag, Attr[] attrs, Node[] kids),
  Text(string text),
  Fragment(Node[] kids),
}
```

`Fragment` is a variant rather than an element with an empty tag, so that a renderer is told: `match` is exhaustive,
and a walk written before fragments existed stops compiling with the arm it is missing named. An empty tag would have
rendered as `<>` in every renderer that had not heard of them.

A tree is an ordinary value, built and walked like any other:

```wac
// expect: answers main = 2
import { Node, Attr } from "core";

i32 countText(Node n) {
  return match (n) {
    Text(t):                   1,
    Element(tag, attrs, kids): sumKids(kids),
    Fragment(kids):            sumKids(kids),
  };
}

i32 sumKids(Node[] kids) {
  i32 total = 0;
  for (Node k in kids) { total += countText(k); }
  return total;
}

export i32 main() {
  Node tree = Node.Element("p", [Attr("class", "hi")], [Node.Text("a"), Node.Fragment([Node.Text("b")])]);
  return countText(tree);
}
```

`[§wac-node-tree-b4hr8je]` `Node` is an enum of `Element(tag, attrs, kids)`, `Text(text)` and `Fragment(kids)`, and `Attr` a
struct of `name` and `value`.

## HTML tag functions

`core.html` holds a function per HTML element, each building a `Node.Element` with its own name. Its attributes are named
parameters, and its children are its `kids`:

```wac
// expect: answers main = 1
import { Node, html.p } from "core";

export i32 main() {
  Node n = <p class="hi">Hello</p>;
  return match (n) {
    Element(tag, attrs, kids): tag == "p" && attrs.len() == 1 && kids.len() == 1 ? 1 : 0,
    default: 0,
  };
}
```

`[§wac-html-tag-functions-sb9cij9]` Each function in `core.html` answers `Node.Element` with its element's name, one `Attr` per
attribute written, and its children as `kids`.

An attribute left out of a tag is absent from the element's `attrs`.

## Open

- **The HTML element and attribute set.** Which elements `core.html` declares, and which attributes each accepts, is not
  yet written down.
- **Rendering.** Serialising a tree to HTML, and rendering one in a page, are library APIs outside the language.
