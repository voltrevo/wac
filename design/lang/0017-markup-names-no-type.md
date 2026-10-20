# 0017 — markup names no type

- **Status:** in progress — steps 1–3 landed
- **Raised by:** agent-a, 2026-10-20, on the operator's direction: "What goes in a library doesn't need to be in
  the spec and ideally we reduce assumptions in the spec so a better library is possible without changing the
  language in future."
- **Supersedes, when it lands:** `design/lang/0004` (the tree in `core`) and `0006` (a fragment is a `Node`)
- **Needed by:** `design/system/0012`, whose view has a tree of its own — handlers on elements, a node for a
  component — and should not need a language change to have it

## The target

Markup is syntax that lowers to calls, and **the spec names no tree type**. What a tag, a text run, a
`{child}`, a quoted tag or a fragment becomes is decided by the library the tag came from, through symbols
`core` designates, as `"\{x}"` is decided by `toString`. So:

- **`core` holds symbols and no markup types.** `core/jsx.wac` (`Node`, `Attr`) and `core/html.wac` (the tag
  functions) leave it, and so does `toNode`.
- **The trees are libraries.** `packages/web` carries a static tree — `Node`, `Attr`, the tags as the
  namespace `html`, `htmlOf` — and the view (0012) a tree with handlers and components; a module gets
  whichever its tags were imported from. An SVG library or a terminal one is a third, with no change here.
  (The static tree is a module of `web` rather than a package of its own because `web` is a project, and a
  project imports only what is inside it.)
- **The spec's markup chapter is the lowering**, with its examples written against a small tree declared in
  the example itself.

What it is **not**: a markup runtime in the language, a fixed attribute set, or a rule about rendering. The
one rule that touches rendering — comparing attributes, for a component — is stated as a lowering with a
symbol the library implements.

## What assumes `core`'s tree today

Read 2026-10-20, at 0958925d8. A tag already calls the function in scope (ch23
`§wac-markup-tag-is-function-vv4pvhq`), so `<div>` assumes nothing. Four things still do:

| construct | today | spec |
|---|---|---|
| a text run | `Node.Text` | `§jsx-text-is-a-child` |
| a `{e}` child | `e.[toNode]()`, which answers `Node`; built in for `string`, `bool` and numbers | `§wac-markup-child-tonode-vp842rw`, `§wac-tostring-builtin-4t3buvz` |
| a quoted tag `<"x" …>` | `Node.Element("x", …)` | `§wac-markup-quoted-tag-3dnrvxj` |
| a fragment `<>…</>` | `Node.Fragment` | `§jsx-fragment-is-a-node` |

And ch43 puts the HTML tag functions, with one attribute list of 39 names, in `core`.

## The lowering

The **child type** of a tag is the element type of its function's `kids` parameter; outside any tag — markup
returned or assigned — it is the element type the context expects. Call it `K`. The tree declares how to
build its own pieces with static methods named by `core`'s symbols, so the compiler looks them up on `K`
and nothing is imported for them:

| written | becomes |
|---|---|
| `<t a={x}>…</t>` | `t(a: x, kids: [...])` — unchanged |
| text `hello` | `K.[markup.text]("hello")` |
| `{e}`, `e` a `K` | `e` |
| `{e}`, `e` a `K[]` | `K.[markup.fragment](e)` — so `{rows}` needs nothing |
| `{e}`, `e` implementing `toString` | `K.[markup.text]("\{e}")` — numbers, `bool`, `string` and anything with a `toString` |
| `<"x" a="1">…</"x">` | `K.[markup.element]("x", ["a"], ["1"], [...])` — any name, string attributes |
| `<>…</>` | `K.[markup.fragment]([...])` |

A `K` without the method a construct needs refuses that construct, naming the symbol: a tree with no
`markup.element` has no quoted tags, which is a tree's choice to make. A tree is usually an enum, and an
enum's static method was refused outright, since `Shape.make()` is how a variant is built; a static named
by a symbol cannot be mistaken for one, so it is allowed now (spec ch13). The methods are found on the type,
so a file writing markup imports its tags and nothing else.

### A component tag

A function whose first parameter's type `P` has a static `[markup.component]` method is **not called** by its
tag. The tag lowers to

```wac
<Row key={k} todo={t} ontoggle={f}/>
// becomes
Ui.[markup.component]("Row", k, (t.[markup.snapshot]()), sameSnapshots, (Ui u) => Row(u, t, f))
```

— the function's name, the `key` attribute, a tuple of the other attributes' snapshots, a function comparing
two such tuples, and a `draw` closure. What it answers is a `K`; what the library does with it — keep an
instance, match it next render, skip it when the snapshots agree — is the library's. The view's `Ui`
is one such `P`, and the language does not know its name.

### `markup.snapshot`: what a render remembers of a value

Comparing an attribute with last render's cannot be `==`, and it is not named like a comparison, for two
reasons. Most types have no `==`, and the rule wanted is not equality — a reference is unchanged when it is
the same object. And a value can be unchanged by every comparison and still have changed: a `State` cell
handed to a child is the same object after every `set`, so comparing the old attribute with the new one
compares the cell with itself (0012, "a `State` passed as an attribute"). What has to be kept is not the
value but what the value *was*.

So a type may declare `S [markup.snapshot](const this)`, answering what a render records; two snapshots are
compared by the built-in rule. Without one, a value is its own snapshot:

- numbers, `bool` and `string` by value;
- every other reference by identity;
- a tuple member by member;
- **a function value is not recorded at all.** A closure is new every render, so recording it would make every
  component with a handler render every time; the library renders a skipped component again before it
  dispatches an event through it (0012's stale rule), which is what keeps an old handler from running.

`State<T>` answers `(this, this.version)`: the same cell, set since, is a changed attribute.

## Why the tree no longer has to be in `core`

0004 put `Node` in `core` because the compiler emitted its constructor calls: a component library and a
renderer built against two copies of a package's tree could not exchange values, and nothing either author
wrote could bridge them. That is true only while generated code names the type. Under this lowering nothing
generated names a type — it calls a function the module imported, or a method on the type that function
takes — so a tree is shared the way any type is, by importing one package. (0004's other premise, that wac
has no closures, no longer holds either.)

The price is that two trees do not interoperate: a static `Node` is not a view node. That is
the point — they hold different things — and a function from one to the other is ordinary code.

## What it breaks

- Every module importing `Node`, `Attr` or `html.*` from `"core"`: fifteen example pages, the template,
  and `packages/web`'s own tests. They import from `web` now.
- ch23's markup examples and cases, ch43 entire, and `toNode`'s row in ch23's conversion table.
- wacc's markup lowering: text runs, `{e}` children, quoted tags and fragments.

## Open

- **The child type outside a tag.** `return <>…</>;` has the function's return type to go on; `auto x = <p/>`
  has the tag's return type; a bare quoted tag in an `auto` has nothing, and is refused. Whether that is
  enough is to be seen in the cases.
- **`key`.** It is the one attribute name the lowering knows, and only for a component tag. The alternative is
  a parameter the component declares, which every component would have to.
- **A library's `memo` and `effect`** want the same rule for their dependencies. It is reachable only if `core`
  also exports it as a generic function — `markup.unchanged<T>(T a, T b)`, say — since `==` on a type
  parameter reaches neither arrays nor references today.
- **The attribute tuple** may have one member or none: a one-member tuple and no tuple at all need a spelling.

## The order of work

1. **The lowering and the symbols**: `markup.text`, `markup.element`, `markup.fragment` and the `{e}` rules, in
   wacc and in ch23, its examples declaring their own small tree. Failing cases first: each construct
   against a tree that is not `core`'s.
2. **The static tree in `packages/web`**: `Node`, `Attr`, the tag functions and `htmlOf`, implementing the
   symbols. Port the importers.
3. **Delete** `core/jsx.wac`, `core/html.wac`, `toNode`, ch43, and their rows in `tools/wac/gencore.wac`.
4. **`markup.component` and `markup.snapshot`**, with the cases from 0012's prototype: a skipped row, a stale
   handler, a cell attribute by version. This is the step 0012's view waits on.

## State of play

| step | state |
|---|---|
| 1 | done — spec ch23 rewritten, cases 0571–0579; on the way: an enum may declare a static named by a symbol (ch13), `Shape.make()` naming nothing is refused by the checker, an enum implements `toString`, a file interpolating another file's type need not import `toString`, and namespace lowering notices any `[a.b]` member name |
| 2 | done — `packages/web`'s `html.wac` and `tags.wac`, re-exported from its entry |
| 3 | done |
| 4 | not started |
