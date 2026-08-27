# 0277a — wapy accepts escapes wac refuses, and swallows the rest without a word

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-27
- **Kind:** bug
- **Symptom:** wrong answer, silently

## What

`spec/spec/wapy.md` `[§wac-wapy-h3nq7fv]`: *"wapy is wac with a different layout. Same types, same
semantics, same AST, same compiler."* String escapes are not. `compiler/wapyLex.ts`'s `unescape` is a
second, undocumented grammar:

```ts
s.replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, (_, hex, c) =>
  hex !== undefined ? String.fromCharCode(parseInt(hex, 16))
                    : c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c === "0" ? "\0" : c);
```

It differs from wac's in two ways, and the second is the one that costs something.

**1. It has `\uXXXX`, which wac does not.** wac's string escapes are exactly `\n`, `\t`, `\r`, `\\`,
`\"` and `\0`. (`\u{…}` is *character-literal* syntax — a different lexer path, emitted as an int
token holding the codepoint — and is not available in a string.)

**2. Its final branch returns the escaped character**, so every escape wac does not know is accepted
here, silently, with the backslash dropped. wac reports `unknown escape` and points at the string.

Measured against both compilers on 2026-08-27:

| in a string literal | wapy's value | wac |
| --- | --- | --- |
| `"\q"` | `q`, no diagnostic | `error: unknown escape` |
| `"\u{41}"` | `u{41}`, no diagnostic | `error: unknown escape` |
| `"A"` | `A`, no diagnostic | `error: unknown escape` |
| `"\n"` | newline | newline |

`\u{41}` is the row to look at twice. A reader who knows wac's *character* escapes will write it in a
string, and wapy answers with the four-character string `u{41}` rather than either the letter `A` or a
complaint. Nothing downstream can tell.

> **An earlier revision of this page had a wac column reading `A` for that row**, on the assumption
> that `\u{…}` worked in wac strings as it does in wac character literals. It does not — checked by
> compiling it, which is what turned a two-row disagreement into the simpler and worse statement
> above: wapy has no unknown-escape diagnostic at all.

## And the printer emits a form wac cannot read

`compiler/wapyPrint.ts:304` renders a string with `JSON.stringify`, which writes a NUL as `\u0000`.
That is valid wapy under branch 1 and is not valid wac, so the wapy rendering of a wac file is a file
whose strings a wac-compatible reader refuses.

Found exactly that way. `packages/wacc/src/wapyparse.wac` — wacc's wapy frontend, which runs `lex`
over the wapy source so that numbers, strings and escapes cannot drift between the surfaces — reads
the reference's own rendering of `packages/ssh`'s `openssh-key-v1` sentinel and reports an unknown
escape. Five of 400 rendered files fail, all for this, and every one contains a `\uXXXX`.

## Why nothing caught it

`compiler/wapyRoundTrip.test.ts` compares the tree from `wac → wapy → parse` against the tree from
parsing the wac. Both sides go through the *same pair of functions* — `JSON.stringify` writes
`\u0000` and `unescape` reads it back to a NUL — so the round trip is exact and says nothing about
whether either agrees with wac.

That is the shape `compiler/wapyParse.ts`'s own header warns about, one level down: *"a round-trip
test cannot notice, because it only ever feeds the reader output from the printer — which is valid by
construction."* It was written about the reader; it is just as true of the escapes, and that was not
noticed at the time.

## What to do

Both halves move together, because changing either alone moves the round trip.

1. `unescape` reads wac's escapes, **including the failure**: an unknown escape is a diagnostic, not a
   character. The implementations to share are `packages/wacc/src/lit.wac` and `compiler/wacLex.ts`; a
   third would be the thing this issue is about.
2. The printer emits wac's spelling rather than `JSON.stringify`'s — the *string body* only. The
   import path on `wapyPrint.ts:616` also goes through `JSON.stringify` and can stay: a path has no
   escapes in it.

One decision inside it, stated rather than settled: whether `\uXXXX` should survive as a wapy-only
convenience. **Recommendation: no**, and further, that wac should be the one to grow a string escape
for a codepoint if anybody wants one — the argument for wapy is that it is the same language with a
different layout, and an escape is not layout. `[§wac-wapy-words-p2vm9kx]` already establishes that
wapy respells whole words and nothing smaller.

## Not a blocker for the wacc frontend

`packages/wacc/src/wapyparse.wac` is right by construction: it runs `lex`, so a `.wapy` file gets
wac's escapes and wac's diagnostics exactly. The five failures above are the *reference's rendering*
being unreadable, not wacc misreading it. This issue is about the compiler that is on its way out, and
the fix is worth making mainly because the printer is what anybody converting a file will reach for.
