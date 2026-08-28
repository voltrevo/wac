# 0013 — what a literal may contain, and where invalid UTF-8 comes from

- **Status:** in progress — the reference is removed, so the order of work below is unblocked
- **Date:** 2026-08-28
- **Author:** agent-c
- **Blocks:** nothing. Three of the defects below are live today and none is urgent.

## What is wanted

One rule for what may appear inside a literal, one escape that can spell any
character, a multiline form, and interpolation — so that **every string literal
is valid UTF-8 by construction** and `string.fromBytes` is the single place
invalid bytes can enter a program.

That last property is the point. `string` is a byte sequence that is *taken to
be* UTF-8 and never checked, which `spec/spec/strings.md` states deliberately:

> **It does not validate.** … validating would cost a pass over every string
> built this way, and the callers that need it — a decoder, a parser — are
> better placed to check than the constructor is.

Those callers have nothing to check *with*, and there is no single place to look
when a string turns out to be malformed. Both are fixed by narrowing where
invalid bytes can originate and then giving that one boundary a predicate.

### What this is not

Not a UTF-8 guarantee on `string`. Invalid UTF-8 stays constructible, on
purpose — see D4. What changes is that it becomes constructible in exactly one
identifiable way.

Not a change to `+`. `§wac-str-noimplicit-p3jw7xf` makes `"count: " + 5` a
compile error and that stays; see D7.

## The rules, as they should end up

### What may appear raw

A literal may contain any character **except** Unicode category **C** (`Cc`
control, `Cf` format, `Co` private-use, `Cs` surrogate, `Cn` unassigned), **Zl**
and **Zp**, its own delimiter, and `\`.

**One exception: U+200C and U+200D** are allowed raw. They are `Cf`, but they
are the only invisible characters that change what a *visible* character looks
like rather than where it sits — emoji sequences are built from them, as is
correct rendering in Persian, Hindi and Malay.

### The two literal forms

|                   | may contain                     | escapes |
| ----------------- | ------------------------------- | ------- |
| `"…"`             | the above, minus `"` and `\`    | `\n` `\t` `\r` `\\` `\"` `\0` `\u{H…H}` |
| `'…'`             | exactly one of the above, minus `'` and `\` | `\n` `\t` `\r` `\\` `\'` `\0` `\u{H…H}` |

Symmetric: the same six plus `\u{…}`, differing only in which quote is
escapable.

### `\u{H…H}`

1–6 hex digits, **≤ U+10FFFF** and **not a surrogate**. In a string it encodes
as UTF-8; in a character literal it *is* the integer, so `'\u{1F600}'` is
`128512`.

### Block strings

```wac
string usage = """
    usage: wac build <entry.wac> -o <stem>
           [--allow-read] [--allow-write]
    """;
```

`"""`, then an unconditional newline, then the content, then the closing mark.
Escapes are cooked, exactly as in `"…"`. Trailing spaces are kept. A tab in the
indentation is an error.

### Interpolation

```wac
core.warn("wac: cannot read \{path} — \{words}");
```

The expression must already be a `string`.

## The decisions, with their reasons

### D1 — each form escapes its own delimiter, and only its own

`\'` in a string and `\"` in a character literal are each a second spelling of a
character that needs no escaping there. Nothing in the tree uses `'\"'`.

### D2 — one escape for any character, and it is `\u{…}`, not `\xNN`

`\u{…}` is validated, so it cannot produce invalid UTF-8; it is the *character*
escape. A byte escape was considered and rejected because a string literal is not
where that hazard belongs — see D4 — and because it would have been expensive:
`compiler/wacLex.ts` decodes into a JavaScript string, which cannot hold a lone
`0xFF`, so a byte escape forces the string token to carry bytes through the
parser, const-eval and the emitter.

Its bounds are `string.fromCodepoint`'s bounds, so the compile-time rule and the
runtime rule are one rule rather than two that can drift.

### D3 — ordinary characters only, stated by Unicode category

A codepoint range misses three things a category rule catches: the C1 controls at
U+0080–U+009F, the bidirectional formatting characters, and U+2028/U+2029.

The bidi characters are the only part of this work with a safety rather than a
hygiene rationale — a literal that renders to a reviewer in a different order
than the compiler reads it — and they need no special case once the rule is
stated by category.

The everyday payoff is the newline: today a missing closing quote runs to
end-of-file and reports `unterminated string literal` at the *opening* quote, so
one typo swallows a file and points at the wrong place.

### D4 — invalid UTF-8 stays constructible, through one door

Guaranteeing UTF-8 on `string` would mean validating in `fromBytes`, which the
spec already rejects with a reason. So the goal is not a guarantee but a *known
origin*: after D2 and D3, no literal can produce invalid UTF-8, and `fromBytes`
is the only remaining source. That is one greppable call rather than every
literal in the program.

### D5 — a block string's closing mark does one job

It decides whether the value ends in a newline, and nothing else. The margin is
the least indentation of the **content lines**; the closing mark's own line does
not participate.

This is deliberately not Java, which takes the minimum over the content lines
*and* the closing line — so moving the closing delimiter silently reindents the
whole value. Two rules then fall out rather than needing to be stated: blank
lines cannot count toward the minimum, and a line indented less than the margin
cannot occur, so no clamping rule is needed.

The cost is that a uniform leading margin is not expressible.

### D6 — a block string is cooked, and keeps trailing whitespace

Cooked, because every character must stay expressible and D3 has just forbidden
raw control characters. The accepted cost is that a backslash in the text is a
trap: `C:\new\table` is a newline and a tab.

Trailing whitespace is kept, so no `\s`-style escape hatch is needed. The
accepted cost is that an editor which trims on save silently changes a value; an
editor plugin should render them, which is worth writing down and is not a
blocker.

Tabs in the indentation are refused outright rather than assigned a width, so no
block string can mean two things to two readers.

### D7 — `\{…}` because it is an escape *and* the shape JSX already uses

**It has to be an escape.** `\{` is an unknown escape today, i.e. an error, so no
existing literal can change meaning. Bare `{…}` or `${…}` cannot say that:
**6065 lines in the tree have a `{` inside a string literal** — `bindgen` writing
TypeScript, `emit` writing wasm text — so either would need a `{{` escape and
would silently reinterpret every one. Under `\{`, a bare `{` in a string stays a
bare `{` and all 6065 are untouched.

**Braces rather than parens, because wac already embeds expressions in braces.**
JSX writes `<input size={itoa(n)}/>`, so `\{itoa(n)}` makes one shape mean
"an embedded expression" in both places instead of two answers to one question.
Secondarily, the delimiters are visually distinct — `\(itoa(n))` ends in `))` and
has to be counted — and braces are the majority convention, where `\(` is
Swift's alone.

Two things that look like objections and are not. **Regex code writes `\\{`**, 16
sites across `packages/regex` and `packages/sh`; unaffected, because the lexer
consumes `\\` as the escaped-backslash escape first and the `{` after it is an
ordinary character. And **135 lambdas in the tree have a block body**, so braces
do occur inside expressions — meaning `\{…}` needs brace balancing exactly as
`\(…)` would have needed paren balancing. Neither is free, and the lexer cost
below is identical either way.

Requiring a `string`-typed expression makes interpolation **exactly sugar for
`+`**, so precedence, evaluation order and the type rule are all `+`'s and
nothing new is specified. It is also a pure widening: admitting converted types
later cannot invalidate anything written now.

**The cost:** the lexer stops being able to scan a string in one pass.
`"\{f("x")}"` nests a string inside an interpolation inside a string, so it must
balance delimiters and recognise nested literals rather than stopping at the
next `"`. That is inherent to interpolation in any syntax.

## The defects this fixes

Three are live today.

**`\'` is accepted inside a string by `wacc` and rejected by the reference.**
`packages/wacc/src/lex.wac` carries the seven-entry character table on the
six-entry string check — copied, and present since wacc's first lexer commit
(`aedec3b7`). The decoded value is right either way, so it is a missing
diagnostic only, which is why nothing caught it.

**A character literal silently truncates into `u8`.** Measured:

```
u8[]('😀')[0]  is  0        codepoint 128512 truncated. No diagnostic.
'é' is 233;  "é".toBytes() is 195 169
b[0] == 'é'   is  false     can never be true. No diagnostic.
```

A character literal is a codepoint and `u8` is a byte; they coincide only below
128 and nothing checks. Every byte-scanning loop in the repository — wacc's own
lexer, `packages/sh/src/lex.wac`, the JSON parser — compares bytes against
codepoint literals and is correct by ASCII accident. There are **zero non-ASCII
character literals** in the tree, so rejecting the mismatch costs nothing today.

**`fromBytes` has no companion.** Adding, in both forms:

```wac
string.isUtf8(u8[]) -> bool      s.isUtf8() -> bool
string.toUtf8(u8[]) -> string    s.toUtf8() -> string
```

`toUtf8` replaces with U+FFFD on the WHATWG maximal-subpart rule — one
replacement per maximal invalid subsequence, not per bad byte — because that is
the only answer with an oracle: Rust, Python and every browser agree on it.
`isUtf8` must be strict, rejecting overlong encodings, encoded surrogates and
anything above U+10FFFF, not merely truncated sequences. A naive validator
accepts overlongs, and this is the function people will lean on precisely
because `fromBytes` does not.

## Why they went unnoticed

The lexer differential was deliberately deleted — *"the reference is not an
oracle for the language"* — and **six of the seven lexer error codes now have no
test**. `packages/wacc/test/wac/codes_test.wac` covers only
`errUnterminatedString`. This is not a proposal to revive the differential: each
step below should add its own diagnostic to that table, which is the cheap
prevention that was missing.

## Order of work

The reference compiler is being replaced by a ladder bootstrap that only has to
compile wacc. **Nothing here should be executed until that lands**, because
step 1 as written would otherwise be done twice and `compiler/wacLex.ts` may not
survive. Whether the bootstrap implements these rules at all depends on whether
it lexes the full language or only what wacc's own source uses.

1. **`\'` and `\"`** — the two delimiter defects. Smallest, and independent of
   everything else.
2. **`\u{…}`** — needed before step 3, which is only reasonable once every
   character has a spelling.
3. **The category rule** for what may appear raw.
4. **The `u8` truncation** — independent of 1–3 and the most severe, being a
   silent wrong answer rather than a missing diagnostic.
5. **`isUtf8` / `toUtf8`** — independent of all of the above.
6. **Block strings.**
7. **Interpolation.**

Steps 1–3 move `spec/spec/strings.md`, `spec/spec/types.md` and
`spec/spec/grammar.md` together: the grammar has one shared `escape` production
including `'`, which is what makes wacc's current string behaviour
grammar-conformant, and it splits in two.

Each of 1, 3, 4 is a breaking change and belongs in the breaking-changes note.

## State of play

| Step | State |
| ---- | ----- |
| 1 — `\'` and `\"` | **done**, 2026-08-28 — `codes_test.wac` holds both directions and both controls |
| 2 — `\u{…}` | not started |
| 3 — the category rule | not started |
| 4 — `u8` truncation | not started |
| 5 — `isUtf8` / `toUtf8` | not started |
| 6 — block strings | not started |
| 7 — interpolation | not started |

## Deferred, and not part of this

**Value → string conversion.** Interpolation wants `"\{n}"` for an `i32`, and
JSX wants the same rule rather than one of its own. The obvious mechanism — the
compiler looking for a method by a magic name like `toString` — is not the
answer: making a method name special is a smell, and it would be wac's first,
since nothing in the language today dispatches on a name the compiler knows.

It does not stand alone either. **Operator overloading** has the identical
shape: a way for a type to say "I participate in this", *declared* rather than
inferred from a spelling. Whatever answers one should answer both.

So both wait, and until then `"\{itoa(n)}"` is the spelling, JSX is unchanged,
and `§wac-str-noimplicit-p3jw7xf` stands. When conversion does arrive it belongs
in `\{}` and not in `+`: `+` is an operator on values, where an implicit
conversion is a footgun, while interpolation is syntax whose entire job is
building a string.
