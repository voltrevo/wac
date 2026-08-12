# 0004 — JSX builds a tree, and the tree is defined in `core`

- **Status:** implemented for the first slice — elements, attributes, element children and text
- **Date:** 2026-08-12
- **Author:** agent-b, on the operator's decision that "jsx should create a tree which is defined in
  core"

## What is being added

`<div class="x">hello</div>` is an expression. It evaluates to a value of a type the compiler ships,
so any two pieces of wac — in any two repositories — build the same tree and can hand it to each
other.

This is the first feature that lands in **wacc only**. `design/lang/0003` made the reference a seed
with stated omissions, and this is the first entry in that table.

## Why the tree belongs in `core`, against a test written to keep things out

`core`'s admission test is deliberately narrow, and `compiler/wacCore.ts` states it: *does a value of
this type have to cross a repository boundary through a funcref signature? If not, it is a library
and belongs in a package.* Today only `Read` passes.

A JSX tree passes it **more strongly than `Read` does**, and for a reason that is about the compiler
rather than about taste. wac has nominal types and no closures, so two identical declarations of a
type are two types and no adapter converts between them. With `Read` the author of a streaming
transform *chooses* to name a shared type. With JSX the author chooses nothing: the compiler
generates the constructor calls, so if the tree type came from a package, then

- a component library that emits JSX would bake its own copy of that package's type into every value
  it produced, and
- a renderer in another repository, built against a different copy, could not accept them —
- with nothing either author could write to bridge it, and no diagnostic pointing at the cause,
  because both sides spelled `<div>` and meant it.

A syntax that expands to a type must expand to *one* type everywhere, which is exactly the property
`core` exists to provide. That the compiler emits the reference is what makes this structural rather
than a preference.

## The type

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

Two declarations, no methods, no functions — the same shape `core` already has.

**An enum rather than a struct with an empty tag.** A text node has no attributes and no children,
and a struct would carry three fields that must be empty and one that must not, which is a rule no
type checks. `match` over two variants is what a renderer wants to write anyway.

**Attributes are `string` to `string`.** JSX in other languages carries values of any type because
those languages are dynamic; wac is not, and a heterogeneous attribute would need a union the
language does not have. A caller that wants a number writes `{itoa(n)}`, which is the conversion it
would have written anyway — made visible rather than implied.

**Children are `Node[]`, and text is a `Node`.** So `<p>hello {name}</p>` is three children:
`Text("hello ")`, whatever `{name}` is, and nothing else. See the desugaring for what `{name}` must
be.

## The desugaring

```wac
<div class="a" id={x}>
  hello
  <br/>
  {kid}
</div>
```

becomes exactly

```wac
Node.Element(
  "div",
  Attr[](Attr("class", "a"), Attr("id", x)),
  Node[](Node.Text("hello"), Node.Element("br", Attr[](), Node[]()), kid),
)
```

- **A tag is a string literal**, not a name: `<div>` is `"div"`, and nothing is looked up. A
  component system needs a decision this note does not make.
- **`{expr}` in attribute position must be `string`.** The checker says so with the ordinary
  type error, naming the attribute.
- **`{expr}` in child position must be `Node`.** Text is written as text; a string variable is
  inserted with `{Node.Text(s)}`, which is honest about the wrapping rather than hiding a conversion
  that only sometimes applies.
- **Whitespace between elements is dropped; whitespace inside a text run is kept and collapsed at
  the ends.** `<p> hello </p>` is `Text("hello")`. This is the one rule here that is a choice rather
  than a consequence, and it is the one every JSX implementation has had to make.

## What this note does not decide

- **Components.** `<Thing />` with a capital letter meaning "call `Thing`" needs a signature
  convention and an answer for children-as-arguments. Out of scope until the tree exists.
- **Fragments.** `<>…</>` needs a `Node` that is not an element, or a `Node[]` expression type.
- **Namespaces, spread attributes, boolean shorthand.** All of them are additions to a working tree.

## How it lands

1. `core` gains the two declarations, in wacc only, with `compiler/README.md` recording the omission.
2. The lexer learns JSX's two modes. **Not needed, and that is the useful finding.** The parser
   already has the source and every token's offset, so a text run is the *span between* where the
   run starts and whatever ends it — `<`, `{`, or the end of the file. `hello world` is two tokens
   with a space no token holds, and the span has all three. The limit this leaves is that the text
   still has to *lex*: a `"` inside it is an unterminated string, and that is what a second slice
   would fix by teaching the lexer the mode.
3. The parser reads elements, attributes and children into one `Jsx` node — plus `JsxText` for a
   run of text — and the emitter lowers both. **Done**: `spec/cases/0121`–`0124`.
4. Spec cases, and `spec/spec/` gains a page. The spec targets wacc (`design/lang/0003`), so the
   text and the implementation land together.

Each step is testable on its own: (1) is a program that imports `Node` and builds one by hand, and
is done — `spec/cases/0120`.

## What step 3 runs into, found before writing it

The desugaring above is written as wac source, which reads as though the parser can simply build the
tree it describes. It cannot, and the reason is worth knowing before starting:

**Every name in the AST is a token, and the desugaring needs names the source never wrote.**
`Node.Element(…)` needs `Node`; `Attr[]()` needs a `Ty` of `Named(tok)` where the token's text is
`Attr`; and a tag needs the *string* `"div"` built from an identifier token, which `StrLit` cannot
do because it strips a quoted span — slicing the ends off `div` gives `i`. Synthesising tokens means
inserting into the lexer's array, and that array is what every line and column in every diagnostic
is measured against, so an insertion moves them all.

Two ways out, and the second looks right:

1. **New expression kinds that carry text rather than tokens** — a `RawStr(tok)` meaning "this
   token's own text as a string" plus something for the constructors. Tried: `RawStr` costs four
   sites, all found by exhaustiveness, and wacc compiles with it. But the array types still need
   tokens, so it solves a third of the problem.
2. **One `Jsx` expression node, lowered by the emitter.** The parser records the tag token, the
   attributes and the children, and `emit.wac` writes the tree — where types are *strings*
   (`env.arrayType("i8[]")`) and no token is needed for any of them. The checker types the node as
   `Node` and checks each attribute value is `string` and each child is `Node`.

The second keeps the token problem out of the AST entirely, which is why the desugaring above should
be read as *what the program means* rather than as a source-to-source rewrite.
