# 23 — Interpolation and markup

Two pieces of syntax turn values into something else. Interpolation turns a value into text, through core's
`toString` symbol. Markup builds a tree of `Node`, an ordinary type from `core`, and turns each child into a
node through core's `toNode` symbol. Neither is a general implicit conversion: each applies only at its own
syntax.

## Interpolation

`\{` inside a double-quoted literal begins an embedded expression, ended by the matching `}`. The value is
converted once through core's `toString` symbol, and the result is concatenated with the text around it:

```wac
// expect: answers converted = "hello"
// expect: answers interpolated = "label: hello"
import { toString } from "core";

struct Label {
  string text;
  string [toString](const this) { return this.text; }
}

export string converted() { return Label("hello").[toString](); }

export string interpolated() {
  Label label = Label("hello");
  return "label: \{label}";
}
```

`[§wac-interp-tostring-2qpb4rs]` `"…\{e}…"` converts `e` once through core's `toString` symbol and concatenates
the result with the surrounding text. The conversion used must return `string`.

For a string value the conversion is the string itself, so interpolating strings means exactly what `+` does:

```wac
// expect: answers around = "axyb"
// expect: answers alone = "xy"
// expect: answers nested = "xyxy"
string two() { return "xy"; }

export string around() { return "a\{two()}b"; }           // "a" + "xy" + "b"
export string alone() { return "\{two()}"; }
export string nested() { return "\{two() + "\{two()}"}"; }
```

`[§wac-str-interp-sugar-k3nq7wm]` For a string expression, `"a\{e}b"` is the same as `"a" + e + "b"`:
`"a\{two()}b"` is `"axyb"`.

`[§wac-str-interp-alone-d8mf2xq]` A literal may be nothing but an interpolation: `"\{two()}"` is `"xy"`.

`[§wac-str-interp-nest-r4kw9np]` The braces are matched, so an interpolated expression may contain string
literals that interpolate in turn: `"\{two() + "\{two()}"}"` is `"xyxy"`.

`\{` is the only new spelling. A literal backslash before a brace is `\\{` — an escaped backslash followed by
an ordinary `{`.

A method merely spelled `toString` does not implement the conversion:

```wac
// expect: answers named = "hello"
struct Other {
  string toString(const this) { return "hello"; }
}

export string named() {
  Other value = Other();

  // ERROR: Other has no implementation of core's toString symbol
  // string t = "\{value}";

  return value.toString();                 // an ordinary named method
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
// expect: answers pageTag = "div"
// expect: answers pageChildren = 1
import { Node, html.div, html.p } from "core";

Node greeting(string who, Node[] kids) {
  return <p class="hi">Hello, {who}</p>;
}

Node page(string who) {
  return <div><greeting who={who} /></div>;
}

export string pageTag() {
  return match (page("wac")) {
    Element(tag, attrs, kids): tag,
    default: "",
  };
}

export i32 pageChildren() {
  return match (page("wac")) {
    Element(tag, attrs, kids): kids.len(),
    default: -1,
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
// expect: answers icon = "my-widget"
// expect: answers one = "label"
// expect: answers two = "label"
// expect: answers three = "caption"
import { Node } from "core";

string tagOf(Node n) {
  return match (n) {
    Element(tag, attrs, kids): tag,
    default: "",
  };
}

Node caption(Node[] kids) { return Node.Element("label", [], kids); }

export string icon()  { return tagOf(<"my-widget" data-size="8" />); }
export string one()   { return tagOf(<caption>Name</caption>); }       // calls caption
export string two()   { return tagOf(<@"caption">Name</@"caption">); } // calls caption: a verbatim name
export string three() { return tagOf(<"caption">Name</"caption">); }   // the caption element
```

`[§wac-markup-quoted-tag-3dnrvxj]` A tag written as a string literal builds `Node.Element` with that name, its
attributes as `Attr`s and its children as `kids`. Nothing is looked up.

`[§wac-markup-verbatim-tag-ca3myup]` A tag written as a verbatim name `@"…"` is a name in scope, like a bare tag.

### Attributes

An attribute name is written as in HTML, running to `=`, whitespace, `/` or `>`, so a hyphen needs no
escaping. A name a parameter could not otherwise have — a keyword, a hyphenated word — reaches a parameter
written as a verbatim name ([01](../1-programs/01-names-and-identity.md)):

```wac
// expect: answers labelFor = "name"
// expect: answers widgetSize = "8"
import { Node, Attr } from "core";

Node label(string id, string @"for", Node[] kids) {
  return Node.Element("label", [Attr("id", id), Attr("for", @"for")], kids);
}

Node widget(string @"data-size", Node[] kids) {
  return <"my-widget" data-size={@"data-size"} />;
}

string attr(Node n, string name) {
  match (n) {
    Element(tag, attrs, kids): {
      for (Attr a in attrs) {
        if (a.name == name) { return a.value; }
      }
    }
    default: { }
  }
  return "";
}

export string labelFor() { return attr(<label id="who" for="name">Name</label>, "for"); }
export string widgetSize() { return attr(<widget data-size="8" />, "data-size"); }
```

`[§wac-markup-attr-verbatim-param-yd3farv]` An attribute whose name is a keyword or contains a hyphen fills the
parameter whose verbatim name is that text: `for=` fills `@"for"`, `data-size=` fills `@"data-size"`.

An attribute's value is written as a string literal or as `{expr}`, and is checked against the parameter's type.
An attribute is written once:

```wac
// expect: emits
import { Node } from "core";

export Node card() {
  // ERROR: an attribute is written once
  // Node bad = <"div" class="a" class="b" />;

  return <"div" class="card" />;
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
// expect: answers childCount = 4
import { Node, toNode, html.div } from "core";

struct Label {
  string text;
  Node [toNode](const this) { return Node.Text(this.text); }
}

export i32 childCount() {
  Label label = Label("hello");
  Node existing = Node.Text("already a node");
  Node n = <div>text {label}{"hello"}{existing}</div>;   // "text ", then three conversions
  return match (n) {
    Element(tag, attrs, kids): kids.len(),
    default: -1,
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
// expect: answers asArgument = 2
import { Node } from "core";

i32 kidCount(Node n) {
  return match (n) {
    Element(tag, attrs, kids): kids.len(),
    default: -1,
  };
}

export Node comparison(i32 x) { return <"div" a={x > 1 ? "y" : "n"} />; }   // a comparison
export Node inner() { return <"div">{<"b" />}</"div">; }         // an element in an expression in an element
export Node chosen(i32 x) { return x > 1 ? <"a" /> : <"b" />; }  // a ternary's branches
export i32 asArgument() { return kidCount(<"p"><"i" /><"i" /></"p">); }   // an argument
```

`[§jsx-nests-in-expressions]` An element may stand anywhere an expression may, and `>` inside `{…}` is an
operator, not the end of a tag.

A closing tag names the element it closes:

```wac
// expect: emits
import { Node } from "core";

export Node closed() {
  // ERROR: </"span"> does not close <"div">
  // Node bad = <"div"></"span">;

  return <"div"></"div">;
}
```

`[§jsx-closing-tag-names-its-element]` A closing tag that does not name the element it closes is refused, and the
diagnostic names both.

### Text is not wac

Between an element's tags the lexer reads text, so nothing there starts a string, a character literal, a comment
or an operator. A run ends at `{`, or at a `<` that begins a tag:

```wac
// expect: answers quotes = "it's here, a \" b, see http://x"
// expect: answers lessThan = "1 < 2 and 3 > 2"
import { Node } from "core";

string text(Node n) {
  return match (n) {
    Element(tag, attrs, kids): match (kids[0]) {
      Text(t): t,
      default: "",
    },
    default: "",
  };
}

export string quotes() { return text(<"p">it's here, a " b, see http://x</"p">); }
export string lessThan() { return text(<"p">1 < 2 and 3 > 2</"p">); }   // a < before neither a name nor / is text
```

`[§jsx-text-is-not-wac-source]` Text between tags is not read as wac: quotes, `//` and operators there are text.
A `<` followed by neither a name nor `/` is text.

### Whitespace

A run of text is trimmed at an end only where the whitespace there contains a newline. So markup written over
several lines loses its indentation, and a space within a line is kept, because it is part of the sentence:

```wac
// expect: answers sameLine = 3
// expect: answers twoLines = 2
import { Node } from "core";

i32 count(Node n) {
  return match (n) {
    Element(t, a, kids): kids.len(),
    default: 0,
  };
}

export i32 sameLine() {
  return count(<"div"><"b">a</"b"> <"b">b</"b"></"div">);     // the space is text
}

export i32 twoLines() {
  return count(<"div">
    <"b">a</"b">
    <"b">b</"b">
  </"div">);                                                    // the breaks are layout
}
```

`[§jsx-whitespace-breaks-are-layout]` A text run is trimmed at an end exactly where the whitespace there contains
a newline.

`[§jsx-empty-run-is-not-a-child]` A run the trimming empties is not a child.

### Fragments

`<>…</>` is an element with no tag. It evaluates to `Node.Fragment(kids)` — several nodes where one is wanted:

```wac
// expect: answers pairSize = 2
import { Node } from "core";

Node pair(Node a, Node b) { return <>{a}{b}</>; }

export i32 pairSize() {
  return match (pair(Node.Text("x"), Node.Text("y"))) {
    Fragment(kids): kids.len(),
    default: -1,
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
// expect: answers interpolated = "hello"
import { toString as text } from "core";

struct Label {
  string [text](const this) { return "hello"; }
}

export string interpolated() {
  Label label = Label();
  return "\{label}";                       // through the alias, still core's toString
}
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
// expect: answers spelled = "answer: 42 -7 false 0.5 -0"
// expect: answers childText = "42"
import { Node, html.div } from "core";

export string spelled() {
  i32 n = 42;
  i32 m = -7;
  bool flag = false;
  f64 half = 0.5;
  f64 negZero = -0.0;
  return "answer: \{n} \{m} \{flag} \{half} \{negZero}";
}

export string childText() {
  i32 n = 42;
  return match (<div>{n}</div>) {
    Element(tag, attrs, kids): match (kids[0]) {
      Text(t): t,
      default: "",
    },
    default: "",
  };
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

export Node greeting(string? name, i32[] xs) {
  // ERROR: string? has no toNode conversion
  // Node b = <div>{name}</div>;

  // ERROR: i32[] has no toString conversion
  // string c = "\{xs}";

  return <div>{name ?? "unknown"}</div>;
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
