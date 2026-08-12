# 0006 — a JSX fragment is a `Node`, and adding it found a hole in the checker

- **Status:** implemented — `spec/cases/0135`, `spec/spec/jsx.md`
- **Date:** 2026-08-12
- **Author:** agent-b
- **Follows:** `design/lang/0005`, which built components and left fragments undecided

## What is being added

`<>a<b/></>` — an element with no tag, which is several nodes where one is wanted:

```wac
Node f = <><b>a</b><i>b</i></>;
```

`core`'s tree gains a variant:

```wac
export enum Node {
  Element(string tag, Attr[] attrs, Node[] kids),
  Text(string text),
  Fragment(Node[] kids),
}
```

**Why a component needs it.** `render` returns one `Node`. A component with two things to say — a
label and a value, a row's cells — had to invent a wrapper element that its caller then had to style
around. That is the same reason React has fragments, and it arrives here as soon as components do.

## Why a variant and not an element with an empty tag

`Node.Element("", attrs, kids)` needs no change to `core` at all, and every renderer written before
fragments existed keeps compiling. That is exactly what is wrong with it: those renderers would emit
`<>…</>` — a literal `<` and `>` with nothing between them — for a tree they had never been told
about, and the first person to see it would be a user rather than the author.

A variant makes the compiler say so. `match` is exhaustive, so every walk over a `Node` stops
compiling with the arm it is missing named. Seven cases and one program in this repository were
refused the moment the variant landed, each in one line, each a walk that would have been wrong.

## What the lexer needed

One character. A `<` opens a tag when what follows it is a name, a `/`, **or a `>`** — so `<>` opens
and `</>` closes, and `<p>1 < 2</p>` still reads `1 < 2` as text because a space follows the `<`.

## The hole this found

**wacc's checker had never read `core`.** An import from `core` declared each name as *unknown*, so
`Node` and `Read` had no enum behind them, and every rule that asks what an enum holds was silent for
the two types the compiler itself ships:

| what | over a local enum | over `core`'s `Node`, before |
| --- | --- | --- |
| a `match` missing a variant | refused | **accepted** |
| an arm naming a variant that does not exist | refused | **accepted** |
| two arms for one variant | refused | **accepted** |
| an `else` that nothing can reach | refused | **accepted** |

It was found by adding `Fragment` and watching every renderer in the repository keep compiling —
the thing an exhaustive `match` exists to prevent, not happening. The emitter had `coreSource()` the
whole time; the checker simply was not given it. `checkFiles` now appends `core` to the file list it
walks, so a `core` import resolves like any other import and there is still one answer to what core
declares.

**This is the second time a JSX slice has been paid for by a defect it uncovered elsewhere** — the
first was `issues/lang/0108`'s lexer modes. A feature that reaches into a part of the compiler nobody
has pushed on is worth something beyond itself.

## What this does not decide

- **Attributes on a fragment.** There is nowhere to write one, and `<> key={k}` would be a different
  syntax rather than an extension of this one.
- **A fragment as a component's tag.** `<Card/>` is a component and `<>` is a fragment; a component
  that wants to render siblings returns one.
- **Flattening.** A fragment is a node in the tree, not a splice performed at build time: a renderer
  sees it and decides. That keeps the tree the shape the program wrote.
