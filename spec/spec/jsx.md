## JSX

*Implemented in `wacc` only. The reference compiler does not have it — see
[compiler/README.md](../../compiler/README.md)'s omissions table, and
[design/lang/0004](../../design/lang/0004-jsx-builds-a-tree-defined-in-core.md) for why the tree is
where it is.*

An element is an expression, and what it evaluates to is `Node` — the tree `core` defines. So markup
is a value: it can be returned, stored, passed to a function, and walked.

```wac
import { Attr, Node } from core;

export Node greeting(string who) {
  return <p class="hello">hello {Node.Text(who)}</p>;
}
```

`[§jsx-element-is-an-expression]` A JSX element evaluates to `Node.Element(tag, attrs, kids)`, with
the tag as a string. Nothing is looked up: `<div>` is `"div"`, not a name that has to be in scope.
`spec/cases/0121`.

### The tree

`core` declares it, so every program and every repository builds the same one:

```wac
export struct Attr {
  string name;
  string value;
}

export enum Node {
  Element(string tag, Attr[] attrs, Node[] kids),
  Text(string text),
}
```

A program that writes JSX must import both — `import { Attr, Node } from core;` — and the emitter
says so by name when it has not:

    a JSX element without `import { Attr, Node } from core;`

### Attributes

`[§jsx-attribute-is-a-string]` An attribute's value is a `string`, written as a literal or as
`{expr}`. Anything else is the ordinary type error, naming the attribute — wac has no union, so a
number is written `{itoa(n)}` and the conversion is visible rather than implied. `spec/cases/0122`.

```wac
<input type="text" size={itoa(n)}/>
```

`[§jsx-attribute-written-once]` An attribute is written once. `<div class="a" class="b"/>` is
refused rather than resolved — the tree carries a list and cannot express precedence, and this
language refuses a switch with two defaults and a struct with two members of one name for the same
reason. HTML takes one of them silently; that is the behaviour not to inherit. `spec/cases/0128`.

### Children

`[§jsx-child-is-a-node]` A child written as `{expr}` must be a `Node`. Text is written as text; a
string variable becomes a child as `{Node.Text(s)}`, which says what it is rather than hiding a
conversion that would only sometimes apply. `spec/cases/0123`.

`[§jsx-text-is-a-child]` Text between tags is a `Node.Text` child. `spec/cases/0124`.

`[§jsx-closing-tag-names-its-element]` A closing tag names the element it closes: `<div></span>` is
well formed as *shape* — a name at each end — and wrong as a program, so it is refused with both
names in the message. `spec/cases/0126`.

### An element is an ordinary expression

`[§jsx-nests-in-expressions]` It nests where any expression does, and `>` inside `{…}` is whatever
it means in wac rather than the end of a tag:

```wac
Node cmp    = <div a={x > 1 ? "y" : "n"}/>;   // a comparison
Node inner  = <div>{<b/>}</div>;              // an element inside an expression inside an element
i32  count  = take(<p><i/><i/></p>);          // an argument
Node chosen = x > 1 ? <a/> : <b/>;            // a ternary's arms
```

`spec/cases/0127`.

### Whitespace

`[§jsx-whitespace-breaks-are-layout]` A run of text is trimmed at an end only where the whitespace
there contains a **newline**. So markup written over several lines loses its indentation, and a
space on one line is kept because it is part of the sentence:

```wac
<h1>hello {who}</h1>        // "hello " and then the child — the space is in the text
<p>
  hello
</p>                        // "hello" — the indentation is layout
```

`[§jsx-empty-run-is-not-a-child]` A run the rule empties is not a child. So `<b>a</b> <b>b</b>` has
three children and renders "a b", and the same two elements on separate lines have two, because
what is between them is a line break. `spec/cases/0124`.

### Text is not wac

`[§jsx-text-is-not-wac-source]` Between an element's tags the lexer reads text, so nothing there
starts a string, a character literal or a comment: `it's here`, `a " b` and `see http://x` are text.
A run ends at `{` or at a `<` that begins a tag — and a `<` followed by neither a name nor `/` is
text too, so `<p>1 < 2</p>` says what it looks like. `spec/cases/0130`.

## Components

`[§jsx-tag-naming-a-struct-is-a-component]` A tag that names a **struct in scope** is a component:
its attributes are that struct's fields, and its children are handed to `render`.
`spec/cases/0131`.

```wac
struct Card {
  string title;
  i32 count;

  Node render(const this, Node[] kids) {
    return <section class="card"><h2>{Node.Text(this.title)}</h2></section>;
  }
}

Node page() { return <div><Card title="hits" count={3}>a child</Card></div>; }
```

`<Card title="hits" count={3}>a child</Card>` means exactly

```wac
Card { title: "hits", count: 3 }.render(Node[](Node.Text("a child")))
```

so an attribute is checked against the **field's declared type** — `count={3}` is an `i32`, not text
that a component has to parse. `spec/cases/0134` is the mismatch.

`[§jsx-component-renders]` The struct must have `Node render(const this, Node[] kids)`. One without
it is not a component, and a tag naming it says so with the signature it needs. `spec/cases/0132`.

`[§jsx-component-sets-every-attribute]` The attributes are a named construction, so each field is
written exactly once — every field, and no name the struct does not have. An optional attribute is
something named construction does not have either. `spec/cases/0133`.

A component is a *type*, and wac writes types capitalised, so the JSX rule that a capital letter
means a component falls out of the naming convention rather than being a rule of its own. What
decides is whether the name is a struct in scope, which is the same question `Card { … }` asks.

### What is not here yet

- **Fragments.** `<>…</>` needs a `Node` that is not an element.
- **Optional attributes**, which wants a decision about named construction rather than about JSX.
- **Spread attributes, namespaces, boolean shorthand.**
