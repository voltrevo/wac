# 0005 — a JSX component is a struct with a `render` method

- **Status:** implemented — `spec/cases/0131`–`0134`, `spec/spec/jsx.md`
- **Date:** 2026-08-12
- **Author:** agent-b
- **Follows:** `design/lang/0004`, which built the tree and left components undecided

## The question 0004 left

`<Thing/>` is an element whose tag is the string `"Thing"`. A component system needs two answers that
note deliberately did not give: **what a component is**, and **how attributes reach it**.

## The answer

A tag that names a **struct in scope** is a component. Its attributes are that struct's fields, and
its children are handed to a `render` method:

```wac
import { Attr, Node } from core;

struct Card {
  string title;
  i32 count;

  Node render(const this, Node[] kids) {
    return <section class="card">
      <h2>{Node.Text(this.title)}</h2>
      <p>{Node.Text(itoa(this.count))}</p>
    </section>;
  }
}

Node page() {
  return <div><Card title="hits" count={3}>and a child</Card></div>;
}
```

`<Card title="hits" count={3}>and a child</Card>` means exactly

```wac
Card { title: "hits", count: 3 }.render(Node[](Node.Text("and a child")))
```

which is wac that compiles today — checked before this note was written, because a desugaring the
language cannot express is a design that reads well and cannot land.

## Why a struct rather than a function

The obvious alternative is a function of the shape an element already carries:

```wac
Node Card(Attr[] attrs, Node[] kids)
```

It needs no new checking at all, and it is what a dynamically typed JSX does. It is wrong here for
one reason: **`Attr` is `string` to `string`**, so every attribute of every component arrives as text
and `count={3}` becomes `count={itoa(3)}` at the call and `atoi` inside. A typed language that
routes all of its component inputs through strings has given up the thing it is for.

The struct form gets types from machinery that already exists and is already specified:

- **Named construction is typed and order-independent** — `Point { y: 4, x: 3 }`, `§wac-struct-named-4y8pg2j`.
  An attribute is checked against the field's declared type, so `count={3}` is an `i32` and
  `count="3"` is the ordinary type error.
- **Its diagnostics are already the ones a component wants.** `errNamedField` is *"a named
  construction naming a field the struct does not have, or leaving one out"* — a misspelled attribute
  and a missing one, said in the language's own words rather than in JSX's.
- **The capital letter falls out instead of being a rule.** JSX in JavaScript needs `<Thing/>` versus
  `<thing/>` because a component is a variable and a tag is a string, and nothing else tells them
  apart. Here a component is a *type*, and wac already writes types capitalised — so the rule is
  "does this name a struct in scope", which is a question the checker can answer, rather than a
  convention the reader has to keep.

## What it costs, said plainly

- **Every attribute is required**, because named construction requires every field. A component with
  an optional prop cannot express it today; a nullable field still has to be written as `x={null}`.
  That is a limit of named construction rather than of JSX, and fixing it there fixes it here. It is
  the reason this note is a first slice.
- **A component is a declaration, not an expression.** No inline components, no closures — wac has no
  closures, so that was never available.
- **`render` is a name the language now reserves in one place.** A struct used as a component must
  have `Node render(const this, Node[] kids)`; a struct without one is not a component, and using it
  as a tag says so.

## What is checked

1. The tag names a struct **in scope** — the same resolution `Card { … }` uses, so the two spellings
   cannot disagree about which `Card` is meant.
2. That struct has `Node render(const this, Node[] kids)`. A struct with no `render`, or one of the
   wrong shape, is refused by name: *"`Card` is not a component: it has no `Node render(const this,
   Node[] kids)`"*.
3. The attributes are its fields, by the rules of named construction — every field written once,
   every field written, each against its declared type.
4. The children are `Node`, exactly as for an element.

## What this does not decide

- **Fragments.** `<>…</>` still needs a `Node` that is not an element, or a `Node[]` expression type.
- **Optional attributes**, which wants a decision about named construction rather than about JSX.
- **Children as anything but `Node[]`.** A component that wants one child takes an array and looks.
- **Spread attributes and namespaces**, both additions to a working component.
