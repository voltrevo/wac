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

**Re-measured 2026-08-28, walking each literal escape by escape** so that `\\{` — an escaped
backslash followed by a brace — is told apart from `\{`:

| inside a double-quoted literal | occurrences |
|---|---:|
| `\{`, which would become interpolation | **0** |
| `\\`, the escaped backslash regex code relies on | 875 |
| a bare `{`, which `${…}` or bare braces would reinterpret | **4,875** |

The first row is the argument: no literal in the tree changes meaning. The third is the cost of the
alternatives, and it is the same order as the 6,065 *lines* counted when this was written — that
figure counted lines and this counts occurrences.

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
| 2 — `\u{…}` | **done**, 2026-08-28 — bounds shared with `string.fromCodepoint`, both sides of all three edges tested |
| 3 — the category rule | **done**, 2026-08-28 — six categories of seven; `Cn` deferred, see below |
| 4 — `u8` truncation | **done**, 2026-08-28 — character literals only; see the note below |
| 5 — `isUtf8` / `toUtf8` | not started |
| 6 — block strings | **done**, 2026-08-28 — D6's tab clause turned out to be D3's |
| 7 — interpolation | not started |

## Step 3 is not blocked by the no-dependencies rule, and here is what it costs

Worth writing down because the first answer was wrong. `packages/wacc` may import nothing, so it
cannot reach `packages/unicode` — and the category rule reads as needing a Unicode database, `Cn`
(unassigned) most of all. That looks like a wall and is not one.

**The database is already in the repository, and it comes from the host.**
`packages/unicode/README.md`: *"The tables come from the host — the host already carries a Unicode
database, that is what `toLowerCase` consults"*. `packages/unicode/tools/gentables.ts` enumerates
all 1.1 million code points, asks the engine, and emits sorted ranges with a binary search over
them. The question it asks today is one regex:

```ts
const notPrintable = /\p{Cc}|\p{Cn}|\p{Cs}|\p{Zl}|\p{Zp}/u;
```

which is five of this note's seven categories, including the expensive one.

**Measured against `isPrintable` rather than reasoned about**, since "printable" is a glibc word and
this rule is a Unicode one. Probing one code point per category:

| | `isPrintable` | D3 wants |
|---|---|---|
| `U+0007` Cc | no | refuse ✓ |
| `U+2028` Zl, `U+2029` Zp | no | refuse ✓ |
| `U+0378` Cn | no | refuse ✓ |
| `U+00AD` Cf soft hyphen | **yes** | refuse ✗ |
| `U+202E` Cf bidi override | **yes** | refuse ✗ |
| `U+E000` Co private use | **yes** | refuse ✗ |
| `U+200C` ZWNJ, `U+200D` ZWJ | yes | allow ✓ |
| `U+0041` | yes | allow ✓ |

So the gap is `Cf` and `Co`, both of which the same regex can ask for, and the two exemptions fall
out as a special case of two code points rather than as a table.

**What the no-dependencies rule actually decides is where the table lives**, not whether the step
can be done. `packages/wacc/src/coretext.wac` is already a generated file inside wacc's own tree —
the embedding of `core/` and `std/`, written by `tools/genCore.ts` and checked by the doc lane. A
category table is the same arrangement: generate it into `packages/wacc/src`, check it the same way,
and wacc imports nothing.

The cost is a generator, a table of a few hundred ranges, a binary search, and a `--check` mode so
it cannot go stale silently. Not free, and not blocked.

## What step 4 turned out to be, and what it is not

**Only the character-literal half of it.** The implementation first refused *any* integer literal
that did not fit a packed element — `u8[](300)`, `i16[](70000)` — on the reasoning that nothing about
such a literal can be right. That is wrong, and the specification says so with a tag:
`spec/spec/arrays.md`'s `[§wac-arr-i8-lit-trunc-i9g6kol]` states that `i8[](300)` returns `44`,
because *"the fixed-element form takes `i32` values too, and truncates them the same way a write
does — so a byte array can be written as a literal list"*. `spec/tour.wac` teaches it as well.

So the rule is exactly what this note asked for: a **codepoint** cannot be written where a **byte**
is held, because those are different things and coincide only below 128. A number that does not fit
still truncates, deliberately.

Three positions, since one rule with three spellings is one rule: an element of a literal list
(`u8[]('é')`), a store (`b[0] = 'é'`) and a comparison (`b[0] == 'é'`, in either order — the last is
the case this note leads with, and the one that reads as correct code). `errCharIntoByte`, code 209,
rather than the range code: a message reading "out of range" would have been false, since `'é'` is
233 and a `u8` holds 0..255.

Two independent checks caught the over-wide version within a minute of each other — the repo-wide
`corpuscheck_test` on `spec/tour.wac`, and the spec's own acceptance corpus on the clause. Worth
recording because the widening was reasonable-sounding and only the written rule settled it.

## Step 7's shape, from reading rather than from building it

Not started. What follows is what a reader should know before starting, so the first hour is not
spent finding it.

**Desugar in the lexer, not the parser.** D7 says interpolation is *exactly* sugar for `+`, and the
faithful reading of that is that `"a\{e}b"` produces the token stream for `"a" + e + "b"` — after
which the parser needs no change at all, and neither do the checker, the emitter or the printer.
`"a" + e + "b"` compiles today; that was the first thing checked.

**Lexing the embedded expression is the easy half.** On `\{` the scanner emits the segment so far,
emits a `+`, and returns to the ordinary token loop with a brace depth; on the `}` that closes depth
one it emits a `+` and resumes the string. Nested literals fall out — `"\{f("x")}"` works because the
inner `"x"` is lexed by the ordinary string rule. That is the balancing D7 says is inherent, and it
costs a depth counter rather than a second pass.

**The hard half is the spans**, and it is where the design has to be decided rather than derived. A
synthesised `"a"` token has no `"a"` in the source to point at: the segment sits between a quote and
a `\{`, and `stringLiteralBytes` reads a span expecting a quote at each end.

**There is a precedent in this repository and it should be followed.**
`packages/wacc/src/wapyparse.wac` synthesises tokens for a surface whose source does not contain
them, and gives them spans by appending a `synthTail()` to the source it hands back — its own header
explains the consequence at length: *"the `src` and `toks` handed back are not the caller's … a
caller that parses with this and then checks against `lex(original)` will resolve every name to the
wrong token"*. Interpolation needs the same arrangement and inherits the same warning.

**What to measure before starting**: ten consumers read a `kString` token today. Each one either
sees only the segments (fine) or needs to know a literal was interpolated (not fine), and which is
which is a half-hour of grep that will decide whether this is a day or a week.

## D6's tab rule is D3's rule, and asking twice said so twice

*"Tabs in the indentation are refused outright rather than assigned a width, so no block string can
mean two things to two readers."* That is right and it needs no code of its own: a tab is `Cc`, and
step 3 refuses every raw category-C character anywhere in a literal — indentation included.

Implemented as a separate check first, and the way it surfaced is the useful part: a block string
with a tab reported **two** diagnostics for one tab, one from each rule. The second was deleted
rather than the first, since D3's is the general statement and this is an instance of it.

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
