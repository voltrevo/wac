# 0108 — JSX text is lexed as wac, so an apostrophe or a lone quote breaks the file

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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

## The fix

The lexer learns the mode `design/lang/0004` step 2 described: inside an element's children, text
runs until `<` or `{`, and nothing in between starts a string, a character literal or a comment.
That means a small state stack — entered at `>` when a `<name` opened it, left at `</name>` — which
is a real change to a component every other test depends on, and is why the first slice deliberately
did not make it.

The compensation for waiting: what breaks is *reported*, with a lex error at the right position, and
not a program that compiles into something else.
