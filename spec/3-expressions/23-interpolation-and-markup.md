# 23 — Interpolation and markup

Two pieces of syntax turn values into something else. Interpolation turns a value into text, through core's
`toString` symbol. Markup calls functions and builds a tree whose type the program supplies, through core's
`markup` symbols. Neither is a general implicit conversion: each applies only at its own syntax.

## Interpolation

`\{` inside a double-quoted literal begins an embedded expression, ended by the matching `}`. The value is
converted once through core's `toString` symbol, and the result is concatenated with the text around it:

```wac
// expect: converted() = "hello"
// expect: interpolated() = "label: hello"
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
// expect: around() = "axyb"
// expect: alone() = "xy"
// expect: nested() = "xyxy"
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
// expect: named() = "hello"
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

A markup element is an expression, and **the language names no type for it to build**. A tag calls a
function in scope; what text, a `{child}`, a quoted tag and a fragment become is decided by a type the program
supplies, through static methods named by `core`'s `markup` symbols. The trees themselves — HTML, a view with
handlers, anything else — are libraries.

```wac
// expect: shown() = "box[hello, 42, b(x=1)[bold], frag[a, b]]"
import { markup } from "core";

enum Tree {
  Leaf(string text),
  Branch(string tag, string attrs, Tree[] kids),

  Tree [markup.text](string text) { return Tree.Leaf(text); }
  Tree [markup.element](string tag, string[] names, string[] values, Tree[] kids) {
    string a = "";
    for (i32 i = 0; i < names.len(); i++) { a = a + names[i] + "=" + values[i]; }
    return Tree.Branch(tag, a, kids);
  }
  Tree [markup.fragment](Tree[] kids) { return Tree.Branch("frag", "", kids); }

  string show(const this) {
    match (this) {
      Leaf(t): { return t; }
      Branch(tag, attrs, kids): {
        string s = attrs == "" ? tag + "[" : tag + "(" + attrs + ")[";
        for (i32 i = 0; i < kids.len(); i++) { s = s + (i == 0 ? "" : ", ") + kids[i].show(); }
        return s + "]";
      }
    }
  }
}

Tree box(Tree[] kids) { return Tree.Branch("box", "", kids); }

export string shown() {
  i32 n = 42;
  return (<box>hello{n}<"b" x="1">bold</"b"><>a{"b"}</></box>).show();
}
```

`[§wac-markup-tag-is-function-vv4pvhq]` `<t a={x} …>…</t>` calls the function `t` in scope, passing each attribute
to the parameter of that name and the children to its `kids` parameter. Its value is what `t` returns.

`[§wac-markup-child-type-r7k2mvp]` A tag's children are built as the element type of its function's `kids`
parameter — the *child type*. A quoted tag or a fragment builds the type its context expects, and its own
children are built as that type too. A quoted tag or a fragment whose context expects no type is refused.

`[§wac-markup-builds-with-its-type-q3xh8nd]` The child type builds text, quoted tags and fragments with its own
static methods named by `core`'s `markup.text`, `markup.element` and `markup.fragment`, found on the type: a file
that writes markup imports its tags and nothing else. A construct whose method the child type does not have is
refused, so a tree with no `[markup.element]` has no quoted tags.

The methods' shapes, for a child type `K`:

| Written | Becomes |
| --- | --- |
| text between tags | `K.[markup.text]("text")` |
| `<"x" a="1">…</"x">` | `K.[markup.element]("x", ["a"], ["1"], [...])` |
| `<>…</>` | `K.[markup.fragment]([...])` |

An enum may declare these: a static method is allowed on an enum when its name is a symbol, since
`Tree.[markup.text](…)` cannot be mistaken for a variant ([13](../2-types/13-enums.md)).

A tag that is yours is called the same way as one from an import. Markup is a tree of ordinary values, which a
program builds, returns, stores and walks.

### A quoted tag is an element by name

A tag written as a string is not looked up: it is built by the child type's `[markup.element]`, with that name.
A quoted name may be any name, which is how a custom element or a namespaced one is written:

```wac
// expect: icon() = "my-widget(data-size=8)"
// expect: one() = "label"
// expect: two() = "label"
// expect: three() = "caption"
import { markup } from "core";

enum Tree {
  Leaf(string text),
  Branch(string tag, string attrs, Tree[] kids),

  Tree [markup.text](string text) { return Tree.Leaf(text); }
  Tree [markup.element](string tag, string[] names, string[] values, Tree[] kids) {
    string a = "";
    for (i32 i = 0; i < names.len(); i++) { a = a + names[i] + "=" + values[i]; }
    return Tree.Branch(tag, a, kids);
  }

  string name(const this) {
    match (this) {
      Leaf(t): { return ""; }
      Branch(tag, attrs, kids): { return attrs == "" ? tag : tag + "(" + attrs + ")"; }
    }
  }
}

Tree caption(Tree[] kids) { return Tree.Branch("label", "", kids); }

export string icon()  { Tree t = <"my-widget" data-size="8" />; return t.name(); }
export string one()   { return (<caption>Name</caption>).name(); }        // calls caption
export string two()   { return (<@"caption">Name</@"caption">).name(); }  // calls caption: a verbatim name
export string three() { Tree t = <"caption">Name</"caption">; return t.name(); }   // the caption element
```

`[§wac-markup-quoted-tag-builds-vn2k8xr]` A tag written as a string literal is `K.[markup.element]` of that name, its
attributes' names and values as two arrays of `string`, and its children. Nothing is looked up.

`[§wac-markup-verbatim-tag-ca3myup]` A tag written as a verbatim name `@"…"` is a name in scope, like a bare tag.

### Attributes

An attribute name is written as in HTML, running to `=`, whitespace, `/` or `>`, so a hyphen needs no
escaping. A name a parameter could not otherwise have — a keyword, a hyphenated word — reaches a parameter
written as a verbatim name ([01](../1-programs/01-names-and-identity.md)):

```wac
// expect: labelFor() = "name"
// expect: widgetSize() = "8"
struct Labelled {
  string @"for";
  string size;
}

Labelled label(string @"for", string[] kids) { return Labelled(@"for", ""); }
Labelled widget(string @"data-size") { return Labelled("", @"data-size"); }

export string labelFor() { return (<label for="name" />).@"for"; }
export string widgetSize() { return (<widget data-size="8" />).size; }
```

`[§wac-markup-attr-verbatim-param-yd3farv]` An attribute whose name is a keyword or contains a hyphen fills the
parameter whose verbatim name is that text: `for=` fills `@"for"`, `data-size=` fills `@"data-size"`.

An attribute's value is written as a string literal or as `{expr}`, and is checked against the parameter's type;
a quoted tag's attributes are `string`s. An attribute is written once:

```wac
// expect: emits
i32 card(string @"class") { return 0; }

export i32 cards() {
  // ERROR: an attribute is written once
  // i32 bad = <card class="a" class="b" />;

  return <card class="card" />;
}
```

`[§jsx-attribute-written-once]` Writing an attribute twice on one element is refused — the tree cannot express
precedence, and taking one silently is the behaviour not to inherit.

### Children

```wac
// expect: kinds() = "text:hi, text:7, text:a label, node, list"
import { markup, toString } from "core";

struct Label {
  string text;
  string [toString](const this) { return this.text; }
}

enum Tree {
  Leaf(string text),
  Many(Tree[] kids),
  Mark,

  Tree [markup.text](string text) { return Tree.Leaf(text); }
  Tree [markup.fragment](Tree[] kids) { return Tree.Many(kids); }

  string kind(const this) {
    match (this) {
      Leaf(t): { return "text:" + t; }
      Many(kids): { return "list"; }
      Mark: { return "node"; }
    }
  }
}

string list(Tree[] kids) {
  string s = "";
  for (i32 i = 0; i < kids.len(); i++) { s = s + (i == 0 ? "" : ", ") + kids[i].kind(); }
  return s;
}

export string kinds() {
  i32 n = 7;
  Tree[] some = [Tree.Mark, Tree.Mark];
  return <list>hi{n}{Label("a label")}{Tree.Mark}{some}</list>;
}
```

`[§wac-markup-text-child-m5c9qtw]` Text between tags is a child: `K.[markup.text]` of the text.

`[§wac-markup-child-converts-w8d4ntc]` A `{e}` child is `e` when it is a `K`, `K.[markup.fragment](e)` when it is a
`K[]`, and `K.[markup.text]` of its text when it converts to text — a `string`, a number, a `bool`, or a value
whose type implements `core`'s `toString` ([Interpolation](#interpolation)). Anything else is refused.

### Markup is an ordinary expression

An element nests wherever an expression does, and inside `{…}` the text is wac again, so `>` is whatever it
means there:

```wac
// expect: asArgument() = 2
import { markup } from "core";

enum Tree {
  Leaf(string text),
  Branch(string tag, Tree[] kids),

  Tree [markup.text](string text) { return Tree.Leaf(text); }
  Tree [markup.element](string tag, string[] names, string[] values, Tree[] kids) {
    return Tree.Branch(tag, kids);
  }

  i32 kidCount(const this) {
    match (this) {
      Leaf(t): { return -1; }
      Branch(tag, kids): { return kids.len(); }
    }
  }
}

export Tree comparison(i32 x) { return <"div" a={x > 1 ? "y" : "n"} />; }   // a comparison
export Tree inner() { return <"div">{<"b" />}</"div">; }         // an element in an expression in an element
export Tree chosen(i32 x) { return x > 1 ? <"a" /> : <"b" />; }  // a ternary's branches
export i32 asArgument() { Tree t = <"p"><"i" /><"i" /></"p">; return t.kidCount(); }
```

`[§jsx-nests-in-expressions]` An element may stand anywhere an expression may, and `>` inside `{…}` is an
operator, not the end of a tag.

A closing tag names the element it closes:

```wac
// expect: emits
i32 div(i32[] kids) { return 0; }

export i32 closed() {
  // ERROR: </span> does not close <div>
  // i32 bad = <div></span>;

  return <div></div>;
}
```

`[§jsx-closing-tag-names-its-element]` A closing tag that does not name the element it closes is refused, and the
diagnostic names both.

### Text is not wac

Between an element's tags the lexer reads text, so nothing there starts a string, a character literal, a comment
or an operator. A run ends at `{`, or at a `<` that begins a tag:

```wac
// expect: quotes() = "it's here, a \" b, see http://x"
// expect: lessThan() = "1 < 2 and 3 > 2"
import { markup } from "core";

struct Text {
  string s;
  Text [markup.text](string s) { return Text(s); }
}

string p(Text[] kids) { return kids[0].s; }

export string quotes() { return <p>it's here, a " b, see http://x</p>; }
export string lessThan() { return <p>1 < 2 and 3 > 2</p>; }   // a < that begins no tag is text
```

`[§jsx-text-is-not-wac-source]` Text between tags is not read as wac: quotes, `//` and operators there are text.
A `<` that does not begin a tag is text — one begins only where a name, a quoted or verbatim name, `/`
or `>` follows it.

### Whitespace

A run of text is trimmed at an end only where the whitespace there contains a newline. So markup written over
several lines loses its indentation, and a space within a line is kept, because it is part of the sentence:

```wac
// expect: sameLine() = 3
// expect: twoLines() = 2
import { markup } from "core";

struct Text {
  string s;
  Text [markup.text](string s) { return Text(s); }
}

i32 count(Text[] kids) { return kids.len(); }
Text b(Text[] kids) { return kids[0]; }

export i32 sameLine() {
  return <count><b>a</b> <b>b</b></count>;     // the space is text
}

export i32 twoLines() {
  return <count>
    <b>a</b>
    <b>b</b>
  </count>;                                      // the breaks are layout
}
```

`[§jsx-whitespace-breaks-are-layout]` A text run is trimmed at an end exactly where the whitespace there contains
a newline.

`[§jsx-empty-run-is-not-a-child]` A run the trimming empties is not a child.

### Fragments

`<>…</>` is an element with no tag — several children where one is wanted:

```wac
// expect: pairSize() = 2
import { markup } from "core";

struct Many {
  string[] texts;
  Many [markup.text](string s) { return Many([s]); }
  Many [markup.fragment](Many[] kids) {
    string[] all = string[].defaulted(kids.len());
    for (i32 i = 0; i < kids.len(); i++) { all[i] = kids[i].texts[0]; }
    return Many(all);
  }
}

Many pair(string a, string b) { return <>{a}{b}</>; }

export i32 pairSize() { return pair("x", "y").texts.len(); }
```

`[§wac-markup-fragment-built-p8j3zrk]` `<>…</>` is `K.[markup.fragment]` of its children. It takes no attributes, and closes
with `</>`.

### A component tag

A tag whose function takes a **first parameter whose type `P` has a static `[markup.component]` method** is a
component: the tag does not call the function. It is that method, given the function's name, the `key`
attribute, a closure drawing the component with the tag's other attributes, their snapshots, and a test of
another instance's snapshots against these. What the library does with them — keep an instance, match it by
`key` next render, skip it when nothing changed — is the library's, and the language knows no `P` by name.

```wac
// expect: f() = Row x1 true false
import { markup } from "core";

struct Ui {
  i32 n;
  Shown [markup.component](string name, string? key, fn<Shown(Ui)> draw, anyref snaps, fn<bool(anyref)> same) {
    return Shown(name + " " + draw(Ui(1)).text, snaps, same);
  }
}

struct Shown { string text; anyref snaps; fn<bool(anyref)> same; }

Shown Row(Ui ui, string label) { return Shown(label + "\{ui.n}", ui, (anyref o) => false); }

export string f() {
  Shown a = <Row label="x"/>;
  Shown b = <Row label="x"/>;
  Shown c = <Row label="y"/>;
  return "\{a.text} \{a.same(b.snaps)} \{a.same(c.snaps)}";
}
```

`[§wac-markup-component-tag-e96qed2]` `<F a={x} …/>`, where `F`'s first parameter has type `P` and `P` declares a static
`[markup.component]`, is `P.[markup.component](name, key, draw, snaps, same)`: `name` is `"F"`, `key` the `key`
attribute's value or `null`, and `draw` a `fn<K(P)>` calling `F` with its argument and the other attributes. The
first parameter is not an attribute, and `F` must answer the method's `K`.

`[§wac-markup-snapshot-6fb88vq]` An attribute's snapshot is its value's `[markup.snapshot]()` when its type declares
one, and otherwise the value itself. A function-typed attribute has none: a closure is new every render, so
recording one would render every component with a handler every time.

`[§wac-markup-snapshot-same-fgyw5xf]` `same(other)` is true when `other` holds the snapshots of the same attributes
and each agrees with this instance's: numbers, `bool` and `string` by value, a tuple member by member, and
any other reference by identity.

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
// expect: interpolated() = "hello"
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

`toString` is exported directly from `core`, not `core.operators`. Intrinsic types receive its implementation from
the compiler and core; no external implementation mechanism is introduced.

| Type | `toString` |
| --- | --- |
| `string` | The string itself |
| `bool` | `"true"` or `"false"` |
| Every integer primitive | Decimal digits, a minus sign if negative, no grouping |
| Every floating-point primitive | Shortest decimal that round-trips to the same float type |

Float special spellings are `"NaN"`, `"Infinity"`, `"-Infinity"`, and `"-0"`.

```wac
// expect: spelled() = "answer: 42 -7 false 0.5 -0"
export string spelled() {
  i32 n = 42;
  i32 m = -7;
  bool flag = false;
  f64 half = 0.5;
  f64 negZero = -0.0;
  return "answer: \{n} \{m} \{flag} \{half} \{negZero}";
}
```

`[§wac-tostring-builtin-only-k9w4hcz]` `bool`, every integer and every float type implement `toString` as the table says:
decimal for integers, the shortest round-tripping decimal for floats, and `true` or `false`. A markup child of one of
these types is text through the same conversion ([Children](#children)).

No automatic conversions are supplied for nullable values, arrays, tuples, user-defined structs, or enums. An author
can implement the symbol on a type; callers handle absence or convert collections explicitly.

```wac
// expect: emits
export string greeting(string? name, i32[] xs) {
  // ERROR: i32[] has no toString conversion
  // string c = "\{xs}";

  return "hello \{name ?? "unknown"}";
}
```

`[§wac-conversion-none-compound-r6tn2hx]` Nullable values, arrays, tuples, structs and enums have no built-in
`toString`; interpolating one whose type does not implement the symbol is refused.

## Open

- **Float formatting.** Exact scientific-notation thresholds and the remaining formatting details belong to the
  formatting specification.
- **Attributes a tag function does not declare.** Whether a tag function's parameters may have defaults, so an
  attribute can be omitted, and whether spread, namespaced and boolean-shorthand attributes exist, is not
  decided.
- **HTML serialisation and rendering.** These are library APIs, outside the language, and so are the trees.
