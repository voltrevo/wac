# 0284b — a `.wapy` file's lexer diagnostics are rendered with the parser's table

- **Status:** closed
- **Fixed in:** `packages/wacc/src/wapyparse.wac` — `WParsed` carries `lexErrorCount`; and
  `packages/wacc/src/frontend.wac` — the wapy branch splits the list the way the wac branch always
  did. Guarded by `packages/wacc/test/wac/wapy_test.wac`.
- **Claimed by:** agent-b (2026-08-28)
- **Reported by:** agent-b
- **Date:** 2026-08-28
- **Kind:** diagnostic
- **Symptom:** wrong answer — a real diagnostic replaced by a generic one
- **Covered by:** `§wac-wapy-h3nq7fv`

## Reproduction

The same program on both surfaces.

```wac
export i32 f() { string s = "\q"; return s.len(); }
```

```python
@export
def f() -> i32:
    s: string = "\q"
    return 1
```

    wac   error: unknown escape
    wapy  error: the parser refused this

Expected: the same diagnostic. `spec/spec/wapy.md` `[§wac-wapy-h3nq7fv]` — *"wapy is wac with a
different layout. Same types, same semantics, same AST, same compiler."*

## It is every lexer diagnostic, not this one

`"abc` with no closing quote answers `the parser refused this` too, where wac says
`unterminated string literal`. There are seven lexer codes and all of them arrive this way on the
wapy surface: unexpected character, unterminated string, unknown escape, unterminated block comment,
unterminated character literal, empty character literal, and a character literal holding more than
one character.

## Where

`packages/wacc/src/frontend.wac`, in `frontendOf`. The wac branch keeps the two error lists apart —
`lexed` carries the lexer's and `p.errors` the parser's — so a caller renders each with its own
table. The wapy branch does not:

```wac
WParsed wp = wapyParse(src);
return Frontend(wp.src, Lexed(wp.toks, wp.tokCount, i32[0](), 0), wp.program,
                wp.errors, wp.errorCount, string[0](fill: ""), i32[wp.errorCount](fill: 0));
```

The `Lexed` is built with an **empty** error array, and every error — lexer and parser alike — is
handed back in the parse slot. `wapyParse` merges them deliberately and correctly, pushing the
lexer's first:

```wac
WVec<i32> errs = WVec.create();
for (i32 i = 0; i < b.errorCount * 3; i++) { errs.push(b.errors[i]); }
```

so the *first* diagnostic on the example above genuinely is `errUnknownEscape`, code 3. It is then
looked up in `parseMessage`, whose space starts at 20, and falls through to the default.

Two code spaces in one list, rendered with one table. `diag.wac` says the spaces are separate in as
many words: *"the parse-phase codes, which are a separate space from the checker's"*.

## Not the same bug as 0277a, and what is left of that one

`issues/lang/0277a` is the escape half of this and its defect is gone with the reference compiler:

- Its subject was `compiler/wapyLex.ts`'s `unescape`, a second escape grammar that silently accepted
  every escape wac refuses. That file is deleted.
- `packages/wacc/src/wapylex.wac` has no escape grammar of its own. `blankComments` skips over a
  string so a `#` inside one is not blanked, and leaves the contents to `lex` — *"unterminated; let
  `lex` report it"* — so a `.wapy` file gets wac's escapes and wac's **codes**.
- Its printer half is gone too: `packages/wacc/src/wapyprint.wac` emits a string literal as
  `w.tok(tok)`, the token's own source span, so there is no re-escaping and no second spelling. The
  `JSON.stringify` that wrote `\uXXXX` was the reference's.
- Its open recommendation — *"wac should be the one to grow a string escape for a codepoint if
  anybody wants one"* — landed on 2026-08-28 as `design/lang/0013` step 2. `"\u{41}"` in a wapy
  string is now the letter `A`, by the same rule as in wac, because both run `lex`.

So the escapes agree and the codes agree. What does not is the **rendering**, and that is this
issue.

## Fix

Give the wapy branch the same two-list shape the wac branch has: `wapyParse` returns the lexer's
errors and the parser's separately, or `frontendOf` splits them by code space. The first is better —
splitting by looking at the numbers would be a third place that knows where one space ends.

`packages/wacc/test/wac/wapy_test.wac` is where the surfaces are compared today and where a case for
this belongs: one program per lexer code, asserted to say the same thing on both surfaces. That is
the guard `0277a` observed was missing when it wrote that a round trip *"only ever feeds the reader
output from the printer — which is valid by construction"*.

## Fixed, 2026-08-28

`wapyParse` now says how many of its errors are the lexer's — they are the first that many, since it
merges them in front — and `frontendOf` slices on that, putting them in the `Lexed` where the wac
branch has always put them.

A count rather than a second array: the merge already fixes the order, and a second list would be a
second place that has to agree about it.

    wac   error: unknown escape
    wapy  error: unknown escape

and `"abc` with no closing quote answers `unterminated string literal` on both.

**The guard asserts the split, not the message.** The codes were always right and arrived in the
wrong list, so what is worth pinning is that a lexical fault lands among `lexed.errors` and a
syntactic one does not — which makes the rendering correct without the test knowing anything about
message tables. The wac side is asserted too, since the claim is that the two agree and a test
reading only the wapy side cannot say that.

Proven to fail by putting the old shape back. The first version of the test then *trapped* rather
than failing, because it read `errors[0]` from the empty list — a trap where the useful sentence is
"the lexer's list is empty and should not be", so the read is guarded now and the failure says so.
