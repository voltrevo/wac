# 0013 — what a literal may contain, and where invalid UTF-8 comes from

- **Status:** done — 2026-08-29, all seven steps; see the table in *State of play*.
  What the note deliberately does **not** cover is listed under *Deferred, and not part of this*:
  value-to-string conversion in `\{}`, which waits on the same answer as operator overloading.
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
| 5 — `isUtf8` / `toUtf8` | **done**, 2026-08-29 — six clauses, and 489,744 inputs agreeing with Python |
| 6 — block strings | **done**, 2026-08-28 — D6's tab clause turned out to be D3's |
| 7 — interpolation | **done**, 2026-08-29 — sugar for `+` in the lexer; five cases, three clauses, and `strInterp` in the tour |

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

## The kString consumers, measured — agent-b, 2026-08-29

The section above asks for this before starting, and says it decides whether step 7 is a day or a
week. It is eleven sites, not ten, and **four of them need to know**. So: a day.

Under D7's desugaring `"a\{e}b"` becomes the token stream for `"a" + e + "b"`, so a consumer that
sees a `kString` sees a *segment* — an ordinary literal with ordinary contents. Seven sites want
nothing else:

| site | what it asks | why a segment is enough |
| --- | --- | --- |
| `emit.wac` `scanTokenTypes` | is there **any** `kString` in the file | it declares `i8[]`; a segment is a string |
| `lex.wac` `endsExpression` | can a `<` after this be JSX | a segment ends an expression like any literal |
| `parse.wac` `startsExpr` | can this token begin an expression | same |
| `parse.wac` generic-vs-comparison | is `id<i32>` a call or two comparisons | same, `design/lang/0011` criterion 10 |
| `parse.wac` `ExprKind.StrLit` | the literal expression itself | this *is* the desugaring's output |
| `emit.wac` `stringLiteralBytes` | the bytes of a `StrLit` | wants the span, which is the other problem |
| `blockstring_test.wac` | walks `kString` tokens | a test, and it would see segments |

**The four that need to know are the four positions where the string is not an expression.** Each
does `at1`/`expect(kString())` and then expects something specific next; handed `"a" + e + "b"` it
takes `"a"` and then meets a `+` it has no case for.

| site | position | what an interpolated one must do |
| --- | --- | --- |
| `parse.wac` (import) | `import { x } from "…"` | be refused: a module path is resolved at compile time |
| `wapyparse.wac` | the same, for `.wapy` | the same |
| `files.wac` | reads the path token's bytes to resolve the module | would silently resolve the first segment |
| `parse.wac` (JSX) | `<a href="…">` | be refused — `href={e}` is already how an expression goes there |

That last one is the only surprise in the list, and it is the reassuring kind: JSX already has a
spelling for an expression in an attribute, so refusing the interpolated literal is consistent rather
than a restriction invented for the implementation.

**So the plumbing question is narrow**: those four have to be able to ask *was this literal
interpolated?*, and the token is a flat quintuple with no spare field. The cheapest answer that does
not widen the token is for the lexer to record the interpolated literals' token indices on `Lexed`
beside `tokens` and `errors` — which is now an established shape there, since `issues/lang/0278a`
added a field to that struct for a different reason and it cost three constructions.

**Not measured here, and still the hard half**: the spans, as the section above says. Nothing in this
measurement makes that easier — it only says how much else is waiting behind it.

## The spans need no synthesised source, and the reason is the measurement above

The section on step 7's shape calls the spans "the hard half … where the design has to be decided
rather than derived", and points at `wapyparse.wac`'s `synthTail()` as the precedent to follow: a
synthesised token needs source to point at, so append some. That is one answer. There is a cheaper
one, and the measurement above is what makes it available.

**Point the segment tokens at the real source, and let the delimiters be what they are.** In

    "a\{itoa(n)}bc"

the three segments are `"a\{`, `}bc"` and — in a longer literal — `}…\{` in the middle. Each of
those is a real, contiguous run of the file. A span over it is exact, so every column in every
diagnostic is right for free, and the printer can re-render the literal from the source rather than
from a reconstruction. `stringLiteralBytes` already reads *between* the first and last byte of the
span and un-escapes what it finds; what it does not know is that a segment's delimiters may be `\{`
or `}` rather than `"`.

**And it does not need to know it from the span**, which was the blocker, because the four consumers
in the table above already have to be told which literals were interpolated. That plumbing — the
lexer recording interpolated tokens on `Lexed`, since the token quintuple has no spare field — is
required by the import paths and the JSX attribute whatever happens to the spans. Once it exists,
`stringLiteralBytes` is a fifth reader of the same fact, and the synthesised tail is not needed at
all.

So the ordering is: **the marker first, the desugaring second, the spans for free.** That also
inverts which half is hard — the "easy half" (a depth counter in the scanner) is unchanged, and the
hard half turns out to be a `Lexed` field the previous step already showed how to add.

**Not proven, and where it could still go wrong**: `stringLiteralBytes` is reached from `files.wac`
as well as from the emitter, and `path.wac`'s header says the import of it is already a near-cycle.
A fifth caller is fine; a fifth caller that needs the marker means `files.wac` needs the `Lexed` too,
which it has. Worth checking before writing code, and cheaper than either answer to the spans.

**The case to make pass**, kept here rather than in `spec/cases` because a case the compiler refuses
is a red suite for everybody until step 7 lands:

    // expect: answers f = 5
    string itoa2(i32 n) { return n == 42 ? "42" : "??"; }
    export i32 f() {
      i32 n = 42;
      string s = "a\{itoa2(n)}bc";
      return s.len();
    }

Today it answers `error: unknown escape` with the caret on the opening quote, which is the whole of
step 7's starting position.

## Step 7 is built, and the prediction above held — agent-b, 2026-08-29

`"a\{e}b"` compiles, and the whole of it is in the lexer: `lexStringBody` returns at a `\{` having
pushed the segment and a `+`, the mode stack — the one JSX already uses — remembers where to come
back to with `num` counting the braces the interpolation is not ended by, and the `}` that closes it
pushes another `+` and resumes the literal at that byte. `cInterp` is a fourth frame kind on a stack
whose sizing already covered it, since every push consumes a distinct `<`, `{` or `>` and the `{` of
a `\{` is one.

**No source was synthesised.** The segments' spans are runs of the real file, exactly as the section
above predicted, and the only thing that had to learn anything was where a literal's content begins
and ends. That is now `literalBodyStart`/`literalBodyEnd` in `emit.wac`, written once — because it
was written *twice*, and fixing one copy turned the case from a lexer error into
*a string literal with an escape this slice cannot read*, which is the same bug one layer down.

**And the parentheses, which nothing I wrote caught.** The desugaring has to be `("a" + e + "b")`,
not `"a" + e + "b"`. Without the group, `"a\{e}b".len()` measures the last segment: the postfix binds
tighter than the `+`. Five cases of my own passed anyway, because every one of them wrote
`string s = …;` and then `s.len()` — the assignment hides it. What found it was writing the *spec*
clauses and running the fence, where the natural way to state a claim about a literal is
`"…".len()`. The lesson is not about interpolation: **a case that names its subject in a local first
is a case that has stopped testing precedence**, and the spec's habit of writing the expression
inline is worth copying into `spec/cases`.

**The segments needed no synthesised source; the two `+` did.** That is the correction to the
section above, and it is worth stating because it points the other way from where I looked. A
segment has real bytes to span. The operators an interpolation *stands for* have none — there is no
`+` anywhere in `"a\{e}b"` — so their tokens span the `\{` and the `}` they replace, and anything
that renders an operator from its bytes then prints `(binary \{ …)`. Both printers did, so the wapy
round trip over 1,434 files failed on exactly the six that interpolate.

The fix is not a span. **An operator's spelling is its kind**, and for every operator anybody has
ever written the two agree exactly, so asking `kindName` instead of the source is right in general
and only *visible* here. Same in `print.wac` and in `wapyprint.wac`.

**The refusals are deliberate now, and no marker was needed for them either.** I had this down as
the one thing still wanting a field on `Lexed`. It does not: the parenthesis the desugaring opens is
the only `(` in a file whose span is a **quote**, because a written `(` spans a `(`. So
`P.atInterpolation` is two comparisons on the token stream and nothing is recorded beside it — the
same shape as the segments' spans, and the third time this design has turned out to need no state.

There were two positions rather than the four the table counts. `files.wac` reads a path token the
parser now refuses to produce, and `wapyparse` lexes its own strings — `wapylex.wac` never calls
`lexString`, so `\{` in a `.wapy` file is not interpolation and its import path was never at risk.

What it was worth: an interpolated import path reported **six** diagnostics, every one of them at
the same column, none about interpolation, and the first said `unexpected token … found '"'` —
naming a quote that is genuinely there, because the synthetic `(` spans it. It is one diagnostic
now, `perrInterpolatedHere`, headline *this string cannot interpolate* since the code is shared,
with the position in the note: *a module path is resolved before the program runs*, and for JSX
*write `a={…}` to put an expression in an attribute* — which names the attribute, and compiles when
followed.

**Block strings do not interpolate, and now say so.** D7 is silent on them and `lexBlockString` is
a scanner of its own, so `\{` in one was already refused — as *unknown escape*, which is true and
sends the reader looking for a typo. It has its own code now: *a block string does not interpolate —
`\{` opens an expression only in a one-line literal*. That is right whichever way the open question
goes, and the question is still open: **should they?** The argument for is that the two literal
forms differ in nothing else since D6 made the escape set the same; the argument against is that a
block string's content is usually something quoted verbatim, and `\{` appearing in it by accident
would be a new way for a paste to stop compiling.

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


## Step 5 was not blocked, and the row saying so pointed at nothing — agent-b, 2026-08-29

The state table said *"blocked — one question for the operator, in the section below"* and there was
no section below. Whatever the question was, it was never written down, which is worse than either
asking it or answering it: a blocker nobody can read is indistinguishable from work nobody did.

So I went looking for what it could have been, and the two candidates are both already answered:

- **"Is `s.isUtf8()` meaningful, or a constant `true`?"** `spec/spec/strings.md` settles it in the
  `fromBytes` clause: *"The bytes are taken to be UTF-8 and are not checked, so a string can hold
  sequences that are not valid UTF-8. That is deliberate."* A string can be ill-formed, so asking one
  is a real question. `[§wac-str-isutf8-value-r2nk8fq]` is that case.
- **"Where does the implementation go, given `packages/wacc` may import nothing?"** Nowhere new.
  Every string builtin is already a hand-emitted wasm helper — `str_index_of`, `str_slice`,
  `str_cmp` — reached through `env.funcAt(" str_…")`. Two more is the established shape rather than a
  mechanism decision.

**Emitted twice, over `i8[]` and `u8[]`**, because a `string` and a `u8[]` are different wasm array
types. The alternative is lowering `s.isUtf8()` as `str_is_utf8(str_to_bytes(s))`, which copies the
whole string in order to look at it — `toBytes` is a copy by specification. One emitter function,
called with two type indices.

**One trap, and it cost a build.** The type section is *sized* before any body is emitted, so a
`sigType` first asked for inside an emitter arrives after the count is fixed and the module refuses
itself: *"a type was registered while a body was being emitted — 70 counted, 72 wanted"*.
`fn[bool(string)]` and `fn[bool(u8[])]` are now registered up with `fn[string()]`. The rest of the
family got away without this because their signatures already existed for something else.

### `toUtf8`, and the check that mattered

Two passes over the input, the first to size the output and the second to fill it. The alternatives
were both worse: one pass needs `3n` allocated up front for the case where nothing is wrong, and
"validate first, copy if clean" needs the helper to call `is_utf8` — and no emitted helper in
`emit.wac` calls another, so being the first would be a change to how helper indices are assigned.

**The verification is the part worth copying.** The walk was checked as a plain reference
implementation against Python's `strict` and `replace` before any wasm existed. That says nothing
about the bytes emitted for it, so the *built* `string.isUtf8` and `string.toUtf8` were then run
against the same oracle: every 1- and 2-byte input, and 423,952 three- and four-byte inputs over the
boundary values — **489,744 in total, zero mismatches on either function**. Six hundred lines of
hand-written wasm bytes are not something a dozen hand-picked cases can vouch for.

With this, every step in the table above is done.

### One thing found on the way

`u8[](a as u8)` for an `i32` is refused with help naming three cast operators, and all three are
refused the same way, because `u8` is packed and there is no such conversion to spell. The bare
`u8[](a)` is what works. `issues/lang/0289b`.
