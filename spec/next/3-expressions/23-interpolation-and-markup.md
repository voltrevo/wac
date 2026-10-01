# 23 — Interpolation and markup

Two pieces of syntax turn values into something else. Interpolation turns a value into text, through core's
`toString` symbol. Markup builds a tree of `Node`, an ordinary type from `core`, and turns each child into a
node through core's `toNode` symbol. Neither is a general implicit conversion: each applies only at its own
syntax.

## Interpolation

`\{` inside a double-quoted literal begins an embedded expression, ended by the matching `}`. The value is
converted once through core's `toString` symbol, and the result is concatenated with the text around it:

```wac
// expect: answers main = 1
import { toString } from "core";

struct Label {
  string text;
  string [toString](const this) { return this.text; }
}

export i32 main() {
  Label label = Label("hello");
  string a = label.[toString]();           // "hello"
  string b = "label: \{label}";            // "label: hello"
  return a == "hello" && b == "label: hello" ? 1 : 0;
}
```

`[§wac-interp-tostring-2qpb4rs]` `"…\{e}…"` converts `e` once through core's `toString` symbol and concatenates
the result with the surrounding text. The conversion used must return `string`.

For a string value the conversion is the string itself, so interpolating strings means exactly what `+` does:

```wac
// expect: answers main = 10
string two() { return "xy"; }

export i32 main() {
  i32 a = "a\{two()}b".len();              // 4: "a" + "xy" + "b"
  i32 b = "\{two()}".len();                // 2
  i32 c = "\{two() + "\{two()}"}".len();   // 4
  return a + b + c;
}
```

`[§wac-str-interp-sugar-k3nq7wm]` For a string expression, `"a\{e}b"` is the same as `"a" + e + "b"`:
`"a\{two()}b".len()` is `4`.

`[§wac-str-interp-alone-d8mf2xq]` A literal may be nothing but an interpolation: `"\{two()}".len()` is `2`.

`[§wac-str-interp-nest-r4kw9np]` The braces are matched, so an interpolated expression may contain string
literals that interpolate in turn: `"\{two() + "\{two()}"}".len()` is `4`.

`\{` is the only new spelling. A literal backslash before a brace is `\\{` — an escaped backslash followed by
an ordinary `{`.

A method merely spelled `toString` does not implement the conversion:

```wac
// expect: emits
struct Other {
  string toString(const this) { return "hello"; }
}

export i32 main() {
  Other value = Other();
  string s = value.toString();             // "hello": an ordinary named method

  // ERROR: Other has no implementation of core's toString symbol
  // string t = "\{value}";

  return 0;
}
```

`[§wac-interp-needs-symbol-9hp7jmf]` Interpolating a value whose type does not implement core's `toString` symbol is
refused, whatever its other methods are called.

## Markup

A markup element is an expression that evaluates to a `Node`:

```wac
// fragment — core's tree
export struct Attr {
  string name;
  string value;
}

export enum Node {
  Element(string tag, Attr[] attrs, Node[] kids),
  Text(string text),
  Fragment(Node[] kids),
}
```

Every tag is a name in scope. A tag is a function, its attributes are that function's named parameters, and
its children are its `kids` parameter. So nothing here is a thing the language knows about beyond the syntax:
`<p>` calls whatever `p` is in scope, and the HTML elements are ordinary functions in `core`
([43](../7-library/43-markup-types.md)).

```wac
// expect: answers main = 1
import { Node, html.div, html.p } from "core";

Node greeting(string who, Node[] kids) {
  return <p class="hi">Hello, {who}</p>;
}

Node page(string who) {
  return <div><greeting who={who} /></div>;
}

export i32 main() {
  Node n = page("wac");
  return match (n) {
    Element(tag, attrs, kids): tag == "div" && kids.len() == 1 ? 1 : 0,
    default: 0,
  };
}
```

`[§wac-markup-tag-is-function-vv4pvhq]` `<t a={x} …>…</t>` calls the function `t` in scope, passing each attribute
to the parameter of that name and the children to its `kids` parameter. Its value is what `t` returns.

A tag that is yours is called the same way as one from an import. Markup is a tree of ordinary values, which a
program builds, returns, stores and walks.

### A quoted tag is an element by name

A tag written as a string is not looked up: it builds `Node.Element` with that name. A quoted name may be any
name, which is how a custom element or a namespaced one is written:

```wac
// expect: answers main = 1
import { Node } from "core";

Node icon() { return <"my-widget" data-size="8" />; }

Node caption(Node[] kids) { return <"label">{kids}</"label">; }

Node one()   { return <caption>Name</caption>; }       // calls caption
Node two()   { return <@"caption">Name</@"caption">; } // calls caption: a verbatim name
Node three() { return <"caption">Name</"caption">; }   // the caption element

export i32 main() {
  return match (three()) {
    Element(tag, attrs, kids): tag == "caption" ? 1 : 0,
    default: 0,
  };
}
```

`[§wac-markup-quoted-tag-3dnrvxj]` A tag written as a string literal builds `Node.Element` with that name, its
attributes as `Attr`s and its children as `kids`. Nothing is looked up.

`[§wac-markup-verbatim-tag-ca3myup]` A tag written as a verbatim name `@"…"` is a name in scope, like a bare tag.

### Attributes

An attribute name is written as in HTML, running to `=`, whitespace, `/` or `>`, so a hyphen needs no
escaping. A name a parameter could not otherwise have — a keyword, a hyphenated word — reaches a parameter
written as a verbatim name ([01](../1-programs/01-names-and-identity.md)):

```wac
// expect: answers main = 1
import { Node } from "core";

Node label(string id, string @"for", Node[] kids) {
  return <"label" id={id} for={@"for"}>{kids}</"label">;
}

Node widget(string @"data-size", Node[] kids) {
  return <"my-widget" data-size={@"data-size"} />;
}

export i32 main() {
  Node a = <label id="who" for="name">Name</label>;
  Node b = <widget data-size="8" />;
  return 1;
}
```

`[§wac-markup-attr-verbatim-param-yd3farv]` An attribute whose name is a keyword or contains a hyphen fills the
parameter whose verbatim name is that text: `for=` fills `@"for"`, `data-size=` fills `@"data-size"`.

An attribute's value is written as a string literal or as `{expr}`, and is checked against the parameter's type.
An attribute is written once:

```wac
// expect: emits
import { Node } from "core";

export i32 main() {
  Node ok = <"div" class="card" />;

  // ERROR: an attribute is written once
  // Node bad = <"div" class="a" class="b" />;

  return 0;
}
```

`[§jsx-attribute-written-once]` Writing an attribute twice on one element is refused — the tree cannot express
precedence, and taking one silently is the behaviour not to inherit.

### Children

Text between tags is a `Node.Text` child. A child written `{expr}` is converted through core's `toNode` symbol:
strings become text nodes, and nodes remain nodes.

```wac
// fragment — Node and div come from core
import { toString, toNode } from "core";

struct Label {
  string text;

  string [toString](const this) { return this.text; }
  Node [toNode](const this) { return Node.Text(this.text); }
}

void example() {
  Label label = Label("hello");
  Node existingNode = Node.Text("already a node");

  label.[toNode]();            // Node.Text("hello")
  <div>{label}</div>;          // child: Node.Text("hello")
  <div>{"hello"}</div>;        // child: Node.Text("hello")
  <div>{existingNode}</div>;   // child: existingNode
}
```

```wac
// expect: answers main = 4
import { Node, toNode, html.div } from "core";

struct Label {
  string text;
  Node [toNode](const this) { return Node.Text(this.text); }
}

export i32 main() {
  Label label = Label("hello");
  Node existing = Node.Text("already a node");
  Node n = <div>text {label}{"hello"}{existing}</div>;
  return match (n) {
    Element(tag, attrs, kids): kids.len(),
    default: 0,
  };
}
```

`[§jsx-text-is-a-child]` Text between tags is a `Node.Text` child.

`[§wac-markup-child-tonode-vp842rw]` A `{expr}` child is converted through core's `toNode` symbol, which must
return `Node`. A `Node` is itself; a `string` becomes `Node.Text`.

Markup child conversion uses the designated `toNode` symbol exported by `core`. Text and node conversions are
separate operations and may produce different representations.

### Markup is an ordinary expression

An element nests wherever an expression does, and inside `{…}` the text is wac again, so `>` is whatever it
means there:

```wac
// expect: answers main = 2
import { Node } from "core";

i32 take(Node n) { return 1; }

export i32 main() {
  i32 x = 2;
  Node cmp = <"div" a={x > 1 ? "y" : "n"} />;   // a comparison
  Node inner = <"div">{<"b" />}</"div">;         // an element in an expression in an element
  Node chosen = x > 1 ? <"a" /> : <"b" />;       // a ternary's branches
  return take(<"p"><"i" /><"i" /></"p">) + 1;    // an argument
}
```

`[§jsx-nests-in-expressions]` An element may stand anywhere an expression may, and `>` inside `{…}` is an
operator, not the end of a tag.

A closing tag names the element it closes:

```wac
// expect: emits
import { Node } from "core";

export i32 main() {
  // ERROR: </"span"> does not close <"div">
  // Node bad = <"div"></"span">;

  Node ok = <"div"></"div">;
  return 0;
}
```

`[§jsx-closing-tag-names-its-element]` A closing tag that does not name the element it closes is refused, and the
diagnostic names both.

### Text is not wac

Between an element's tags the lexer reads text, so nothing there starts a string, a character literal, a comment
or an operator. A run ends at `{`, or at a `<` that begins a tag:

```wac
// expect: answers main = 1
import { Node } from "core";

export i32 main() {
  Node a = <"p">it's here, a " b, see http://x</"p">;
  Node b = <"p">1 < 2 and 3 > 2</"p">;           // a < before neither a name nor / is text
  return 1;
}
```

`[§jsx-text-is-not-wac-source]` Text between tags is not read as wac: quotes, `//` and operators there are text.
A `<` followed by neither a name nor `/` is text.

### Whitespace

A run of text is trimmed at an end only where the whitespace there contains a newline. So markup written over
several lines loses its indentation, and a space within a line is kept, because it is part of the sentence:

```wac
// expect: answers main = 1
import { Node } from "core";

i32 count(Node n) {
  return match (n) {
    Element(t, a, kids): kids.len(),
    default: 0,
  };
}

export i32 main() {
  Node sameLine = <"div"><"b">a</"b"> <"b">b</"b"></"div">;   // three children: the space is text
  Node twoLines = <"div">
    <"b">a</"b">
    <"b">b</"b">
  </"div">;                                                     // two: the breaks are layout
  return count(sameLine) == 3 && count(twoLines) == 2 ? 1 : 0;
}
```

`[§jsx-whitespace-breaks-are-layout]` A text run is trimmed at an end exactly where the whitespace there contains
a newline.

`[§jsx-empty-run-is-not-a-child]` A run the trimming empties is not a child.

### Fragments

`<>…</>` is an element with no tag. It evaluates to `Node.Fragment(kids)` — several nodes where one is wanted:

```wac
// expect: answers main = 2
import { Node } from "core";

Node pair(Node a, Node b) { return <>{a}{b}</>; }

export i32 main() {
  return match (pair(Node.Text("x"), Node.Text("y"))) {
    Fragment(kids): kids.len(),
    default: 0,
  };
}
```

`[§jsx-fragment-is-a-node]` `<>…</>` evaluates to `Node.Fragment` of its children. It takes no attributes, and
closes with `</>`.

`Fragment` is a variant like any other, so a renderer that walks the tree must handle it: `match` is exhaustive.

## Imports preserve the designated identity

```wac
// fragment
import { toString as text } from "core";

struct Label {
  string [text](const this) { return "hello"; }
}
// Still implements core's toString; interpolation works.
```

```wac
// fragment
symbol toString;              // fresh identity, unrelated to core's symbol

struct Label {
  string [toString](const this) { return "hello"; }
}
// Does not implement interpolation's conversion.
```

```wac
// expect: answers main = 1
import { toString as text } from "core";

struct Label {
  string [text](const this) { return "hello"; }
}

export i32 main() { return "\{Label()}" == "hello" ? 1 : 0; }
```

`[§wac-conversion-symbol-identity-4ga8txc]` A conversion is implemented by a method named by core's symbol, under
whatever alias it was imported. A fresh symbol spelled the same does not implement it.

These are conversions at the relevant syntax, not general implicit conversions. No ordinary method or field name
is reserved.

## Built-in conversions

`toString` and `toNode` are exported directly from `core`, not `core.operators`. Intrinsic types receive these
implementations from the compiler and core; no external implementation mechanism is introduced.

| Type | `toString` | `toNode` |
| --- | --- | --- |
| `string` | The string itself | `Node.Text` containing the string |
| `bool` | `"true"` or `"false"` | Text containing that spelling |
| Every integer primitive | Decimal digits, a minus sign if negative, no grouping | Text containing that spelling |
| Every floating-point primitive | Shortest decimal that round-trips to the same float type | Text containing that spelling |
| `Node` | No implementation | The node itself |

Float special spellings are `"NaN"`, `"Infinity"`, `"-Infinity"`, and `"-0"`.

```wac
// expect: answers main = 1
import { Node, html.div } from "core";

export i32 main() {
  i32 n = 42;
  i32 m = -7;
  bool flag = false;
  f64 half = 0.5;
  f64 negZero = -0.0;
  string s = "answer: \{n} \{m} \{flag} \{half} \{negZero}";
  Node node = <div>{n}</div>;              // child: Node.Text("42")
  return s == "answer: 42 -7 false 0.5 -0" ? 1 : 0;
}
```

`[§wac-tostring-builtin-4t3buvz]` `bool`, every integer and every float type implement `toString` and `toNode` as the
table says: decimal for integers, the shortest round-tripping decimal for floats, and `true` or `false`.

```wac
// fragment — with toString/toNode imported, and div/Node supplied by the HTML API
void example() {
  i32 n = 42;
  bool flag = false;
  string text = "<b>hello</b>";
  Node node = Node.Text("hello");

  n.[toString]();              // "42"
  "answer: \{n}";             // "answer: 42"
  <div>{n}</div>;              // child: Node.Text("42")
  <div>{flag}</div>;           // child: Node.Text("false"), not omitted
  <div>{text}</div>;           // text, never parsed as markup
  node.[toNode]();             // node itself

  // ERROR: Node has no toString implementation
  // "markup: \{node}";
}
```

No automatic conversions are supplied for nullable values, arrays, tuples, user-defined structs, or enums. An
author can implement the symbols on a type; callers handle absence or convert collections explicitly. `Node`'s
identity implementation is the specified exception among enum types.

```wac
// expect: emits
import { Node, html.div } from "core";

export i32 main() {
  string? name = null;
  Node a = <div>{name ?? "unknown"}</div>;

  // ERROR: string? has no toNode conversion
  // Node b = <div>{name}</div>;

  i32[] xs = [1, 2];

  // ERROR: i32[] has no toString conversion
  // string c = "\{xs}";

  return 0;
}
```

`[§wac-conversion-none-for-compound-urda9vz]` Nullable values, arrays, tuples, structs and enums have no built-in
`toString` or `toNode`; interpolating or nesting one that does not implement the symbol is refused.

Implementing `toString` does not automatically grant `toNode`. A type wanting both can delegate explicitly:

```wac
// fragment — inside a type with a toString implementation
Node [toNode](const this) {
  return Node.Text(this.[toString]());
}
```

## Open

- **Float formatting.** Exact scientific-notation thresholds and the remaining formatting details belong to the
  formatting specification.
- **Attributes a tag function does not declare.** Whether a tag function's parameters may have defaults, so an
  attribute can be omitted, and whether spread, namespaced and boolean-shorthand attributes exist, is not
  decided.
- **HTML serialisation and rendering.** These are library APIs, outside the language.
