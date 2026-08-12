# 0108 — JSX text is lexed as wac, so an apostrophe or a lone quote breaks the file

- **Status:** closed, 2026-08-12 by agent-b
- **Fixed in:** 79e933c6
- **Claimed by:** agent-b
- **Reported by:** agent-b
- **Date:** 2026-08-12
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
import { Attr, Node } from core;
export i32 run() {
  Node p = <p>it's here</p>;
  return 0;
}
```

    lex: character literal holds more than one character

## What works and what does not, measured

`design/lang/0004` reads text children as a **span of the source** between the tokens that surround
them, which is why they needed no lexer change. The tokens still have to exist, though, so the text
has to lex as wac:

| text | result |
| --- | --- |
| `He said "hi" to me` | **ok** — `"hi"` is a valid string token and the span takes it verbatim |
| `it's here` | `character literal holds more than one character` |
| `a " b` | `unterminated string` |
| `cost: #4` | `unexpected character` |

## Why suppression is not the fix

The obvious repair — ignore lex diagnostics inside a text span — works for `#` and cannot work for
the other two. An unterminated string **consumes the rest of the file**, so there is no `</p>` token
left for the parser to find: the token stream is wrong, not merely noisy. The same is true of a
character literal that swallows what follows it.

## The fix, as it landed

Three modes and a stack, not two: `normal`, `tag` (inside `<name …`, still wac, because an attribute
is a name, a string or `{expr}`) and `text`. A run of text ends at `{` or at a `<` that starts a tag,
and nothing inside it begins a string, a character literal or a comment. `spec/cases/0130`.

**What made it safe to change a component every other test depends on**: a `<` in normal mode starts
a tag exactly where it could not be the less-than operator — where the token before it cannot end an
expression. Every `<` in a program without JSX follows something that can (`a < b`, `f(x) < 2`,
`Vec<i32>`, `a! < 2`), so no such program lexes differently, and rung 1 says so over every `.wac`
file in the repository. `packages/wacc/test/jsxLex.test.ts` asserts that half against the reference
directly, because the reference is right about all of it.

**Two things came with it**, neither of them the point:

- A `<` followed by neither a name nor `/` is text, so `<p>1 < 2</p>` says what it looks like where
  JSX in JavaScript demands `{"<"}`.
- **Whitespace between two elements on one line is a child.** The first slice dropped it, and that
  was never decided: a run was the span between the tokens that happened to stand there, so a space
  between `</b>` and `<b>` belonged to neither and was never seen. Now the run exists, the trimming
  rule applies to it, and `<b>a</b> <b>b</b>` renders "a b" — React's answer. Across two lines the
  run is a line break, which is layout, and it trims to nothing and is not a child.
  `spec/cases/0124` records both.
