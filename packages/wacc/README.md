# wacc — a wac compiler, in wac

Porting the wac compiler to wac, so it can eventually compile itself. The
TypeScript compiler in `~/bare-repos/wac.git` is the reference at every stage: same
input, compare outputs, no judgement calls about correctness.

The point is not the compiler. It is that a compiler is precisely the program shape
wac is worst at — ASTs want sum types, symbol tables want generics, everything
wants strings — so this exercises the top four entries in
`~/notes/living/wac/language-friction-log.md` with a real consumer instead of by
inference.

## Ladder

Each rung is independently verifiable against the TS implementation, so none of
them depends on the next being designed yet.

| rung | reference | oracle | TS lines |
|---|---|---|---:|
| 1. lexer | `wacLex.ts` | token streams match | 366 |
| 2. parser | `wacParse.ts` | ASTs match under a canonical serialization | 1651 |
| 3. type checker | `wacTypeCheck.ts` | diagnostics match, including positions | 3189 |
| 4. emitter ▸ | `wacEmitFunc.ts` + `wasmBuildBin.ts` | modules agree under a canonical form, and the corpus runs | 6307 |
| 5. bootstrap | itself | fixpoint: wacc's own output, compiled both ways, byte for byte | — |

Corpus for every rung: every `.wac` file in wac-mono and `wac/spec/tour.wac`, plus
generated edge cases.

### Rung 4 is not "the same wasm bytes"

It was, and the change is worth the paragraphs because the reasoning generalises: the
sharpest oracle available is not always the right one.

Byte identity asserts far more than *the same module*. It pins the type section's
ordering and its dedup order, function and local index assignment, section order, the
name section's contents, constant pooling — and LEB128 widths, since a non-canonical
encoding is legal wasm and the same instruction can be written more than one way. None
of that is the language. Held to it, wacc would be reproducing not wac but *this
implementation of wac*, and every cosmetic refactor in the reference would arrive as a
wacc bug report.

Which is not hypothetical. The reference emitter took **85 commits in the thirty days
before this was written, 24 of them in the last seven**, and several changed emitted
bytes outright — the name section being added at all, a `ref.cast` heap type index past
63, bulk array operations, hex literals read at the width they are read into. Rung 4 is
also the longest rung here, 6,307 reference lines against the parser's 1,651. Byte
identity would mean chasing a target that moves about three times a day, for the longest
stretch of the ladder, where most of the reds are not wacc's.

The failure signal is the other half of it. Rung 2 answers with `(binary@14:7 …)` — a
node, at a position, in a named file. Byte identity answers "offset 12,345 differs",
which is actionable only after somebody writes a disassembler this ladder does not
budget for.

So rung 4 compares **a canonical module form** — types resolved to their structure
rather than to indices, functions by name, locals renumbered canonically, LEBs
normalised — which is the trick rung 2 already uses one level down, and for the same
reason: the two sides build unrelated structures, so project both onto one form. A
mismatch reads as "function `foo`, instruction 12: `i32.add`, reference has `i32.sub`".

Beside it, the oracle already sitting in this repository for nothing: **compile the
corpus with wacc and run it.** 326 files, 78 of them tests written in wac. Behavioural
agreement over a suite this size is the semantic claim byte identity was standing in
for, and it needs no new tests written.

Byte identity stays as a *measurement* — how many functions match, reported, not gated —
because knowing how close the two are is worth something and being held hostage to it is
not.

**Rung 5 is where byte identity is the actual claim** rather than a proxy for one. A
fixpoint compares wacc's output against *itself*, compiled both ways: no foreign
implementation's incidental choices, no moving target, and nothing in it that is not the
property being asserted.

## Two things the language forces, found before writing any code

**Tokens should not carry their text** — though as of `ea22a8f`/`35e938c` they
now *could*. The TS `Token` has `text: string`, and when this was written nothing
in wac could build a `string` from bytes; `string.fromBytes` and `string.toBytes`
now exist, so the constraint is gone.

The decision stands anyway, on its own merits rather than as a workaround: a token
holds `start` and `len` byte offsets into the source, which is how real compilers
do it because it is cheaper than a string per token. Consumers compare byte ranges.
What has changed is that this is now a choice, and a token that genuinely wants its
text can have it.

The **string literal** case is the one the new builtins actually change. The TS
lexer stores the *unescaped value* (`"a\nb"` becomes three characters), which a
byte range cannot represent. The plan is still that a string token keeps the raw
span including quotes and escapes and unescaping moves to whoever needs the value —
but that consumer can now produce a real `string`, by unescaping into a
`packages/bytes` `Buf` and calling `toStr()`, rather than being unable to represent
the result at all. The differential test can compare either that string against the
TS token's text directly, or the span unescaped host-side.

**Column numbers mean different things.** The TS lexer indexes by UTF-16 code unit;
a wac lexer walks UTF-8 bytes. Any line containing non-ASCII — which includes most
comments in this repo — gets different column numbers, and diagnostics are compared
by position at rung 3. Options are to count code points in the wac lexer (matches
TS except for astral characters, which TS counts as two) or to declare byte columns
correct and adjust the reference. Deferred until rung 1 measures how often it
actually differs.

**Token kinds have to be functions.** No module-level constants, so ~80 token kinds
become ~80 zero-argument functions. Mechanical, but it is the clearest measurement
yet of that gap: an enum of 80 variants costs 80 function declarations, and the
numbering has to be kept in sync with the harness by hand.

## Generics, and two constructs that came with them

The parser reads type parameters and type arguments — `struct Vec<T>`, `T max<T>(T a, T b)`,
`Map<string, Vec<i32>>`, `Vec<i32>[2](fill: …)` — which is
[wac-mono 0003](../../issues/closed/0003-wacc-parser-does-not-implement-generics.md). Until it did,
twenty-five files were skipped by name, including all of `packages/std`, which is the most
generics-dense wac in existence: the corpus is the whole value of a differential test, and a blind
spot in the newest part of the language is the worst place to have one.

Three pieces, and the awkwardness is all in the third:

- **`typeParams` on a declaration** — an optional `<A, B>` after the name of a struct, an enum or a
  function. One parser, three callers.
- **`typeArgs` in a type** — and the lexer has already munched `Vec<Vec<i32>>`'s close into a single
  `>>`, so the parser consumes one `>` worth and rewrites the rest in place, position included.
  `>>>` closes three. `P.toks` being mutable is what makes that possible.
- **Two lookaheads.** `Vec<i32> v = …` is a declaration and `a < b > c` is not; `Vec<i32>(…)` is a
  construction and `a < b` is not. Both scan for a *balanced* `<…>` followed by something that settles
  it, and both track parentheses and brackets, because `Box<fn[i32(i32)]>` contains both and a scan
  that stopped at the funcref's own `)` read the declaration as an expression. The reference has had a
  bug in each of them separately, which is why `afterTypeArgs` is one function here.

Two more constructs came with the same corpus, both of which the working half of the corpus happened
not to contain:

- **`match` as an expression** (`case P: value,` arms), which is how half of `Option<T>` is written.
  `Arm` gained a `value`, so one arm type serves both forms — a body for the statement, a value for
  the expression.
- **methods in an enum body**, which `Option<T>` has six of. A method is told from a variant by shape
  (`type name(this, …)` is not something a variant can look like), and `override` on one is refused as
  the reference refuses it.

`const` on a parameter is the one thing still behind, and only in the language rather than in this
parser: the AST field exists and the parser accepts it, but wac itself does not allow `const` on a
free function's parameter, so the read-only intent of the lookahead helpers here cannot be stated.

## Status

**Rung 2 (parser) passes.** The AST it builds agrees with the reference node for node, positions
included, on all 326 `.wac` files in the repo plus the language tour — nothing is skipped any more —
and on 74 hand-written cases a working corpus cannot contain (every precedence level, every cast,
`else if` chains, bare-statement `switch` bodies, trailing commas everywhere, char and string escapes,
malformed types, a nested `>>>` close, a funcref inside a type argument, and the comparisons that must
*not* be read as type arguments).

**Rung 1 (lexer) passes.** Token for token, position for position, against the reference on the same
326 files plus 32 adversarial cases the corpus cannot cover (unterminated everything, every escape,
greedy operator runs, non-ASCII columns).

**Rung 3 (type checker) has started.** One diagnostic of ~210: a `return` whose literal cannot be the
declared return type. `src/check.wac`, `test/typecheck.test.ts`, and positions that match the
reference exactly — `export i32 main() { return "x"; }` is reported at 1:28, the `"`, which is where
the reference puts it and not where the `return` is.

It catches **every** literal-return mismatch across the primitive grid — 32 of 40 (type, literal)
pairs are rejections, and all 32 are found. The rule was derived from the reference rather than
assumed, by generating the grid and asking:

| declared | accepts |
|---|---|
| `i32` `i64` `u32` `u64` | an integer literal |
| `f32` `f64` | a float literal |
| `bool` / `string` | a boolean / a string literal |
| `u8` `u16` | nothing — a packed type cannot be a return type at all |

The grid is regenerated on every suite run rather than tabulated here, because a table copied into a
test is a second implementation of the language's assignability and drifts the first time the
reference changes its mind.

It also types a returned **name**, against the function's parameters and locals — the first symbol
table in the package. That needed a second rule rather than a wider one:

- a returned **name** must have the declared type *exactly*: `i64` from an `i32` function is an
  error, and so is `f32` from `f64`;
- a returned **literal** is polymorphic over a family, and any of `i32 i64 u32 u64` accepts an
  integer literal.

Modelling only the family caught 58 of the 72 rejections in the (return type × parameter type) grid,
and the fourteen it missed were all *within* a family. Both grids run on every suite invocation.

A name declared twice in one function is **poisoned** to unknown rather than resolved. wac scopes by
block and this slice does not track blocks, so a local shadowing a parameter would otherwise make a
lookup confidently wrong — and a confident wrong answer is the one thing a subset checker may never
give. Declarations are collected in a pass of their own before the body is walked, so a `return`
above a declaration still resolves it.

### A second oracle: the spec, not just the implementation

Everything above compares wacc to the reference *implementation*. `spec/` in the `wac` checkout is
what the language *says* — 409 tagged assertions across 18 files, executed by `wacSpec.test.ts`, one
test per tag. The rejection ones call `err(...)` with a complete program the language declares
illegal, so the spec already contains the corpus rung 3 needs, and a better one than anything written
here: it is the language's own statement of what is illegal, it grows when the language does, and each
case carries the tag that governs it.

`test/specCorpus.ts` extracts them rather than copying them — 101 programs under 63 tags — and
`typecheck.test.ts` asserts two things. That **the reference honours the spec**, for every case, which
is a divergence check on wac itself and also what proves the extraction produced real programs rather
than fragments failing for being malformed. And that **wacc never contradicts it**: silent, or right
about the position. Coverage is reported rather than asserted, since this slice knows one diagnostic
of roughly 210 and a threshold would be a number somebody made up.

    101 rejection programs, 83 rejected by the type checker, 1 of those also caught here

**It found something on its first run.** `[§wac-arr-i8-noreturn-k7fn2qp]` is
`export i8 getByte() { return 0; }`, which the reference rejects and wacc did not: the packed set here
was `u8` and `u16`, because those are the two *I* thought of when deriving the grid by hand. `i8` and
`i16` are packed too. That is the argument for a second oracle in one line — the grid was derived from
a list I wrote, and it could only ever check the list I wrote.

### Control flow, the second kind of thing rung 3 does

*"not all code paths return a value"* is the largest family in the spec's rejection corpus after plain
type mismatches, and it needs no expression typer at all — only the statement walk that was already
there. Reported at the **function declaration** rather than the closing brace, which is where the
reference puts it: the fault is the function's, not any one statement's.

The interesting rule is `while (true)`. A loop with no exit never reaches the statement after it, so a
function ending in one needs no return; give it a reachable `break` and the closing brace is reachable
again and a return is required. Four of the spec's seven cases are that, with the `break` hidden in a
block, an `else if`, and a `match` arm — so "does this loop contain a break" walks as deep as the
statements go, while stopping at a nested loop or `switch`, whose breaks are their own.

**Spec coverage: 8 of 83**, from 1.

`match` and `switch` had to be modelled rather than skipped, and the repo corpus is what said so: six
functions in `check.wac` are a single `match` with a return in every arm, and treating that as falling
through reported all six. A `match` leaves when every arm does, since the language makes it
exhaustive; a `switch` also needs a `default`, because without one a subject matching no case falls
straight through.

That guard now runs over **every `.wac` file in the repo** rather than wacc's own six. It is the test
that catches a rule which looked sound on a dozen hand-written cases and is not, and it has earned
that twice already.

### The same question one position over

A variable's declared type against its initialiser, reusing the return rules exactly — a literal is
polymorphic over a family, a name has one type. That reuse is the point: if the second position needed
different rules, one of the two would be wrong.

`null` is the new part and it covers two spellings. `i32 z;` and `i32 x = null;` parse to the same
`NullLit` initialiser and the reference gives both *"expected i32, got null"*, so a missing
initialiser needs no rule of its own — it is already this one. A `T?` declaration legitimately takes a
null, and `primOfType` answers `primNone` for a nullable type, so those stay silent rather than being
wrongly refused.

**Spec coverage: 12 of 83**, from 8.

### Into the expressions

Everything before this looked only at the top expression of a return or an initialiser. Operand
checking needs a walk, which is the machinery this slice adds — and then `+ - * / %` require both
operands to be the same type.

**Only those five**, and the restraint is the point. Shifts deliberately accept mixed widths
(`i64 << i32` is legal, and the friction log records a compiler bug from assuming otherwise), while
`&& || & | ^` and the comparisons answer *differently worded* diagnostics when their operands
disagree — which a comparison by code would merge with this one. The operators left out cost recall
rather than correctness. A literal operand is skipped too: `x + 1` is legal for any numeric `x`,
because the literal takes the other side's type.

**Spec coverage: 14 of 83**, from 12.

`Binary.op` is a token **index**, not a kind. Comparing it against `kPlus()` compares an index to a
kind and is quietly always false — the first version compiled, ran, and reported nothing.

### Calls, and a table that outlives a function

A call's arguments against the parameters of what it calls — the first table here that is not cleared
per declaration, because a call names something declared elsewhere in the file and often further down.
Signatures are collected in a pass of their own, the same argument as collecting locals before walking
a body, one scope up.

**`g(a)` is a `Construct`, not a `Call`.** The parser cannot tell a call from a struct construction —
`Point(1, 2)` and `g(a)` are the same syntax — so it builds `Construct` with a `Named` type for both
and the resolver decides later. A checker matching `case Call` reports nothing at all, which is what
the first version did. A real `Call` is a method or a funcref, whose callee needs a receiver or a
value type resolved first, and is silence.

Arity is left to the reference, which answers it with its own message. Pairing arguments with
parameters positionally when the counts differ would report the wrong ones anyway.

**Spec coverage: 15 of 83**, from 14.

The operator sets were read off the reference rather than assumed, and there are three:

- **`+ - * / %` and `& | ^`** answer `type mismatch in 'op': A and B` whenever the operands differ.
  One rule, no exceptions among primitives.
- **`< <= > >= == !=`** answer the same, *except* when an operand is a reference type, where it is
  `'op' not allowed on reference type`. `string` is the only reference type this slice can name, so
  comparisons involving one are left alone — a different family reported under one code is what that
  avoids.
- **`&& ||`** never answer a mismatch. `1 && 2` is `'&&' requires bool operands`, which is about each
  operand on its own rather than about the pair.

Shifts are in none of them: they deliberately accept mixed widths, and the friction log records a
compiler bug from assuming otherwise.

Widening to the second and third sets did not move spec coverage — the corpus's operand cases are all
arithmetic — so this buys recall on real code rather than a number. Worth saying plainly, since a
slice that moves no counter is easy to mistake for one that did nothing.

### Where only a boolean will do

Two of the reference's messages and one rule: *"'&&' requires bool operands, got i32"* and
*"condition must be bool"*. Both say an expression is used where only a boolean can go, and nothing a
caller does with the diagnostic would tell them apart, so they share a code. Conditions of `if`,
`while`, `do`/`while` and `for` are checked as well as the two operators.

A **literal counts** here, unlike in the same-type rule: `p && 1` is an error where `x + 1` is not,
because the question is what each operand *is* rather than whether the two agree — and there is no
other side for the literal to take its type from.

**Spec coverage: 16 of 83**, from 15. `[§wac-boolreq-uj95exp]` was the very first case the extractor
found, and is now caught.

Adding it broke the operator test, correctly. That test filtered the reference's diagnostics for
`type mismatch in`, which was right while the file knew only the same-type rule and became a lie the
moment it knew another: `i32 && i32` is rejected with different wording, so the filter made a rejected
program look accepted. **A filter on message text is a second opinion about which diagnostics count**,
and a comparison against an oracle should not have one.

Removing it exposed the other half. A single list asserting "the reference rejects this, so we must
report it" folds two obligations into one, and a subset checker has two: what a rule *owns* must be
caught, and what it does not own must be silent — where "the reference rejects this and we say
nothing" is a pass. The operator test is now two lists for that reason.

### The string exclusion was wrong, and no test could see it

Last slot excluded `string` from the comparison rule, on the strength of seeing `'<' not allowed on
reference type` and assuming a comparison against a string was a family this rule did not own. Asking
about both orders shows it is not that simple, and not a problem either:

    i32 == string   ->  '==' not allowed on reference type string
    string == i32   ->  type mismatch in '==': string and i32
    string == string -> ok

The *message* depends on which side the string is; the **position is the operator in every case**, and
position is what this reports. So the exclusion cost recall for nothing. It is gone, and two strings
compared stay silent because they agree rather than because of any rule about strings.

Worth noting how it survived: nothing failed. A rule that reports too little is invisible to every
test that asks whether what we report is right, and the spec corpus had no case for it. Recall is only
visible where somebody thought to look.

### No test filters the oracle any more

The `type mismatch in` filter that turned out to be a lie was not the only one — the missing-return
and call-argument tests filtered on `all code paths` and `type mismatch` too. All three are now two
lists, `CAUGHT` and `QUIET`, comparing against everything the reference says.

That shape encodes the two obligations a subset checker actually has. What a rule owns must be caught,
at the reference's position. What it does not own must be silent — and there, *"the reference rejects
this and we say nothing"* is a pass.

### A type is its name

The type model was a small integer per primitive. That was enough while every type was one, and the
limit the moment structs mattered. **A type is now its canonical name** — `"i32"`, `"P"`, `""` for one
this slice cannot spell — which costs a string compare where an id cost an integer one, and buys the
rest of the type system: two struct types differ exactly when their names do, and *"is this a
reference type"* is *"is this name not a primitive"*.

The refactor alone moved coverage 16 → 17, with no new rule: `return q` from a `P` function and
`Q q = p` are the existing rules meeting types they could not previously name.

Then identity, which is new: `==` and `!=` are not allowed on a struct **even when both sides are the
same struct**, because the question is identity rather than equality — the reference says
`'==' not allowed on reference type P — use 'is' for identity`. `string` is the exception the language
makes, so the rule asks about the name rather than about reference-ness. Restricted to structs
declared in the file: an enum, an import or a generic parameter is also not a primitive, and nobody
has measured what the reference says about those.

**Spec coverage: 18 of 83**, from 16.

One thing the refactor exposed rather than broke. `void` used to come back as *unknown* and so was
excluded from the missing-return check by accident; now it is a name like any other and is excluded on
purpose, by `returnsAValue`. The test that caught it was `"void nothing() { }"` — the exclusion was
right all along and had never been stated.

### Arrays and nullables, and the first rule that is not equality

`i32[]` and `P?` are names built from the name inside, so the existing rules reach them: two array
types differ exactly when their element types do, and an array is a reference type, so `==` is refused
on one as it is on a struct.

Nullables needed a **rule** rather than a name, because assignment is not symmetric. A non-null value
goes into a nullable slot — `P? q = p;` is legal for a `P` — and the other direction is rejected under
a different message, *"cannot assign nullable to non-null"*, which this slice does not own and stays
quiet about. So the three comparison sites now ask `assignable(want, got)` rather than `want == got`,
and a `T?` accepts whatever `T` accepts plus null.

Spec coverage holds at 18: none of the corpus's rejections are array or nullable shapes. Recall on
real code, not a number.

**It found a false alarm in this file.** `typeOfTy` has an `Arr` arm declaring a local `string inner`
and a `Nullable` arm binding a `Ty` also called `inner`. Match-arm bindings were not declared at all,
so the local's type leaked across the arms and `typeOfTy(c, inner)` was reported as an argument
mismatch against its own parameter. They are declared as *unknown* now, which silences them and —
because a second declaration poisons — silences any local elsewhere in the function sharing the name.
The whole-repo corpus caught it, on the file it was written in.

### Member access

`p.x` has a type now, taken from the struct's field declarations — the largest widening of what an
expression can be typed from since names arrived, and it needed no new rules at all. Every rule
already built reaches field reads without knowing anything about fields. The receiver is typed by the
same function, so `a.b.c` works by recursion for as long as every step is nameable.

Inheritance is one hop per lookup up the `parentTok` chain, bounded by the number of structs so a
cycle — which the reference rejects separately — terminates rather than hangs. A field the chain does
not have is *unknown* rather than an error, because `struct 'P' has no field 'nope'` is the
reference's own diagnostic and a family this slice does not own.

Fields are three parallel arrays rather than a per-struct list, because a field is looked up by
(struct, name) rather than by position, so the offset-and-count shape the function table uses would
buy nothing.

Spec coverage holds at 18 — the corpus's rejections do not include field-type shapes — so this is
recall on real code again.

### Method bodies, which were not walked at all

`checkProgram` descended into `Func` declarations and nothing else, so a method's returns,
initialisers, operands and conditions went **entirely unchecked**. That is a bigger hole than any
single rule, and it stayed invisible because every hand-written case in the test file is a free
function — the whole-repo corpus could not see it either, since a rule that reports nothing is exactly
what that guard is looking for.

`this` is an ordinary `Ident` whose text is `this`, so typing it is one entry in the scope — the
struct's own name — and `this.x` resolves through the field table that already existed. A method
without `this` is static, and `this` means nothing in it.

Missing return is reported at the **return type**: a `Method` carries no position of its own, unlike a
`Decl`, and the return type is the first thing it has that does. That is where the reference puts it
too.

Spec coverage holds at 18, for the fourth slot running. The corpus is 83 rejections drawn from what
the *spec* chose to document, and it has stopped being the thing that measures progress here — worth
saying, because a counter that does not move is easy to read as a checker that is not growing.

### Assignment, and the position a type is in

The initialiser question with the declared type coming from the *target* rather than a `Ty` node, so
it needed an lvalue walk — its own node family: a name, a field of one, an element of one, or an
unwrapped nullable. `LIndex` is the one place a type gets narrower going down the tree (`i32[]` to
`i32`) and `LUnwrap` the other (`T?` to `T`). Only plain `=`; a compound assignment is the operator's
rule, which skips literals on purpose.

**It reported 113 files on its first run**, all the same shape: `out[at] = 0` where `out` is `u8[]`.
Storing an integer into a **packed array element** is the ordinary way every byte buffer in this
repository is written — the `i32` truncates at the store — while `u8 x = 5;` as a local is genuinely
an error. Those differ by *position*, not by type, and every rule here had been written from the
return-type grid where packed accepts nothing. Packed targets are silent now, because what the
reference accepts beyond truncation has not been measured.

That is the lesson worth keeping from this slot: a rule derived in one position is not a rule about
the type. The grids that built this checker all asked about return types, and the answer they gave is
narrower than it looked.

### Every expression form has a type

`typeOfExpr` answered *unknown* for everything except a name and a member, so casts, `is`, unary,
index, ternary, calls and constructions evaporated and every rule downstream went quiet on them. All
of them are typed now, each read off the reference first:

| form | type |
|---|---|
| `n as i64`, `as!`, `as~` | the cast's target — the four spellings differ in what they *permit*, not in what they produce |
| `p is P` | `bool`, whatever `x` and `T` are |
| `-n` / `!b` | the operand's type / `bool` |
| `arr[0]` | the element type |
| `b ? n : n` | both branches or nothing |
| a call | the function's return type, so signatures now carry one |
| a construction | the struct — or the return type, since the parser cannot tell a construction from a call |
| `opt!` | the `T` inside a `T?` |

**Spec coverage: 19 of 83**, from 18 — and a grid of 78 cells, 65 rejections, all caught.

Two things it found. Reading a **packed array element widens**: `return this.data[i];` from an `i32`
function is how this repository reads a byte, so calling `bytes[i]` a `u8` reported 115 files. That is
the same position lesson as the packed assignment target last slot, arriving from the read side —
which is now two independent confirmations that the return-type grid's answer for packed is narrower
than it looks.

And the grid itself was nearly useless. It *reported* how many cells it caught rather than asserting
it, so untyping casts moved the number from 65 to 50 and passed. A recall regression that prints
itself is still a recall regression. It asserts `caught === rejected` now, and a form deliberately left
untyped comes out of `FORMS` — so the removal is the decision, rather than a count quietly dropping.

### Struct construction, and nullable into non-null

Two families in one slot, both using the field table.

**Construction arguments** are checked against the fields they fill, positionally, and only when the
arity matches. Both restrictions are the reference's rather than conveniences. A wrong count is
*"positional construction of 'P' expects 2 arguments"*, its own family. And `P(x: 1)` is **not**
named-argument syntax — the reference answers *"expects 2 arguments"* and *"undefined variable 'x'"*,
so whatever that spelling means it is not this, and a rule written for it would have been a rule for
something the language does not have. Inherited fields come **first**, which is measured: `C(1.0, 2.0)`
for `struct C : B` puts the complaint on the first argument, where `B`'s field is.

**Nullable into non-null** gets its own code rather than folding into a type mismatch, because the
reference words it differently and a caller can tell them apart: one says the types are unrelated, the
other says they are the same type and one of them might not be there. `assignable` still answers
`true` for the shape, so exactly one diagnostic lands at the position rather than two.

**Spec coverage: 20 of 83**, from 19.

The corpus caught a generic. `struct Box<T> { T v; }` has a field whose type is the *parameter* `T`,
which is a name like any other and therefore looks like a struct called `T` — enough to make
constructing a `Box` a field mismatch against a type that does not exist. A generic struct's fields are not recorded now,
so its arity is zero, never matches, and construction of one says nothing.

### The const family

Three refusals, kept apart because the reference keeps them apart: *"cannot assign to const variable
'n'"*, *"cannot write to const field 'k'"*, *"cannot write through const reference"*. They say
different things about where the constness lives — on the binding, on the field, or on the path to it
— and a caller fixing one would not fix the others. Constness now rides alongside type in the scope
and in the field table, so a `const` parameter, a `const` local, a `const` field and a `const this`
are all one mechanism.

Every write counts, not just `=`. `n += 1` and `n++` are refused on a const exactly as `n = 1` is,
which is why the check runs before the plain-`=` gate the assignment rule uses.

All three report at the **root of the path**, and that was measured rather than assumed: for
`p.k = 1` the reference names the `p`, not the field node one column later. Reporting at the node that
is actually const is the obvious choice and is off by one against every compound target — nested
paths, array elements and `const this` all confirm the root.

**Spec coverage: 26 of 83**, from 20 — the largest jump up to this point, and the reason is that the
corpus's untouched cases were clustered in one family rather than scattered.

### Method calls, and a statement nothing walked

A method table — owner, name, whether it is static, whether its `this` is const — and calls checked
against it. Static and instance calls are the same syntax, differing only in whether the receiver names a struct
or a value, so the receiver decides which question is asked and
the scope is consulted first, because a local shadowing a struct name is a value.

**Spec coverage: 27 of 83**, from 26.

Three exclusions, all found by the corpus rather than reasoned out. A **generic**'s methods are not
recorded, so an empty answer means "not modelled" rather than "not there" — `this.hash(k)` inside
`Map<K, V>` is an ordinary call. A **funcref field** is called like a method: `packages/sh` has four.
And the question there is the field's *existence*, not its type — a funcref field has no name this
slice can spell, so asking its type says "no such field" about a field two lines above.

Genericity is recorded rather than inferred from an empty field table, because *generic* and *has no
fields* are different facts and only one of them means say nothing.

**The find of the slot was a statement nothing walked.** `p.set(1);` is an `ExprStmt`, and `checkStmt`
had no arm for one — so every expression rule reached only expressions that were part of something
else: a return, an initialiser, a condition. A statement that is just a call is the commonest shape in
the language and had no rule applied to it at all. It surfaced as the const-receiver check looking
broken when it was merely unreached, which is the second time this week a rule has looked wrong and
been unvisited instead.

### Is every node kind actually walked?

Twice in two slots a rule looked broken and was merely unreached: method bodies were not descended
into, and a bare expression statement had no arm. Both cost a slot, both looked like a wrong rule, and
both had the same tell — one case of a family failing while its siblings passed.

No rule test can find that, because a rule test puts its subject where the walk already goes.
`test/reach.test.ts` asks the other question: for every node kind, bury a **known-bad construct**
inside it and check the diagnostic still comes out. The planted fault is the same everywhere, so a
failing cell means *this kind is not walked* and never *that rule is wrong*.

It found two on its first run. A `for`'s **init and update** were declared but never checked, so a
`for` with a wrong initialiser said nothing — `For` passed on its body and failed on its init, which
is the shape of a walk that descends one field and not its siblings. And a **cast's operand** was
never entered, because typing a cast as its target — the right answer — meant never looking inside it.

**Then the grid failed its own test.** Planting the method-bodies bug again left it green: it varies
where a statement sits within a body and where an expression sits within a statement, and never
*which body*. That is the dimension the bug lived in. A third grid covers the containers — free
function, exported, instance method, `const this`, static, and a method of a child struct — and both
historical bugs now fail by name.

The lesson is the one the grid nearly missed: **a dimension you did not think to vary is invisible no
matter how finely you vary the others.** Written after a bug, a test tends to cover the shape of that
bug rather than the space it came from.

### The cast operators, which are a claim rather than a synonym

Four spellings, and the language treats each as a statement about what is happening: `as` says nothing
is lost, `as!` says the value is checked, `as~` says it is truncated, `as@` says the bits are
reinterpreted. Writing the wrong one is an error precisely so that a reader can trust the spelling.

**Spec coverage: 31 of 83**, from 27, and a grid of 120 conversions with all 54 rejections caught.

`losslessCast` and `rawCast` are **tables, not formulas**, because no formula fits. `u32 -> u64` is
lossless and `i32 -> u64` is not, since the first cannot be negative. `f32 -> f64` is and
`i64 -> f64` is not, since 53 bits of mantissa do not hold 64 of integer. And `as@` is close to *an
integer target no wider than the source* except for `f64 -> i64`, which the reference refuses while
allowing `f64 -> i32`. A rule invented to cover most of that would have been wrong about the rest, so
the tables are carried and the grid re-derives them from the reference on every run.

**The positions took three corrections**, and only the corpus found each one:

- *"lossy cast not needed"* names the **operand**;
- *"'i32' -> 'u32' is lossy — use 'as!', 'as~', or 'as@'"* names the **operator**;
- *"no raw conversion"* names the **operator**.

The complaint that names the operand is the one saying the cast should not be there; the two that name
the operator are saying this operator is the wrong one. That reads as a principle in hindsight and was
three separate contradictions in practice — each landing two columns from the right answer, which is
close enough to look like an off-by-one and be something else.

Losslessness is also decided **before** the operator is looked at: `x as@ i64` from an `i32` is *"not
needed"*, not *"no raw conversion"*. The reference complains that the conversion needs no help before
it complains about which help was offered.

### Four families that were invisible rather than wrong

**Spec coverage: 55 of 83**, from 31 — the largest jump of rung 3, and none of it came from a rule
being wrong. Each family was one nothing had ever *looked* at.

The tell was the same each time: a rule that had been implemented and tested still missed corpus
cases, so the gap was not in the rule but in where it ran.

- **Statics do not inherit.** A static call on `Sub` is an error even when `Base` declares `make` — instance
  methods inherit and statics do not, so a static lookup uses `ownMethodAt` rather than `methodAt`.
- **Constness follows the receiver through fields.** Calling a mutating method on `this.inner`
  inside a `const this` method is refused. The first version only looked at receivers that were plain names, so every deep
  receiver came back non-const. `constExpr` now walks member, index and unwrap.
- **A parameter list, read for its own sake.** `f(i32 a, i32 a)` needs no type information at all —
  and was missed because every rule before it was about a *use*, and a walk never visits a signature.
- **A scope wider than a function.** A file's `const` declarations are in scope in every body, so
  `clearScope` keeps them and `globalCount` marks where a function's own names begin. Without that,
  `const P S = P(1); S.v = 9;` had nothing to look up.
- **Array elements carry the array's element type.** `i8[](1.5)`, `i32[](, 1)` and `E[2](fill: 5)`
  are the initialiser rule at a position that had no rule. A packed element is an `i32` here, the way
  `bytes[i] = 5` is: the width is the array's business.
- **The builtin surface on primitive types** — the biggest of them, 14 cases. `f64.toBits`,
  `string.fromCodepoint` and their siblings are declared nowhere, because they are the language's
  own. A receiver that is a type name but not a struct fell through every branch and was silently
  skipped, so a call to an `f64` static that does not exist, and `string.fromBytes` handed an
  integer, both passed unremarked.

The builtin arguments are compared **exactly, not by assignability**: `f32.toBits` handed an `f64` is refused
even though an `f32` widens to an `f64` everywhere else, because reinterpretation is about a width
rather than a value. A literal is the one exception and takes the parameter's type, as an initialiser
does.

**A false alarm in my own test.** `f64[2](fill: 1)` went into the QUIET list on the assumption that an
integer literal fills a float array. It does not — an int literal widens to `i64` but not to `f64`,
exactly as `f64 x = 1` is a mismatch. The checker was right and the test was wrong, which is the good
direction for a disagreement to run and worth writing down: the QUIET list is an assertion about the
reference, not a place to record what I expect.

### Rules about declarations, and two about operators

**Spec coverage: 70 of 83**, from 55. Thirteen uncaught, and the list is short enough to name below.

Everything up to the last slot was a rule about a *use* — an expression in a position, checked against
what that position wants. These are mostly not that. A struct is refused for what its fields say, a
method for what its parent declares, a parameter for the type it was written with. Nothing had to be
used for any of them to be wrong.

- **`override` is checked in both directions.** A method hiding a parent's without saying `override`
  is an error, and `override` with no parent method to override is also an error. A checker that did
  one and not the other would look right on half the cases. The first names the child's **return
  type** — where a method's declaration starts, the same position a missing return uses — and the
  second names the **keyword**, which is the part that is wrong. A `Method` carries no position of
  its own, so the parser now records the `override` token: the only diagnostic here that names a
  keyword rather than a node.
- **Default values, which are a property of a type rather than of an expression.** `P()` asks whether
  `P` can be built out of nothing. Primitives have a zero, arrays and strings an empty one, a
  nullable has null — and an **enum has none at all**, even one whose every variant is payload-free,
  because there is no variant the language would pick for you. A struct has one when every field
  does, so `hasDefault` recurses with a depth guard, and hitting that guard is not a fallback: a
  struct that reaches itself through non-null fields genuinely has no default, since building one
  would need one first.
- **The same fact, seen from the declaration.** `struct Node { Node next; }` is refused on sight,
  with no construction anywhere in the file to hang the complaint on — which is exactly why the
  field rule has to exist separately from the construction rule rather than being derivable from it.
- **A `const struct` makes every field const** without any of them saying so. One word instead of one
  per field, and the existing const-field machinery then does the rest.
- **Positional construction counts inherited fields.** `B : A` with one field each takes two
  arguments. Measured, and it also settles that a wrong count is reported *once*, at the
  construction, rather than also as a field mismatch.
- **A packed type has no slot of its own**, so it cannot be a parameter — it exists as an array
  element and nowhere else.
- **A downcast can fail**, which no other cast can: `s as Circle` needs the checked `as!`. Upcasting
  is silent, because a `Circle` is a `Shape` with nothing to check.
- **Strings are immutable**, so `s[0] = "H"` is refused — and at the index rather than at the root of
  the path, unlike every other write complaint, because the immutability is the string's rather than
  the path's.

The two operator rules are worth stating because **the reference's message is not the rule**. `++` on
a `u32` is fine even though the message reads *"requires i32 or i64"* — only floats are refused, which
is measured rather than read off the text. And `>>>` is refused on an unsigned type not because it is
wrong but because it is **redundant**: on a type that is already unsigned it says nothing `>>` does
not, and the language would rather you wrote the shorter one.

The expression form of `++` was the fourth node kind nothing walked. `IncrStmt` had the statement
case, so `p.n++;` was checked and `return x++;` was not. Every previous instance of this had the same
tell — one member of a family failing while its siblings passed — and it has now cost enough that the
reachability grid should be extended to expression *positions of statements*, not just statement kinds.

### Five rules that need something other than a type, and a grid that found its own gap

**Spec coverage: 76 of 83**, from 70. Seven left.

- **`break` and `continue` need something to leave**, which is the only rule here that depends on
  *where* a statement is rather than what is in it — hence a loop depth on the checker's state. And
  the reference accepts `continue` inside a `switch` despite a message that says *"outside loop"*, so
  switches count for both. Measured, not inferred: **the message is not the rule**, which is now the
  third time that has mattered.
- **Arithmetic on booleans.** Two booleans *agree*, so the same-type rule had nothing to say about
  `a + b` — this is the question of what the operands are, the same distinction `&&` draws one
  operator family along.
- **Call arity**, reported once at the call rather than once per argument that happened to line up
  with the wrong parameter.
- **A nullable packed type has no representation.** `u8?` is not a narrower `i32?`: unwrapping one
  has to yield a value and no slot is one byte wide. Refused wherever the type is written.
- **A module-level `const` may not call a function.** Phrased as "does this contain a call" rather
  than "is this constant", because the second is the larger claim and the first is what the corpus
  distinguishes.

Two mistakes worth keeping, both about **pass order and position** rather than about a rule:

- The const-initialiser pass first ran *before* signatures were collected, so `funcAt` found nothing
  and the rule silently reported zero. That looks identical to a rule that does not work.
- `u8?[]` reported three columns late, because **each `[]` and `?` suffix carries its own token
  position** — a complaint about the type reported at the `Ty` lands on the bracket. Rung 2 learned
  this about parse errors; it reached a different consumer here, and only the corpus's
  never-contradict assertion caught it.

**The reachability grid found two gaps of its own**, which is the first time it has paid for itself
rather than confirming what a rule test already knew. It now varies *which kind of expression holds
the fault* — the dimension the `Incr` bug lived in — and it checks itself against the AST: the list of
`ExprKind` and `StmtKind` variants is read out of `ast.wac` at test time, so a node added tomorrow
fails the file by name. A hand-written count is only ever as complete as the day somebody counted.

What it found: `a[i]++` never walked the `i`, because a write's target was examined for what it *is*
and not for what is in it; and `MatchExpr` arms were not walked at all, since they hold expressions
where the statement form holds statements. Neither is in the spec corpus — which is the argument for
the grid, since recall is only ever visible where somebody thought to look.

### Generics, which were one decision rather than a feature

**Spec coverage: 76 of 83.** The number did not move, and what happened underneath it is the point.

A generic was previously invisible: `typeOfTy` returned *unknown* for every instantiation, because
`Box<i32>` and `Box<f64>` are different types and the name `Box` cannot tell them apart. So no
generic's fields were recorded, no method on one was checked, and `packages/std` — the most
generics-dense wac in existence — was silent for the wrong reason.

The fix follows from the model rather than extending it. **A type is its canonical name**, so an
instantiation spells itself: `Box<i32>`, `Pair<i32, f64>`. Invariance then costs nothing — two
instantiations differ exactly when their names do — and the `Box<Base>` from `Box<Sub>` corpus case
falls out of string inequality. What remains is **substitution**: a member written `T`, read in the
world of whatever the owner was instantiated with. `T` becomes `i32`, and `T[]` becomes `i32[]`,
because the suffixes are peeled off and put back rather than substituted through.

Three things had to be told apart, and each of them was a false alarm first:

- **A bare template is not a type.** `Box(1.0)` is legal — the arguments are *inferred* from whatever
  the construction flows into — so it is typed as unknown rather than as `Box`, which is a type
  nothing has. `isGeneric` stays exact while `isStruct` resolves to the template, and the two
  together say it: a bare `Box` is the unmodelled template, `Box<i32>` is a real type.
- **Inside a generic's own methods, the bare name means the instantiation being compiled.**
  `return Vec(T[](), 0)` inside `struct Vec<T>` is ordinary, and five sites in `packages/std` are
  exactly this shape. Typing it as `Vec` reported every one of them.
- **A generic function's signature is written in its own parameters**, which mean nothing at a call
  site: `Box<T>` accepts every `Box<…>` and `T` accepts anything. Recorded as unknown, arity kept —
  the arity does not depend on the types.

That last one **cost a case, correctly**. `i32 x = unbox(b)` used to be caught, because `T` as a
return type was compared against `i32` and differed. It was right by accident and would false-alarm
the moment `T` *is* `i32`. Trading it for an honest unknown is why coverage stayed at 76 while the
checker got better, and it is worth writing down that those two are not the same measurement.

**Neither remaining generic case is about generics.** Both need *target-type inference* — knowing what
type a construction is flowing into — which is a different machine from substitution and the one place
the reference does real inference. `Box(1.0)` is legal where a `Box<f64>` is expected and
`Box(1).get()` is not, and nothing local to the expression distinguishes them.

The substitution itself is asserted in `typecheck.test.ts` rather than by the corpus, which has one
invariance case and nothing else: fields, `T[]` under a suffix, multi-parameter `Pair<A, B>`,
constructor arguments, and a missing method on an instantiation, each against the reference's exact
position.

**What is left, all six:** two deep-const cases, one of
which needs flow analysis (`Counter c = this; c.mutate();`); an `f32` literal out of range, which
needs the literal's value and not just its text; the two generic cases above, which are inference
rather than generics; narrowing after `is` in a condition; and a field access on an enum variant.

### A second corpus, and the eight bugs it found in an afternoon

The spec corpus is a sample of the language chosen to *explain* it. The reference's own test file is
what the reference is actually **held to** — 88 `ok` programs and 124 `fail` ones — and the halves do
different jobs:

- **The `ok` half is a false-alarm corpus.** Every one type-checks cleanly, so a diagnostic from us is
  a bug in us, with a named program to look at rather than a file somewhere under `packages/`. The
  whole-repo silence guard is the same idea over code that happens to exist; this is the same idea
  over code somebody wrote *because* it was interesting.
- **The `fail` half is a recall corpus**, denser per family than the spec's.

It found **eight false alarms on the first run**, in four families that the spec corpus and the repo
guard had both missed for slots on end:

- **`alwaysLeaves` read only the last statement of a body**, so `{ return 1; i32 dead = 2; }` looked
  like it fell through. Any statement settles it: everything after a `return` is unreachable and the
  function still always leaves. Four slots of missing-return work never noticed, because no accepted
  program in the spec corpus has dead code after a return.
- **A `bool` casts losslessly to every numeric type**, and the other direction is lossy and takes
  `as!` or `as~` but not `as@`. The cast grid measured numeric pairs only, so the whole `bool` row was
  *absent* rather than wrong — a grid is only as complete as its axes.
- **A child goes into a parent's slot without a cast.** Upcasting by assignment is the same fact as
  upcasting by cast, one syntax along, and nothing in the spec corpus assigns a child to a parent.
- **`anyref` holds any reference** — struct, array, string, nullable — but not a primitive, so it is
  not simply "accepts everything".

And one contradiction: **`++` reports at the node's own position**, which differs between the two
forms. A statement `x++;` starts at the `x`; the expression `return x++` is positioned at the
operator. Passing the position in rather than deriving it from the operator token lets one function
serve both.

Recall against it is **printed, not asserted as a floor**. A subset checker that may never lose ground
on 124 programs is one nobody can refactor — and this slot proved the point, since making generic
function signatures honest deliberately gave a case back.

### A name nothing declares, which is a rule about the whole file

**Spec coverage: 77 of 83. Reference recall: 72 of 124**, from 59, with no false alarms in either
corpus or the repo.

`undefined variable` was the most-missed family in the reference's tests at thirteen, and it is the
last rule here that needs a **complete** picture of scope rather than a fact about one construct.
Every other rule can be wrong by staying quiet. This one is wrong by *speaking*: any binder the
language has that the checker does not know about is a false diagnostic on working code. So the
interesting half of its test is the QUIET list — one entry per way wac has of introducing a name,
which is what the rule is actually made of.

Two of them were found by the guards rather than by thinking:

- **A match used as an expression binds names too**, and the declaration pass walks statements. So
  `case Some(v): v * 3` reported `v` as undefined in three files. The bindings are now declared where
  they are used, which works because an arm's value is walked immediately afterwards.
- **An assignment's target is an `Lvalue`, not an `Expr`**, so `undeclared = 5;` went unreported by a
  rule that handles `i32 x = undeclared;`. The same rule, one node kind along — the fourth time that
  distinction has hidden a case.

One test lost its premise here, which is worth recording because a QUIET list can age out silently.
`return later;` sat in "a name this slice cannot resolve is silence, not a guess" on the grounds that
a name from outside the function was unknowable. It has not been unknowable since the checker gained
a module scope: the reference calls it *"undefined variable 'later'"* and now so do we, at its column.

### Ten families, and a question asked the wrong way round

**Reference recall: 106 of 124**, from 72, with no false alarms in either corpus or the repo. Spec
coverage unchanged at 77 of 83 — these are families the spec never sampled, which is the whole reason
for having a second corpus.

Most of them are unremarkable once measured: `void` is not a type a parameter or a field can have; a
`return` disagreeing with the function's own voidness, both directions; the unary operators wanting
three different things (`!` a bool, `-` a number, `~` an integer); a field the owner does not have; a
member reached through a nullable; indexing something that is not an array. Four are worth keeping:

- **The bitwise operators want integers, which is narrower than numeric.** `a & b` on two `f64`s is
  refused although the two *agree*, so the same-type rule never saw it — the same shape as the bool
  case, one operator family along.
- **A compound assignment is the operator's rule and the assignment's at once**, but reported at the
  **target**. Literals count here, unlike in a binary expression, because there is no other side for
  a literal to take its type from: the target settles it.
- **A method is not a missing field.** Which meant the `Call` case had to walk the *object* rather
  than the callee — walking the callee reads a method call on `p` as a field access to the
  method's name and calls it missing, one line before checking it as the method it is.
- **`x[0]` names the operand as an expression and the bracket as an lvalue**, and the bad-index
  complaint names the index as an expression and the bracket as an lvalue. An lvalue is one node with
  one position and the reference uses it for both. Same split as `++`, and it cost a contradiction
  each time before being measured.

**The lesson of the slot is a question asked the wrong way round.** Three rules were written first as
*negatives* — is this **not** a reference, is this **not** nullable, is this **not** an array — and a
negative question is answered "yes" by every type the checker cannot see. `v is null` on an enum, on
a funcref, on a generic instantiation: **27 files**, none of them doing anything wrong. Asking the
positive question instead — *is this a type I can name as a primitive* — only ever fires on something
known.

That is the same principle as "unknown is silence", which this checker has followed from its first
rule, but it does not look like it when written as a negation. A negation of an incomplete predicate
is a *complete* predicate about the wrong thing, and the tell is that the false alarms all land on
the parts of the language the checker models least.

The QUIET half of that test is now one line per reference kind — enum, funcref, array, generic
instantiation, nullable struct — which is the list that was missing rather than an example of it.

### Funcrefs, callability, and a predicate that is about the wrong thing

**Reference recall: 122 of 124**, from 106. Spec unchanged at 77 of 83. No false alarms anywhere.

A funcref becomes a real type the same way a generic instantiation did, and by the same decision: **a
type is its canonical name**, so it spells itself — `fn(i32) -> i32`, the reference's own wording —
and two of them are the same type exactly when their spellings agree. Arity at a call through one is
then counted off the spelling, because the spelling *is* the type.

**What is callable** turned out to be four questions and only the first is a function: a declared
function, a local holding a funcref, a local holding something else — not callable at all — and a name
that is nothing, which is the undefined-name rule reaching call position.

The cast family the numeric tables could not express: between two references only `as` and `as!` mean
anything, and which one is right depends on the direction. Upcasting is always safe and takes `as`;
downcasting can fail and takes `as!`; `as~` and `as@` are refused outright, because truncating and
reinterpreting are questions about a bit pattern and a reference has none to discuss. `i31ref` pairs
with `i32` and nothing else — lossy going in, lossless coming back.

**The mistake of the slot was a predicate that is about the wrong thing.** "A primitive has no
methods" is true, and `isPrimitiveName` is not the predicate for it: `string` is in that list, and a
string has `slice` and `len` and more. The rule reported 70 files, then 10. `isPrimitiveName` answers
*how a type is passed*, not *what it can do*, and those coincide for every member of the list except
the one that matters.

What is left of the rule is the half that can be stated without a measurement this checker has not
made: **a number has no methods at all**, which is a fact rather than a list. Arrays and strings keep
their silence until somebody measures their builtin surface — which is the same trade the QUIET half
of the test now records, one line per type whose surface is unknown.

Two cases remain. `case true:` needs a position on the `Case` node, which is a parser change worth
making deliberately rather than in passing; and a static method used as a value types as a funcref,
which is the only remaining place a member needs to *produce* one.

### A generated sweep, and the concept three rules were missing

Both corpora are nearly exhausted — 77 of 83 and 122 of 124 — and neither can say anything about a
combination nobody wrote down. **Every grid in this package has had hand-written axes**, and each
one's gap was in an axis somebody forgot: the cast grid measured numeric pairs and so missed the whole
`bool` row.

`generate()` builds the cross product instead — 17 types against ~30 contexts, **9,554 programs in
0.6s** — so a type added there is asked about in every context at once, and a context added there is
asked about every type. Nothing in it encodes an expectation: it is a *program source*, and the sweep
asks the reference what each one means.

What is asserted is deliberately **not recall** but two properties about being wrong: no false alarm
on a program the reference accepts, and no contradiction. Recall is printed. A number that may never
fall on nine thousand programs makes every refactor a negotiation, and this ladder has already traded
a case away on purpose once.

The **canary** is asserted first and separately, because a differential harness that compares nothing
reports that everything agrees and every number it prints looks reassuring. It was also verified the
only way that means anything: by reintroducing a fixed bug and watching the sweep name the cell.

**What it found, immediately: the concept three rules had been missing.** `isPrimitiveName` includes
`string`, and a string is a *reference* — it can be null, so `s is null` is a fair question; it can be
cast to itself, so `s as string` is not redundant; it has methods, so `s.slice(…)` is not a call on
something with none. That list is about how a type is **passed**, not about what it can **do**. Three
rules had now been written with it where they meant "held by value", so the distinction has a name —
`isValueType` — because naming it is cheaper than remembering it.

And a gap neither corpus reached at all: **`typeOfExpr` had no `Binary` arm**, so every binary
expression typed as unknown. A comparison is `bool`; everything else is the type of whichever operand
is not a literal.

### The cast law, in three worlds

**Sweep recall: 88% → 97%**, from generalising the one family the sweep said was thin: 894 of the
1,294 missed cells were casts.

Three worlds rather than one table. **Value to value** is the numeric tables. **Value to reference and
back is never a conversion at all** — a number and a reference have nothing in common to convert, and
`i31ref` is the one type that exists to cross. **Reference to reference** takes only `as` and `as!`.

Which of the two takes two independent halves, and this is the part that needed measuring rather than
guessing: a cast is the safe direction only if the **type** widens *and* the **nullability** does.
`P? as Base?` is a downcast despite both sides being nullable, because a `P` is not a `Base`; and
`P? as P` is a downcast despite the types matching, because it takes away the possibility of absence.
Requiring only one of the two was wrong in both directions — one sweep cell each, found in seconds.

Also measured, and the opposite of what the first version assumed: **a self-cast is redundant in all
four spellings**, not only the plain one.

### A blanket exemption, and the half of the sweep that was thin

**Sweep recall: 97% → 99%.** The sweep named three families and one of them was a rule of this
checker's that was *too broad*.

`assignable` said **any nullable source fits any slot**. It was written for the nullable-into-non-null
family, which reports separately, and the breadth was never the point — but from the outside a blanket
exemption is not a wrong answer anywhere, it is **no answer at all**. `P?` into an `i32` was silent,
forty cells over, one per (nullable type, unrelated slot). That is a shape a hand-written test does
not go looking for, because the rule reads as correct and the cases it swallows are somebody else's
family.

Two more the sweep named: a compound assignment wants something arithmetic can be done to — a number,
or a `string`, which concatenates — because an array, a struct, an enum and a funcref all *agree with
themselves*, so the type comparison had nothing to say about `a += b` on two of them. And a funcref
converts to nothing but itself: there is no hierarchy of function types and nothing to check at
runtime, so every cast spelling is refused.

**Narrowing the hatch then broke a working program, and the reference corpus caught it where the sweep
did not.** `Circle?` goes into a `Shape?` for the same reason a `Circle` goes into a `Shape`, and
unwrapping only the source compared `Shape?` against `Circle`. The sweep had no cell for it, because
**only 495 of its 9,554 programs were valid** — the no-false-alarm half, which is the half that
catches a checker being *wrong* rather than merely incomplete, was barely exercised at all.

So the generator gained a family of programs that are **well-formed by construction**: each wraps the
type in a declaration that makes the use legal *whatever the type is* — a struct with a field of it,
an array of it, a function taking and returning it, a nullable widened from it. That is still a
generated axis rather than a curated one, which was the point of the file. Accepted grew **495 → 834**.

**The first thing the new family found was not a wacc bug.** `fn[i32(i32)][2](fill: a)` is the one
hole in a seventeen-type row: the reference's *parser* reports seven errors and its checker then says
*"type 'null' is not an array"*, a type nothing in the program mentions. Sized array construction with
a funcref element does not parse, while the unsized form, the parameter form, and every other element
type do. That is [wac 0079](../../../wac/issues/open/0079-a-sized-array-of-funcrefs-does-not-parse.md).

The sweep now skips programs the reference's parser rejects, and says how many. That is the boundary
rather than a workaround: rung 3 compares type checkers, and a program that did not parse has no type
diagnostics to compare — whatever the checker says next is about a broken tree, which is rung 2's
oracle and not this one's.

### The reference corpus, finished — and three facts the checker did not record

**Reference recall: 124 of 124.** Spec 78 of 83. Sweep 99%, no false alarms anywhere.

None of the last three was a rule nobody had thought of. Each was blocked on a **fact the checker did
not record**, which is a different kind of gap and took a table rather than a branch:

- a `case` arm had no **position**, because a `Case` is not a `Stmt` — and *"case value must be i32"*
  names the keyword rather than the value, the same exception `override` is;
- a method call had no **type**, because nothing recorded what a method returns;
- a static method had no **signature**, because nothing recorded its parameters.

The middle one is the one worth keeping. Calling a mutating method on what an accessor hands back
reads like a way to launder
constness, and the language refuses it. **What decides is the receiver, not the return type**: a method called on
something const returns something const. That is three lines in `constExpr`, and it was unreachable
for four slots because the call in the middle typed as unknown.

Recording method returns is worth more than the one case it closed: every rule downstream of a method
call had been stopping there. `c.get()` is now checked where it lands, and a generic's method is read
in the instantiation's world, so `Box<i32>.get()` is an `i32`.

**A static method named without being called is a funcref** — `S.make` is a `fn() -> S`, which is why
assigning it to an `i32` is an ordinary mismatch rather than the *"cannot use method as a value"* an
instance method gets. A static is a function; an instance method is not one until it has a receiver.

**What is left, all five, and each needs its own machine:** two nullable-narrowing cases, where
`s.radius` is legal after `if (s is Circle)` and not after `if ((s is Circle) || true)` — flow, not
types; a deep-const alias (`Counter c = this; c.mutate();`) — also flow; an `f32` literal out of
range, which needs the literal's *value* and not just its text; and target-type inference, which is
two of them. None is a missing rule, and each is a different analysis from the one this rung is.

### Narrowing, and a rule that arrived with its own blind spot

**Spec coverage: 79 of 83**, from 78. Reference 124 of 124. Sweep 99%, no false alarms anywhere.

An enum's value is one of its variants and the checker does not know which, so a payload field is not
reachable through the enum type — `s.radius` on a `Shape` is an error. A **guard** is what makes it
reachable, and this is the first rule here that depends on *where in the control flow* an expression
sits rather than on what is around it.

Which guards count is measured rather than reasoned about, because the reference declines to be as
clever as it could be:

- `x is T` narrows, and `&&` propagates it, because both sides must hold;
- **`||` does not**, because the other arm may be the one that held;
- **`!` does not**, so an early return under a negated guard leaves the rest unnarrowed even though a
  reader can see it is safe;
- and nothing survives the `if`.

The last two matter more than they look. A checker that were *cleverer* here would be silent where the
reference complains — a miss — and one less clever would complain where it is silent, which is a false
alarm on working code. Matching a deliberate simplification exactly is as much the job as matching a
rule.

Each variant is registered as a **type of its own** with its payload as fields, which is what makes
`s.radius` resolve once `s` is a `Circle`; the then branch is walked with the name retyped and the old
type put back, because this checker's names are one flat table per function.

**The rule arrived with its own blind spot, and that is the part worth keeping.** Reporting unnarrowed
access is a *rejection*, and all three oracles are built from rejection programs — the spec corpus is
rejections by construction, the reference corpus's accepted half had no such program, and the sweep
had no cell for it. So `if (s is Circle) { s.radius }`, a perfectly legal program, was reported for
several minutes with every guard green. The sweep gained one narrowing cell per type, both halves, and
was then checked the only way that means anything: by disabling the narrowing and watching twelve
cells go red.

A generator bug on the way, worth recording because it is a shape that will recur: the new cells
declared `enum EN { A, B(T p) }` while the shared prelude already declares `enum E { A, B }`. A variant
is a type, so `e is B` resolved to the *prelude's* `B` and all 119 cells came back rejected — including
the ones that should have been accepted, which is why the accepted count never moved. **A shared
prelude is a shared namespace**, and it is easy to forget when the thing being generated declares
types of its own.

### A value and an alias — and the two cases left are both inference

**Spec coverage: 81 of 83**, from 79. Reference 124 of 124. Sweep 99%, no false alarms anywhere.

**The float rule is the only one here that has to compute something.** `3.4028235e38` fits an `f32`,
`3.4028236e38` does not, and f32's maximum written out in full with no exponent at all fits — so no
amount of looking at the text answers it. The literal is parsed to an `f64` and compared against
`3.4028235677973366e38`, the largest value that still rounds to something finite, and the arithmetic
has room to spare at that width.

Only `f32` is range-checked, which is the reference's choice and not an oversight of this one:
`f64 x = 1.0e400` is out of range for an `f64` too and it is accepted. Matching that is the job.

Two things the rule needed that were not about floats:

- **A sign is a unary operator**, so the entire literal path skipped a negated one — `f32 x = 1.0e40`
  was checked and `f32 x = -1.0e40` was not. `litKindOf` now sees through a sign, which is what every
  rule asking it already meant.
- **A range complaint names the literal where a family mismatch names the whole expression**:
  `i32 x = -1.5` is reported at the `-`, `f32 x = -1.0e40` at the `1`. Measured, and worth stating as
  a pair, because either alone reads as an off-by-one against the other.

**The const rule is about aliasing.** `Counter c = this; c.mutate();` inside a `const this` method is
refused: the local and the receiver are the same object, so the local is const too. What took a
correction was *which* types carry it — a `string` is a reference and an immutable one, so assigning a
new string to the local mutates nothing, and marking it const reported seven sites in one file. It
carries for a type you can write **through**: a struct or an array.

**Both remaining cases are target-type inference**, and they are the same machine seen twice:
`Box(1.0)` is legal where a `Box<f64>` is expected and `Box(1).get()` is not, and nothing local to the
expression distinguishes them. That is the one thing the reference does that this checker does not do
at all — every rule here reads an expression and asks what it *is*, and inference asks what it is
*required to be*, which is the other direction through the same tree.

### Inference: the one thing that flows down the tree

**Spec coverage: 82 of 83.** Reference 124 of 124. Sweep 99%, no false alarms anywhere.

Every rule in this checker reads an expression and asks what it **is**. A bare `Box(1.0)` cannot be
asked that: its type arguments come from wherever it is going. So the checker now carries one piece of
information in the other direction — what the expression about to be walked is *required to be* — set
by each context that has a slot, and **read and cleared** at the top of the walk so it reaches exactly
one expression.

The clearing is the part that does the work. `Box(1).get()` sits under a `return i32`, and the
receiver must inherit nothing from it: with no slot of its own, a bare template is not a type, and the
reference calls it undefined. Both remaining cases were the same fact from opposite sides —
`Box(1.0)` assigned to a `Box<f64>` is ordinary and `Box(1).get()` is not, and the only difference is
the slot.

Carried on the checker's state rather than threaded through `checkExpr`, which forty call sites would
otherwise have to pass along and forty chances to forget. The cost is that every context with a slot
has to set it, and a context that forgets *false-alarms* rather than going quiet — which is the wrong
direction, so each one was found by a guard rather than by reasoning: a nullable slot
(`MapEntry<K, V>?` takes a `MapEntry<K, V>` — the target's nullability is not part of the question)
by the repo, and an array element by the test written immediately after.

### Rung 3 is done against every oracle it has

**Spec 83 of 83. Reference 124 of 124.** Sweep 10,013 programs: 885 accepted with no false alarms,
9,126 rejected with no contradictions. The repository is silent.

The last case was the other half of inference, and the opposite source: a construction reads the
**slot** it goes into, a call reads the **arguments** it is handed. A generic function's `Box<T>`
matched against an actual `Box<f64>` binds `T` to `f64`, and the return type follows.

That matching is string against string, which is only possible because **a type here is its canonical
name** — the written form and the actual form are the same kind of thing, so unification is one
function rather than a second representation of types. That decision was made in the first slice of
this rung and is what made the last rule cheap.

Anything that does not line up binds nothing, leaving the parameter open and the return unknown. That
silent direction is why this could be turned on at all: these signatures had been recorded as *blank*
for several slots, precisely because nothing could bind them.

**What "done" means here, and what it does not.** It means: on every program in three corpora — one
sampled from the spec, one the reference's own tests, one generated over the cross product of type
against context — this checker reports a subset of the reference's diagnostics, at its exact
positions, and never invents one. It does **not** mean the checker is complete: ~210 distinct message
texts exist across 3,190 reference lines and this implements a fraction of them, and the sweep's own
recall is 99% rather than 100%. It means the oracles that exist have nothing further to say, and the
next move is a sharper oracle or rung 4.

### Generic enums, and the comma that made two type parameters fail

`Option<T>` is a generic **enum**, and `std`'s `Vec.get` returns one — which is why compiling `Vec`
moved no whole files last slot. Instances of an enum template are now laid out exactly as a plain
enum is, a tag and a slot per payload, with their variants registered under the instance's own name:
`Some` in `Option<i32>` and `Some` in `Option<string>` are two variants with one name, so every place
an arm's text becomes a variant now passes the enum it is matching on.

`Option.Some(3)` is written on the **template**, like `Vec.create()`, so which instance it builds
comes from the slot — and a payload-less `Option.None` reaches the walk through a different node than
`Option.Some(3)` does, so both had to be given the slot separately.

**Then the bug that had been waiting two slots.** Two type parameters failed while one worked, and
the reduction never explained why. It is the *signature strings*: a function's type is spelled
`fn[bool(Result<i32,string>)]`, the scanners that read those count `[` and `(` as nesting — and not
`<`. So the comma **inside** the instantiation reads as a parameter separator, the function declares
one parameter while its type says two, and wasm reports it as a `struct.get` on a number in a method
several functions away.

```
Compiling function #90 failed: struct.get[0] expected type (ref null 13), found local.get of type i32
```

Three characters in three scanners. It is the same lesson as the heap type and the `else` arm: **an
encoding is a parser, and a parser that does not nest is wrong on the first input that nests.**

| | |
|---|---|
| corpus | 248 whole, **0 invalid** |
| what stops it now | `a generic function` (31), `an import from a capability` (35) |
| sweep | 3,817 programs, 3,418 compared, 0 mismatched — 88 of them generic |

The whole-file count is unmoved again, and again the reason is the next layer: `mapOption` is a
generic **function**, `T max<T>(T a, T b)`, whose instantiation comes from its *arguments* rather
than from a slot. That is inference, which is a different thing from substitution, and it is what
these 31 files are waiting for.

### Monomorphisation, second attempt: the ordering was the bug

The last attempt compiled the corpus into 57 invalid modules and was reverted. The cause was in the
notes it left rather than in the design: **instance methods were registered before the string helpers
and emitted after them**, so every function index from the first helper onwards was wrong. Every
hand-written case passed because none of them used a string, and a module with no strings has no
helpers to be out of order with.

A template is now compiled once per instantiation. `Vec<T>` is not a type and `Vec<i32>` is: the
arguments are substituted throughout, the substitution lives in the environment because
`typeOfTyName` already takes one, and registration is a fixed point because a field can name an
instantiation nothing else mentions. `Vec.create()` — the language's own spelling — resolves through
the **slot the answer goes into**, which is why only the walk's slot-aware path can approve it.

**And a guard that would have caught the first attempt in a second.** The type section is written
before the code that names types, so if emitting a body registers one more — an array, a struct, a
signature — every index after it is a lie, and the module says *"no signature at index 353 (353
types)"*. That is now checked directly: if the count moved, the module is declined by name rather
than emitted. It is the third time this rung has been bitten by a table that grew after it was
written, and the first time it is asked about rather than reasoned about.

| | |
|---|---|
| corpus | 248 whole, **0 invalid** |
| what stopped `Vec` | *was* `unresolved name Vec`; now the layer behind it |
| sweep | 3,773 programs, 3,374 compared, 0 mismatched — 44 of them templates |

The whole-file count did not move, and the reason is worth stating: `std`'s `Vec.get` returns an
`Option<T>`, and `Option<T>` is a generic **enum**. So the corpus's blockers are now `a generic enum`
(22) and `no method Option<i32>.isNone` (10) where they were `unresolved name Vec` (27). The
machinery is the same one; what it needs is variant lookup scoped by the instance, since `Some` in
`Option<i32>` and `Some` in `Option<string>` are two variants with one name.

### Monomorphisation: what an attempt established, and where it stops

Generics are 51 of the 89 files left, so a slot went at them. **The result is not in the tree** — the
emitter is unchanged — because what it produced compiles the corpus into 57 invalid modules, and a
compiler that emits wrong code is worth less than one that declines. What the attempt did establish
is worth the next slot's time, so it is written down here rather than rediscovered.

**The design works.** `Vec<T>` is a template and `Vec<i32>` a type, so a template is compiled once
per instantiation with the arguments substituted throughout. The substitution belongs in the
environment, because `typeOfTyName` already takes it and every place a type can be named goes
through there — no parameter has to be threaded anywhere. Registration is a fixed point, since a
field can name an instantiation nothing else mentions. On simple shapes it works: seven of eight
hand-written cases agreed with the reference, including `Box<Box<i32>>`, a box of an array, a struct
field of instance type, and an instance passed through a function.

Three things it turned up, each of which the next attempt should start from:

- **The call spelling is `Vec.create()`, not `Vec<i32>.create()`.** The latter parses as three
  comparisons — `Vec < i32 > .create()` — in *both* compilers, which is the language's own rule
  (`spec/spec/generics.md` writes `Vec<i32> w = Vec.create();`). So a static on a template takes its
  instantiation **from the slot the answer goes into**, which means the walk has to ask about that
  call where it has a `want` in hand, and `typeOfE` cannot answer it at all.
- **Two type parameters break it and one does not.** `P2<A, B>` emits a call whose argument count
  does not match the function it calls, with a one-argument method — so it is the *substitution*,
  not the arity, and it reproduces in four lines.
- **Single-parameter templates still leave 57 invalid modules across the corpus**, so the shapes that
  matter there — `Vec<Vec<i32>>`, a generic enum (`Option<T>`), a method calling another method of
  the same instance — go beyond what the hand-written cases reached. The corpus invariant is what
  said so, on a run where every hand-written case passed.

The honest state is the one in the tree: `Vec` and `Map` are declined by name, and the 51 files wait.

### Stage 2 equals stage 3 — wacc reproduces itself

The whole of rung 5, in one number: **wacc compiled by wacc compiles wacc to the same 140,590 bytes,
checksum 1072049381.**

Stage A is `wacc` built by the reference. Stage B is `wacc` built by stage A. Stage C is what stage B
produces when it is handed `wacc`'s own nine sources. B and C are byte-identical, which is what a
bootstrap means and what nothing short of running it can show.

The boundary problem solved itself once it was looked at from the other side. `emitFiles(string[],
string[], string)` cannot be called from JavaScript on a module emitted here by hand — but the driver
is *wac*, and wac can build a `string[]`. So every source in the entry's import closure is embedded
in a generated driver as chunked literals, and the driver hands them to `emitFiles` from **inside**
the module. 532 KiB of generated source, which the reference compiles in a second and this emitter in
a fifth of one.

Two canaries and a third opinion, because a bootstrap test that compares nothing is the easiest test
in the world to write:

- Stage A must **decline nothing** — two eight-byte headers agree about nothing at all. (This fired
  immediately: the first run carried only `packages/wacc/src/*.wac` and reported 41 characters of
  reason, which is exactly *"an import of a file that was not supplied"*. One of wacc's sources
  reaches into `bytes/src/buf.wac`, so the closure is nine files and not eight.)
- Stage A's module must be over 100,000 bytes, so "it emitted something" is not "it emitted a header".
- And stage B's bytes must equal what the **harness** gets from `emitFiles` directly — the number
  every other test in this package has been measuring all along.

The ladder is climbed. What remains is not the ladder, and it is mostly **one thing**: making the
decline name the slot — *"a null in a `Map` slot"* rather than "a null in a slot that is not a
reference" — showed that the eight `null` files are `Map<K,V>` files. Counted honestly, generics is
51 of the 89 that are left:

| what stops the remaining 89 | files |
|---|---|
| generics — `Vec<T>`, `Map<K,V>`, `Pending<T>` | **51** |
| a capability import, which needs a host to import *from* | 22 |
| a scattering of single files | 16 |

So the next step is monomorphisation, and the shape it wants is already visible from here: a
`Named` type with type arguments spells an **instantiation** (`Vec<i32>`), which registers a struct
whose fields are the generic's with a substitution applied; the substitution lives in the
environment, since `typeOfTyName` already takes it; and registering one can discover another, so it
settles by iteration exactly as emittability does. The emission loops then walk (generic, instance)
pairs where they now walk declarations.

Three oracles will be watching it, one of which is the compiler itself.

### The fixed point, and an `else` that ran first

Reading is half a compiler. The last slot showed the emitted `wacc` can lex, parse, print and check
the same as the reference-built one; this asks the other half — does it **emit** the same bytes?

The shape is the same trick: a generated driver embeds a source file as chunked string literals
(chunked because a literal is one `array.new_fixed` and an engine caps its element count, while
concatenation does not), calls `emit` on it, and returns a checksum of every byte. Stage A is `wacc`
built by the reference; stage B is `wacc` built by stage A. Nothing goes to disk — both compilers
take a file map, so the driver exists only inside the test.

The subject is `wacc`'s **own source**, because a toy program exercises a toy's worth of the emitter:

| source | bytes in | module out | stage A vs stage B |
|---|---|---|---|
| `kinds.wac` | 6,162 | 1,555 | identical |
| `ast.wac` | 11,181 | 770 | identical |
| `lex.wac` | 21,105 | 2,689 | identical |
| `print.wac` | 21,694 | 1,535 | identical |
| `check.wac` | 161,610 | 11,798 | identical |

**It did not start that way.** Stage B declined *every call in the language* with "untyped call", and
the reduction ran from a 11 KB file down to four lines:

```wac
enum K { P(i32 t), Q }
export K mk(i32 tok) { return K.P(tok); }
```

A payload-less variant was fine; one with a payload was not. The difference is that a construction
with arguments is a `Call`, and `typeOfE`'s arm for one is a `match` whose **`else` is written
first** — and this emitter emitted an arm's body *where the arm stood*. The default ran
unconditionally, no `case` was ever reached, and every call came back untyped.

An `else` arm is the default wherever it is written. Both match forms now emit the cases in order
and the default in the innermost `else`, which for the expression form is also where the value has
to go.

The generated sweep had 3,729 programs and every one of them put `else` last, because that is where
a generator puts it and where a person writes it. **A compiler compiling itself writes the code
nobody would think to generate** — this is the second bug in two slots that only rung 5 could find,
after `this.pos++` and the character literals.

### Rung 5: wacc, compiled by wacc, answering what wacc answers

The last rung. `wacc` emits a whole module for all eight of its own sources, and that module — its
lexer, its parser, its printer, its type checker, as emitted by itself — gives the **same answers**
as the one the reference builds.

Getting there took one more slot-aware `null`: `cond is null ? null : cond` asks nothing of its
context, because a ternary's type is what the non-null branch has, and the walk had been asking each
branch on its own. That is the emitter's own `emitLoop` call, so the emitter was declining itself.

**Then the interesting part.** The oracle for this rung cannot be "does it compile" — it is *run what
both compilers emit and compare*, as every rung below. The surface makes that awkward, since
`dump(u8[]) -> string` traffics in references and a reference cannot cross the JavaScript boundary
without bindgen's glue. So the crossing moved inside: `test/wac/selfdrive.wac` calls `wacc` on a
program written into it and returns an `i32`. Eight answers, smallest first — the bytes of a literal,
the length of a concatenation, the token count, the declaration count, a checksum of the printed AST,
the diagnostics of a good program and of a bad one.

It found two things in its first minutes, and **neither was findable any other way**:

- **`this.pos++` emitted nothing.** The increment statement had an arm for a local and none for a
  field, so `lex.wac`'s cursor never advanced. The module validated. It ran for ever — and the arm's
  own comment describes that exact failure, for locals, from four slots ago.
- **Every character literal compiled to 0.** `' '` reaches the emitter as its own text, quotes and
  all, and the integer reader took digits out of it. So `isSpace(c)` asked whether the byte was NUL.
  This is the third time a literal spelling nobody generated has been silently wrong here — after
  `0xff` and `1_000` — and the sweep now has all twelve spellings.

The corpus and the sweep had 337 files and 3,600 programs between them and neither had incremented a
field or written a character literal. **A compiler compiling itself is a test nobody has to think
of.**

| | |
|---|---|
| wacc's own sources whole | **8 of 8** |
| rung 5 answers agreeing | **8 of 8** |
| our module | 141,355 bytes against the reference's 161,047 |
| corpus | **248 of 337 whole, 0 invalid** |

One of the two bugs is in `wac` rather than here, filed as its issue **0082**: `++` on an `i64` field
or element emits an `i32` `1`, and the module does not validate. Two compilers, one blind spot, and
neither had a test with an `i64` field in it.

### `slice`, `indexOf`, and a branch that counted outward

Two more string methods, and they are the two the **linker** uses — so this compiler could not
compile the part of itself that decides which files a module is made of. `slice` clamps rather than
trapping, which is its whole specification and why four `select`s say it in eight instructions;
`indexOf` is the naive search, whose answers are the easy ones to be sure of.

`indexOf` also hung, in a way worth writing down. A branch counts labels **outward from where it
stands**: inside the inner loop, 0 is that loop, 1 the block around it, 2 the *outer* loop. Leaving
the inner comparison on a mismatch is `br 1`; I wrote `br 2`, which restarts the search at the same
start position without advancing it. The module validates. It just never finishes — and it took the
probe's four-hundred-second timeout rather than an error to say so, which is the same failure mode
the `i++` bug had two rungs ago.

`selfEmit.test.ts` exists now, and reports the rung-5 number rather than leaving it to be remembered:
**6 of wacc's 8 sources compile whole**, with `api.wac` and `emit.wac` stopping at a `null` this
emitter still cannot place. It asserts the corpus invariant on those eight files and a floor on the
count, so a slot that adds a feature cannot quietly lose one.

### Six of wacc's own eight files

A question worth asking directly, since rung 5 is the ladder's last: **how much of `wacc` can `wacc`
compile?** The answer turned out to be five of its eight files already, blocked by two things and not
by a hundred.

`ExprKind.Is(e, null, null, negated)` — the walk approved a `null` only where it could name the slot,
and a **variant's payload** was not among the places it looked, though the slot is right there in the
variant table. `parse.wac` is eight functions of nothing else, and it compiles whole now.

`string.fromCodepoint` is the other: a UTF-8 encoder, and the only way to reach a character that is
not already written down somewhere. It is a synthesized helper like the rest — four ranges, and a
**trap** for a value that is not a scalar, which is what the language says rather than the
replacement character a forgiving encoder would substitute. `emit.wac` uses it, which is how it
turned up: this compiler could not compile the function it uses to name its own scope keys.

| | before | after |
|---|---|---|
| whole files | 244 | **245** |
| wacc's own | 4 of 8 | **6 of 8** |

The other two are `api.wac` and `emit.wac`, waiting on `string.slice` and `string.indexOf` — which
the linker written two slots ago uses. That is the whole distance left to a compiler that can read
itself.

*(The commit for this section says "7 of 8" and the count was 6: `api.wac` and `emit.wac` were both
blocked, and I read a list of eight lines as though the two blocked ones were one. `selfEmit.test.ts`
prints the number now, which is the point of having it print rather than being remembered.)*

### A block is a scope — 230 to 244

`two types for the local k` was a decline with a good reason: wasm has one flat frame per function
and the language has block scopes, so `for (i32 k …)` in one block and `i64 k = …` in another are two
locals with one name, and a name-to-slot table cannot hold both. Searching from the end gave the
*later* one to the earlier block — an `i32.const` into an `i64` slot — so the function was declined.

The table was the problem. Locals are no longer collected by a pre-pass at all: a `var` **claims its
slot where it is written**, and the block retires its names when it ends — by renaming rather than
dropping, since the slot still has to be declared in the function's header. Two `k`s are then two
slots, `localAt` searches backwards so the inner one shadows, and neither block can see the other's.

This is the mechanism the enum arms already used for their bindings, which is the argument for it:
one way of introducing a name, used by every construct that introduces one.

The walk does the same thing, and has to. It is the pass that decides whether a name is a local, and
if it decided that differently from the emitter it would approve a body the emitter cannot resolve.
Both now push at the `var` and pop at the end of the block.

| | before | after |
|---|---|---|
| whole files | 230 | **244** |
| invalid | 0 | 0 |

**244 of 336.** What remains is generics (27), a capability import (22 — it needs a host to import
*from*), a method on a struct this emitter skipped (12), and a scattering of single files.

### A constant wasm cannot write down — 173 to 230

The largest decline left was *"a constant whose value is not a constant expression"*, 59 files, and
the message was accurate about wasm and wrong about what follows from it. wasm's idea of a constant
expression is narrow — literals, `ref.null`, `ref.func`, and the GC allocations — and wac's is not:

```wac
const string S = "ab" + "cd";       // a call
const u8[] T = mk(5);               // a call
const i32[] A = i32[](0 - 5, 3);    // arithmetic
```

None of those can be written in a global's initialiser. All of them can be **assigned** to one. So a
constant this emitter cannot express as a constant expression now gets a mutable global holding
null, and a synthesized **start function** — wasm's `start` section, which runs at instantiation —
fills them in declaration order. The value arrives a moment later and no observer can tell, which is
the whole of the trick.

Two things fell out of it that are worth naming:

- **The question changed from "is it a constant expression" to "can this emitter emit it at all"**,
  which is the question the rest of the emitter already answers. `assignGlobals` asks
  `unsupportedValueAt` now, and the answer can change once the functions an initialiser calls have
  settled — so the pair of passes runs twice.
- The start function is a function like any other: it needs its signature in the shared table, a
  slot in the element segment, and its own locals header, because an initialiser that needs a
  scratch local gets one.

| | before | after |
|---|---|---|
| whole files | 173 | **230** |
| invalid | 0 | 0 |
| blocked by a constant | 59 | 0 |

**230 of 336 files, and two thirds of the corpus now compiles whole.** What is left is four things
and not a long tail: generics (27), a capability import (22, which needs a host to import *from*),
block scoping (14), and a method on a struct this emitter skipped (12).

### An import says which name — 118 to 173

Two slots ago a name a file reached that two of its imports declared was declined, because "the
import list says which files, not which names came from which". That was wrong, and it was wrong in
the reading rather than in the data: `import { p } from "./a.wac"` says *exactly* which name comes
from which file, and the parser had the items all along.

Resolving through the named import — this file's own declaration, then **the import that names it**,
then a file it imports, then anyone — cleared 44 files at a stroke, and it is the language's own rule
instead of an approximation of it.

Then the eleven behind it: `import { decode as b64decode }`, where the caller writes a name **no file
declares**. The alias and the declared name travel together through the link, separated by a space no
identifier can contain — the same trick the synthesized helpers' names use.

| | before | after |
|---|---|---|
| whole files | 118 | **173** |
| invalid | 0 | 0 |
| blocked by a shared name | 43 | 0 |

What is left is mostly not about names any more: a constant whose initialiser is not a constant
expression (59), generics (26), a capability import (22, and it needs a host to import *from*), and
block scoping (14).

### Function references, and a type that is the right shape and the wrong type

The largest feature the emitter lacked: `ref.func` to obtain one, `call_ref` to invoke it, and a
`fn[R(A,B)]` type in between. All of it works now — a reference taken by name, passed as a parameter,
returned, stored in a struct field or an array, compared against null, and called through every one
of those.

**The interesting failure was type identity.** Each function used to get a type of its own in the
type section — "one type per function, never deduplicated", which this README said was fine because
the reference pools them and a canonical form makes that difference invisible. It is not fine here.
wasm compares two type indices *in one rec group* by position, not by shape, so:

```
local.set[0] expected type (ref null 12), found ref.func of type (ref 27)
```

Type 27 was that function's private copy of exactly the shape type 12 describes. A function and a
reference to it have to name **one** index, so every function's type is now its entry in the shared
signature table — the same table the `fn[...]` types the source writes go into. The five string
helpers share it too.

Three smaller things the feature needed:

- **A declarative element segment.** `ref.func` naming a function that no element segment mentions is
  *"undeclared function reference"* — a rule that exists so an engine knows which functions can
  escape. One segment listing them all.
- **`g(5)` is a `Construct`, not a `Call`.** The parser cannot tell a call to a function named `g`
  from a call through a local named `g`; only the scope can, and the local wins, as it does
  everywhere else here.
- **`null` in a signature slot.** The emitter asked *"is this an array, a string or a struct"* inline
  instead of asking `isRefType`, so it was one kind of reference short the moment a new one existed —
  and a `null` that emits nothing is an argument that never arrives.

The sweep has 94 cells for it, and every one exists in two versions — calling one function and then
another through the same reference — because **a `call_ref` that always reaches the same place is
indistinguishable from a direct call**. 3,494 programs, 3,139 compared, 0 mismatched.

The whole-file count did not move: the 34 files stop at the next thing now, which is mostly a name
more than one file declares (43) and a constant that is not a constant expression (37). What did move
is the last of the language's *type system* — after this, every type wac has is a type this emitter
can name.

### A string is not an array of bytes — 108 to 118

Two features, both reached by fixing the one above and reading what the corpus then said. That is the
loop this rung has settled into: the largest decline names a construct, the construct gets built, and
the count moves to whatever it was hiding.

**`f64.toBits` and its three siblings.** A static whose receiver is a *type* rather than a value, and
one reinterpret instruction each. Four instructions, 37 files.

**`s[i]`**, which is where the interesting part is. It looks like `a[i]` and is not: a string index
**decodes**, and the spec is precise about it — the lead byte says how many bytes the character is,
an index that lands in the middle of a sequence is `""` rather than half a character, and an index
past the end traps. So it is a synthesized helper like concatenation and equality, and its body is
four range tests on the lead byte followed by an `array.copy`. The bounds check is free: `array.get`
traps on its own, which is exactly the specified behaviour.

The sweep's cells for it are chosen by *encoding* rather than by content — one, two, three and four
byte characters, and every offset inside each — because a decoder that reads the lead byte and a
decoder that reads any byte agree on all of ASCII. `"a😀b"` indexed at 1 is `"😀"`, at 2 is `""`,
and both are in the sweep, along with the loop that indexes every byte and concatenates the pieces
back into the original.

While in there: the four string helpers wrote their own reference types with an unsigned LEB, the
same bug as the type section's and latent for the same reason — `i8[]` is type index 0 or 1 in every
module that has one.

| | before | after |
|---|---|---|
| whole files | 108 | **118** |
| invalid | 0 | 0 |
| sweep comparisons | 2,729 | **3,075**, 0 mismatched |

What is left, in order: a **call through a funcref** (34 files, and the largest single feature the
emitter still lacks), a constant whose initialiser is not a constant expression (29), a capability
import (21, and it needs a host to import *from*), and generics (19).

### `p.x += 5` was `p.x = 5`

The corpus's largest decline was *"a call to something unknown"* at 66 files, which named none of
them. Making it say *"a call to `ref`"*, *"a call to `b64decode`"* turned one category into eight
diagnoses in a minute — the lesson this package keeps relearning, and cheap every time.

What the second-largest one hid was worse. *"A compound assignment to a reference"* was declining
`s += "x"`, and lifting it revealed that compound assignment into a **field** or an **element** had
been emitting the wrong thing all along:

```wac
struct P { i32 x; }
export i32 f() { P p = P(1); p.x += 5; return p.x; }   // the reference says 6; this said 5
```

The `LField` and `LIndex` arms took the operator token and never looked at it: they emitted the
right-hand side and stored it, so `+=` was `=`. It **validated** — the field is an `i32` whichever
happens — and no hand-written differential case had ever compounded into anything but a local, which
is the same bias that let `0xff` compile to 0 for as long as it did. The generated sweep has the
cross product now: three lvalue forms × eight operators × six types, plus the string cases, and the
answers agree.

Both arms are read-apply-write now, with the base (and the index) spilled first so `a[i] += f()`
evaluates `a` and `i` once and in source order. Those spills ask for their slots **by name** rather
than by type: the plain scratch is keyed by type alone, which is right while the only thing spilling
is a cast, and `a[i] += (x as~ i32)` would otherwise have the cast and the index sharing one `i32`.

`s += x` is now the concatenation helper, which is the same call the expression form makes, so the
two spellings cannot drift.

The corpus count did not move — the 35 files that were declined for this now stop at the *next*
thing, `f64.toBits` — and that is worth saying plainly, because the fix was worth more than the
number it did not change.

### Names scoped to their file, and the two bugs only a big module could have — 93 to 108

Linking put every file's declarations in one pool, and a pool cannot hold two meanings for one name:
`sha256.wac` and `sha512.wac` both declare a `K`, three files declare an `itoa64`, three declare a
`pemBlock` **with three different signatures**. The last slot declined those modules whole. Now a
name is scoped to the file that declared it.

The mechanism is a line number. The blob is the files end to end, so a line names a file exactly, and
every token carries its line — so a declaration registers under a key (`K` for the first, `K@3` for
the next), and a use resolves through `keyAt`: its own file, then a file it imports, then anyone.

The **third step is where the bugs were**, and both took the same form — a guess that looked like an
answer:

- *Then anyone* is wrong when more than one file has the name. Two structs that used to be one type
  are now two, and a third file that mentions neither gets `expected (ref null 1), got (ref null 7)`.
- *Then a file it imports* is wrong the same way when **two** of its imports declare the name. The
  import list says which files, not which names came from which. `routerdesc.wac` reached a
  `pemBlock` belonging to another file and pushed a literal where a reference belonged.

Both are now counted rather than picked: more than one candidate and the module is declined —
`a name more than one file declares`. What a *single* candidate buys is real: two files each with
their own `h`, each call reaching its own, is a case in `linkEmit.test.ts` now rather than a decline.

**And two bugs that had been there all along, which only a module this size could show.** The corpus
went to 15 invalid when the clash declines stopped hiding these files, and the invariant — *a
function the walk approves produces a module that validates* — is what turned both up:

- **A heap type is signed.** A reference type is `0x63` followed by an *s33*, and this emitter wrote
  a `u32`. The two encodings are identical for the first sixty-four type indices and differ for every
  one after, because 64 sets the sign bit of a one-byte LEB: type index 65 came back as heap type
  **-63**. No single corpus file has sixty-four types. Linked, most of them do.
- **A table that fills up renumbers everything after it.** Six places stopped writing and kept
  counting — fields, parameters, variants, constants — which is a `struct.new` with the wrong arity
  and a byte stream that desynchronises into a nonsense heap type several functions later. Each now
  says so, and the module is declined by name rather than emitted with the indices off by one.

| | before | after |
|---|---|---|
| whole files | 93 | **108** |
| invalid modules | 0 | 0 |
| blocked by a shared name | 109 | 0 |

The three 43-argument `Env` constructions are one `Env.create()` now. They were three identical
lists, which is how the last two fields cost three edits each and one of them was caught by a type
error rather than by reading.

### Null, and a question the walk could not ask — 70 to 93

`T?` is `T` here. Every reference this emitter writes is the nullable `0x63`, a decision forced two
slots ago by `array.new_default`, so a type that admits null and one that does not are already the
same wasm type and the difference is the checker's to keep. That made the feature small: `null` is
`ref.null` at the wanted type, `is null` is `ref.is_null`, `x is y` between two references is
`ref.eq`, and `x!` is `ref.as_non_null` — which **traps**, and emitting nothing instead would have
been the same value with the same type and a different answer.

The interesting part was not the emission. `null` is *context-typed* — it has no type of its own and
takes the slot's, exactly as `0` does — and the emittability walk asks its questions with no slot in
hand. Approving it everywhere and emitting it only where the wanted type turned out to be a
reference produced nine corpus modules that said:

```
Compiling function #8 failed: not enough arguments on the stack for struct.new (need 4, got 3)
```

The argument had emitted **nothing at all**. This is the failure the corpus invariant exists for — *a
function the walk approves produces a module that validates* — and it is the fifth consecutive slot
in which that assertion has caught something before a human did.

The fix is a second question rather than a better guess: `unsupportedValueAt` takes the slot's type,
and the sites that know one — an initialiser, a construction argument, a call argument, a `return` —
ask through it. Everywhere else `null` stays declined, which is conservative in the direction that
matters. `return null;` needed the walk to know the function's return type, which it had never been
told: `canEmit` had the parameters in scope and not the return, so it could answer questions about
`x` and not about what `x` was being returned *into*.

| | before | after |
|---|---|---|
| whole files | 70 | **93** |
| invalid modules | 0 | 0 |
| blocked by `null` | 24 | 0 |

The sweep grew a nullable family — 30 cells, each generated in both states, because a null test that
is only ever asked of a null is half a test — and reports 3,080 programs, 2,729 compared, 0
mismatched, 0 declined. It also grew a guard: a program returning a reference hands back a GC object,
`String()` on one throws, and one such cell turned a sweep of 3,080 programs into a single TypeError
naming none of them.

### Imports: linking by concatenation — 32 of 336 to 70

297 of the 336 corpus files were declined for "an import", which made it the largest single thing
standing between this emitter and the rung above: `wacc` is eight files, and a compiler that cannot
compile a program with imports cannot compile itself.

**Linking is a concatenation here**, and the reason it can be is how this emitter already worked:
every declaration in a module is collected before any function is emitted, so a name declared in
another file is reached exactly as one declared further down the same file is. The entry goes first
and the closure of its imports follows, resolved by following each file's own import paths — which
is also what makes the export rule right: the module's exports are the *entry's*, and an imported
file's `export` marks a name as reachable across files rather than as a wasm export.

What that gives up is **per-file scope**: a file here can see a name it never imported. That is safe
in one direction only — this emitter accepts more than the language does, and the checker one rung
down is what says no — and it could not make a program mean something *different*. The failure it
does have is sharper, and it is now the corpus's largest category: two files that declare one name.
`sha256.wac` and `sha512.wac` both declare a module-level `K`; three files declare `itoa64`. A pool
cannot hold two meanings for a name, and picking whichever registered first is how a call reaches the
wrong function, so the whole module is declined by name — `two files declaring K` — rather than half
of it emitted.

| | before | after |
|---|---|---|
| whole files | 31 | **70** |
| invalid modules | 0 | 0 |
| blocked by an import | 297 | 0 |
| blocked by a name two files share | — | 109 |

The nine cross-file shapes in `linkEmit.test.ts` all agreed on the first run — a function, a struct, a
method, a constant, a string, an enum matched in a file that never imported its type, a diamond, a
three-deep chain, and a `../` path — which says the hard part was never the linking. Both ways it can
fail are asserted by name too: a file the caller did not supply and a clash both produce a module
that does nothing, and "does nothing" is the one answer this rung must never report quietly.

The next step is the obvious one: names scoped to their file, so `K` in two files is two names.

### Enums, in one struct rather than a hierarchy

The language's enums compile, as the spec says, to "the struct hierarchy you would otherwise write by
hand: a base struct for the enum, a subtype per variant, and a tag". This emitter does not write that
hierarchy, and the freedom to not write it is the point of rung 4's oracle: **what is compared is
answers, not bytes.** An enum here is *one* wasm struct — a tag in slot 0, then a slot per payload
field of every variant, laid end to end. A variant is then the same wasm type as its enum, which
makes three problems disappear at once:

| the hierarchy would need | the flat struct |
|---|---|
| `sub` declarations and a subtyping order in the rec group | one struct, declared like any other |
| a cast at every narrowing | none — the value already has the type |
| `Shape s = Shape.Point;` to be a widening | an assignment between two names for one type |

The cost is space: a `Rect` carries the slot a `Circle` would have used. That is the trade a language
with no unions makes anyway, and nothing here is measuring bytes yet.

What is implemented is the whole of the feature as `spec/spec/enums.md` describes it, minus generics:
construction of payload-less and payload-carrying variants, `match` as a statement and as an
expression, positional bindings and `_`, the `else` arm, narrowing, and `is`. Two decisions did the
work.

**Narrowing is a binding, not a retyping** — which the spec says, and which is also the only version
that is cheap: the arm adds a local with the subject's name at the *variant's* type, `localAt`
searches backwards so it shadows, and it is retired at the end of the arm by renaming the entry
rather than dropping it, since the wasm slot it declared still has to be described. The same
mechanism gives the payload bindings their scope, and the same names are pushed for the
*emittability walk*, so the walk and the emitter answer questions about an arm with identical scopes
in view.

**An arm's `break` leaves the enclosing loop**, unlike `switch`'s. That falls out of emitting the
chain as nested `if`/`else` rather than a block per arm: there is no label to leave, so the only
branch target is the loop, which is what the language says it should be.

Three things this slot got wrong, all of them the same mistake in different clothes — **a walk that
did not know about the new node**:

- `emitBlocked` reports the *first* thing that stops a module, so a new `EnumDecl` arm answering
  `""` for "nothing wrong here" returned out of the whole scan before the functions were asked. The
  report said the module was whole; the module had no functions in it. The spec warns about exactly
  this — five walks with no `match` case — one section above where I was reading.
- The `Var` guard declines an assignment between two reference types that differ, because struct
  inheritance has no representation here. `Shape s = Shape.Point;` is exactly that shape and exactly
  not that problem; canonicalising both sides through the variant table before comparing is the
  difference between an enum this emitter can do and one that declines on its first line.
- `typeOfE` on a match *expression* read each arm's value with the arm's bindings out of scope, so
  `case B(x): x` was untyped and the honest "untyped match" guard declined all six of the generated
  cells. The type walk needed the same scope push the other two walks had already been given.

The sweep is where all three showed up: **3,050 programs, 2,699 compared, 0 mismatched, 0 declined**
— 112 of them enum cells generated over the payload-type axis, since a payload slot is a struct field
and every field type has its own instruction. The corpus went from two files declined for "an enum"
to none, 31 whole to 32, and the one enum still refused is `Option<T>`, which is a generic and a
different rung's problem.

### The sweep the last slot argued for, and eleven cast bugs

Last slot ended on an argument rather than a number: a hand-written corpus tests what its author
thought to write down, every literal in all 222 differential calls was plain decimal, and that is how
`0xff` compiled to **0** for as long as the emitter existed. The answer one rung down was a generated
sweep, so rung 4 now has one — `test/generateEmit.ts` builds 2,938 programs over the cross product of
type against operation against literal shape, and `test/emitSweep.test.ts` runs what both compilers
emit and asserts every answer agrees.

The first run compared 2,587 of them and **31 disagreed, every one a cast.** Casts were not untested;
they were tested with values that fit, which is exactly the bias the sweep exists to remove. Underneath
were rules I had assumed rather than measured, and the reference disagreed with all of them:

| what I emitted | what the reference does |
|---|---|
| all four casts saturate | **`as@` wraps** — it is the only one that does |
| float→int uses `i32.trunc_f64_s` | it **saturates**, via the `0xfc` prefix — no cast in wac traps |
| `as~` and `as@` both truncate a float | **`as~` rounds**, `as@` truncates |
| a same-width sign change clamps both ends | **one clamp**, and which end depends on the direction |
| every source is clamped at the target's minimum | an **unsigned source** can never be below it |
| widening is a widening | widening is **still a sign change**: `(i32) -1 as~ u64` is 0 |

The middle two rows cost a round. Fixing the first three took 31 mismatches to 9, and the next three
"fixes" took 9 to **20** — worse, and worse in a way that named itself: `0 as! u32` returned `-1`. The
same-width branch was comparing against `upperBound("u32")` = 4294967295, written as an `i32` constant
of -1 and compared signed, so every value was above its "maximum". A bound the source's width cannot
represent is not a bound to compare against; it is a comparison that can never be false.

2,587 compared, **0 mismatched**, and the sweep carries the canary the rung-3 one does — a harness that
compares nothing reports that everything agrees, so a run with fewer than a thousand comparisons is a
failure rather than a pass.

### One method, and a literal that was quietly wrong — 26 of 39 to 31

Naming the decline finished the "method" category in one step: all six files wanted **`copyFrom`**, and
`copyFrom` is not a helper at all but `array.copy`, whose operands go in a different order than the
language writes them — wasm wants destination, destination offset, source, source offset, length, so
the arguments are emitted 2, 0, 1, 3. Measured, as the routine now goes, and the whole category went
with it.

**Then the thing worth the slot.** Chasing why two constants were declined turned up a literal reader
that took decimal digits and stopped at anything else: `0xff` compiled to **0**, and `1_000` to **1**.
Not a decline — a *wrong answer*, which is the failure this rung exists to catch, and it had been
sitting there since the first slice.

Nothing caught it because **every literal in every differential case was plain decimal**. 172 programs
and 222 calls, and not one of them wrote a number the way half this repository writes numbers. A
corpus of hand-written cases tests what its author thought to write down, which is the same bias the
spec corpus has and the reason the generated sweep exists one rung up. There is no sweep here yet, and
this is the argument for one.

The corpus number did not move — the two constants that led me there are declined for a different
reason, an unary minus in a constant expression — which is worth saying plainly: the fix was worth
more than the number it did not change.

### Four functions nobody wrote — 22 of 39 to 26

Concatenation, equality, and the two byte conversions, all synthesized on last slot's mechanism. The
bodies turned out to be short because **`array.copy` does in one instruction what a loop would do in
fifty**: it pops destination, destination offset, source, source offset and length, and takes the two
array *types* as immediates. Concatenation is a length, an allocation and two copies.

`s.toBytes()` is a copy and not the no-op it looks like, which the reference's bytes said last slot
and this confirms: `string` and `u8[]` hold the same bytes in the same storage type and are
**different types**, so the conversion has to make a new array. One function serves both directions —
the only difference is which type index goes where.

The corpus moved **22 → 26**, and the "method" category halved. What is left of it is `copyFrom` and a
handful of others whose signatures I have not measured; the difference between those and these four is
only that nobody has read the reference's bytes for them yet.

Worth noting what did *not* need doing. `!=` is the equality helper with an `i32.eqz` after it. Three
strings joined is two calls, because the result of one is an ordinary operand to the next. Neither
needed a rule: they fell out of treating a helper as a function like any other, which is what made the
mechanism worth building rather than special-casing `==` where it stood.

### The emitter writes a function nobody wrote

`a == b` on two strings compares **contents**, and wasm has no instruction for that. The reference
generates a helper — its modules contain a `__str_cmp` nobody wrote — and now so does this one:
`str_eq(string, string) -> bool`, a length check and a loop over bytes, emitted instruction by
instruction and registered under a name with a space in it, which no wac identifier can contain.

The mechanism is the point rather than the helper. A synthesized function is **a function like any
other**: registered before emittability settles, so a call to it is an ordinary call and the
renumbering counts it. `!=` is the same call with an `i32.eqz` after it — one instruction rather than
a second helper.

It also corrected an assumption I had been about to build on. `s.toBytes()` looked like it should be a
no-op, because `string` and `u8[]` have the same storage type — and the reference's bytes say
`call 8`. They are *distinct* array types with the same shape, so the conversion copies. Measuring
cost three minutes; the feature built on the guess would have cost the slot.

Two failures on the way, both about **when a type gets registered**:

- `T[]()` names no size and means none, and `array.new_default` still wants to be told the length is
  zero.
- A module whose strings arrive only as **parameters** has no string literal anywhere, so the token
  scan never fired, `i8[]` was never registered, the helper was not emitted — and `a == b` compiled
  to *nothing at all*. A type is named by its uses as much as by its literals.

### A string is an array, and representation is not identity

A string turned out to be much less than I had budgeted for. The reference's own bytes say it: the
type section declares an array of `i8`, a literal is `array.new_fixed` over the characters, and
`s.len()` is `array.len` — the instruction this emitter already had. What looked like a subsystem with
a memory and a dozen host imports is, for reading, an array.

So literals, `.len()`, strings through calls, string fields, string constants in globals and arrays of
strings all arrived at once, including multi-byte UTF-8 — `"é".len()` is 2, because the length is
bytes and that is *why* it is an `i8[]`.

**Then the interesting mistake.** The first version normalised `string` to `i8[]` outright, in
`typeOfTyName`, so every array rule would apply for free. It does — and it also erases a distinction
the language has: `s[i]` on a string is a one-character **string**, where `b[i]` on a `u8[]` is an
`i32`. Emitting `array.get_s` for a string index returns the wrong kind of thing entirely.

**The representation is shared; the type is not.** `string` stays `string` throughout the emitter and
becomes `i8[]` only at `repType`, where a value type is written. That is one line of difference and
the whole of the correctness.

The same slip, from the other side: with strings typed as arrays, `a + b` on two of them emitted
`i32.add` over two references — **24 corpus files** at once. Concatenation and comparison are
generated helper *functions* in the reference, not instructions, so no binary operator applies to a
reference at all, and neither does a compound assignment to one. Both are now declined by name.

The invariant caught every one of these within a minute of writing the feature. It has now paid for
itself three slots running, which is worth more than the features it guards.

### Ternaries, statics, and one flat frame — 16 of 39 to 22

Three features and one limitation, all of them found by making the decline messages **specific**. The
walk had been saying "an expression whose type this slice cannot work out" five times; saying
*"untyped ternary"* instead named the bug in one word. A category is not a diagnosis, and the cost of
the vaguer message was a slot.

- **A ternary of two literals takes the slot's type**, exactly as a single literal does. `c ? 1 : 2`
  in an `i64` slot is two `i64` constants; the condition is never the value and is not part of the
  question.
- **A static call names its owner with a type rather than a value.** `Big.create(…)` and
  `b.create(…)` are the same syntax, and asking whether the receiver is an expression called three
  perfectly good struct names unresolved. The scope is consulted first, so a local of that name still
  wins — the same fork the checker makes.
- **`P()` with no arguments is `struct.new_default`.** Pushing nothing and calling `struct.new` asks
  for operands that were never there.

**And the limitation, which is real and now named.** wasm has one flat frame per function; the
language has block scopes. `for (i32 k = …)` in one block and `i64 k = …` in another are two locals
with one name, and a name-to-index lookup cannot tell them apart — the later one wins and an
`i32.const` goes into an `i64` slot.

The first guard declined *any* repeated name, which refused six corpus files and a test of this
emitter's own: two sequential `for (i32 i …)` loops are safe, because both slots are `i32` and
whichever the lookup returns is well-typed. **It is the type that cannot be shared, not the name.**
What remains uncaught is two same-typed locals whose live ranges overlap — a nested shadow, which is a
semantic error rather than a validation one and wants a scope stack this slice has not got.

The invariant caught all of this: asserting "approved implies valid" turned two new features into two
red tests within a minute of writing them, which is what it was for.

### Constants with identity get a global — 14 of 39, then 16

An array constant has identity: one array shared by every use is not the same program as one array per
use, so it cannot be inlined the way a scalar can. It gets a **global**, which is where the reference
puts one too.

The constraint that shapes it is that a global's initialiser must be a **constant expression** in
wasm's sense, which is far narrower than wac's: the four `const` instructions and — because this is a
GC module — `array.new_fixed`, `array.new_default`, `array.new` and `struct.new` over more of the
same. `3 * 4` is not one. That is exactly why scalars are inlined and arrays are not, and the two
halves of the rule fall out of the same fact rather than being a choice.

**The bug worth recording is that the reporter and the emitter ran different pipelines.** `emitBlocked`
answers "why was this file not emitted whole", and it did not call `assignGlobals` — so it reported on
globals that, in its own copy of the state, had never been assigned. Every constant looked like it had
failed the constant-expression test when it had never been asked. A diagnostic that does not run the
thing it describes will describe something else, confidently.

Then a second copy of the same lie: the message *"a constant with identity"* survived in a branch my
edit had missed, so the corpus kept reporting a decision that had been changed. Two places asserting
what a third one decides, which is the argument for having one.

Also: **a module-level constant names a type**, and the array-type pre-pass did not walk them. Third
time that pass has been found one declaration short — after struct fields and method signatures. The
rule is *every place a type can be named*, and the list keeps being longer than it looks.

### The number was measuring the harness: 10 of 39, not 10 of 336

"297 of 336 files blocked on an import" is not a fact about the emitter. **Only 39 corpus files
import nothing at all**, and a file that imports cannot be compiled alone by anyone — the reference
takes a file *map* and an entry, because compilation is whole-program. The other 297 are the harness
asking for something impossible, and reporting them as a shortfall made a measurement look like a gap.

So the honest denominator is 39, and the score was **10**. Module-level constants were the largest
category left, and are now **14**.

**A scalar constant is inlined at every use**, which is what the reference does and is simpler than it
sounds: a constant has no identity, so substituting its initialiser is exactly equivalent. It also
sidesteps a real constraint — a wasm global's initialiser must be a *constant expression*, and
`const i32 K = 3 * 4 + 1;` is not one. Inlined, the arithmetic lands in a function body where
arithmetic is ordinary.

**An array constant is a different matter and stays declined.** It *has* identity: one array shared by
every use is not the same program as one array per use, and inlining would silently make the second.
The reference gives those a global with an `array.new_fixed` initialiser, which is where this goes
next.

One more instance of the pattern this rung keeps hitting: `Expr[16]()` does not compile, because an
`Expr` has no default value — the rung 3 rule about non-defaultable types, met from inside the emitter
that now enforces it. The initialisers are stored nullably.

### The walk is honest now: 28 invalid to 0, and the invariant is a rule

**336 files: 10 whole, 326 partial, 0 invalid.** A function this emitter approves produces a module
that validates — asserted rather than reported, because it is finally true.

Getting there needed a way to ask *which* function failed: wasm says "compiling function #7" and #7 is
an index into a list only the emitter can see. `emitNames` returns them in order, and every diagnosis
after that took a minute instead of a guess. It should have been the first thing built.

Six causes, and the two structural ones are worth the space:

- **A type may only refer to one defined before it** — outside a **rec group**. An array whose element
  is a struct declared later refers forward, which wasm rejects from the type section itself with no
  function to name. The reference wraps every type in one rec group, and the reason is exactly this.
- **A non-null reference has no default value**, so an array of them cannot be made with
  `array.new_default` — which is how wac makes arrays constantly. References are `0x63`, nullable, not
  `0x64`. The reference's own locals said so and I had read past it twice.

And four ordinary ones, each a value of the wrong width or in the wrong place:

- A **ternary's block type was hardcoded `i32`**, so `cond ? x : y` on two `u64`s promised an `i32`.
- An array's **element type was written as a single byte**, so `u8[][]`'s element came out `i32`.
  Registering the outer array now registers the inner one first, transitively.
- **Compound assignment handled four operators out of eleven**, by raw token number. `result ^= x`
  emitted its operands and no operator, leaving a value on the stack.
- When **both operands of a binary are literals** there is no type to take from them and the slot is
  the only thing that knows. `0.0 / 0.0` went out as two `f64` constants and an `i32.div_s` — the two
  halves of one expression disagreeing because they asked different questions.

Two things are declined rather than guessed, which is the other half of an honest walk: a binary
mixing an integer and a float literal, where no context can settle both; and an assignment between two
different reference types, which is wac's struct inheritance and needs a notion of subtype this slice
has not got.

### Making the walk honest: 43 invalid to 28

The walk approves a function and the emitter then produces it; when the module does not validate, the
walk lied. Five of those lies, and every one is the same shape — **a value arriving at the wrong
width, because something did not know what type was wanted**:

- **A `return` had no idea what the function returns.** `return 1;` in an `i64` function emitted an
  `i32` constant. Seven files at once, and the fix is one field: the return type belongs to the
  function being emitted, and a `return` is the one statement that needs it.
- **If the emitter cannot say what an expression *is*, it cannot emit it.** So a position that
  consumes a value now demands a known type, and declines otherwise. Structure was never enough:
  every remaining broken module had a shape the walk approved and types it then guessed.
- **An operand is not always the instruction's type.** wac allows `wide >> narrow` and wasm's
  `i64.shr_s` wants both sides `i64`; an array index is an `i32` whatever the language allowed. The
  literal-steering `emitExprAt` cannot help — a *typed* expression ignores it and arrives as itself —
  so those positions now convert.
- **A value left by an expression statement has to go somewhere.** wasm's stack is not a suggestion,
  and *"expected 0 elements on the stack"* was six files saying so.

Two corrections on the way, both about **one empty string meaning two things**:

- `""` is *unknown* and `"void"` is *nothing*. Treating the second as a value dropped one that was
  never pushed — and the symptom was the error I had just fixed, arriving from the opposite direction.
- Arithmetic over literals has no type of its own either. `0 - 100000` is an `i32` subtraction in an
  `i32` slot and an `i64` one elsewhere, and calling it untyped declined a working function. A literal
  is polymorphic over a family; so is a tree of them.

**336 files: 9 whole, 299 partial, 28 invalid**, and the block list is unchanged in shape — 274
imports, then a long tail. The 28 are a handful of type-inference gaps left to chase, and they are now
a *list of specific instructions* rather than a fog.

### Rung 4 meets the repository, and a number appears

**336 corpus files: 7 emitted whole, 286 partial, 43 invalid.** The README named this oracle before
there was anything to run it on. This is the first half of it, and it is a *measurement* rather than a
gate — the numbers are printed, because a rung under construction that may never lose a point is a
rung nobody can restructure.

**The first run said 15 valid of 336, and the number was a lie.** Every walk in the emitter ends in
`else: { }`, which for an expression means emitting *nothing* where a value was expected. That is not
a gap, it is a corruption, and wasm reports it as *"not enough arguments on the stack"* — 199 of 308
broken modules, naming a stack depth rather than a construct, and telling me nothing about what was
missing.

So the emitter asks first. `unsupportedIn` walks a function and returns **the name of the first thing
it cannot do**; a function containing one is not emitted at all. The list of stack errors became a
list of language features, ordered by what they would buy:

    265×  an import
      7×  a method this slice has not got
      6×  a module-level const
      3×  a name that is not a local
      3×  string literal

Imports are two thirds of the corpus in one line, which is the answer to "what next" and was not
visible at all before.

**Then the real bug.** Skipping a function makes the emitted module a *subset*, and call sites were
still using the registration index — *"function index #3 is not declared"*. Those are two different
numbers, and conflating them is the kind of mistake that only appears once something is skipped.

Worse, it is not a renumbering problem alone: a call to a function that will not be emitted makes the
**caller** unemittable too, and removing that one can remove *its* callers. The dependency is not a
tree — mutual recursion means the honest answer is a **fixed point**: assume everything works and
remove until nothing changes. Assuming the opposite and adding would never admit two functions that
call each other, which is most of them.

That took the invalid count from **115 to 43**. The 43 that remain are type mismatches inside
functions the walk *approved* — `array.len` on something that is not an array, a `local.set` of the
wrong type — which means the emitter's own type inference is wrong there rather than absent. That is
the next thing, and it is a better problem to have: a wrong answer names itself, where a missing arm
did not.

### Rung 4 gains structs, and a method turns out to be a function

**98 programs, 140 calls, every answer agreeing.** Construction, field read and write, methods with a
receiver, nesting, structs through calls, and a struct holding an array.

**A method is a function whose first parameter is the receiver** — that is the whole of it. The
reference's own bytes say so: a method call on `p` is `local.get p; call 1`, and the callee's type is
`(ref $P) -> i32`. So methods and plain functions now share one emitter, differing in a single
argument, and `this` is a local like any other. The thing that looked like it needed a mechanism
needed a parameter.

The encodings, measured as before: a struct type is `5f <n> <type> <mut>…`, `struct.new` is
`fb 00 <t>` with the fields pushed in declaration order, `get` is `fb 02 <t> <field>` and `set` is
`fb 05`. Structs share the type index space with the arrays, taking the block after them, which is
possible only because both sets are complete before the section is written.

**Which is where the bug was.** A struct *field* of array type was not collected in the pre-pass, so
`writeValType` handed out an index while the section was being written — past the count already
emitted. The module then referred to a type that was not there, and wasm said *"invalid array index:
0"*, which names the consequence and not the cause. Every place a type can be *named* has to be
visited before the section is written, and a field is one of them: the pre-pass now walks struct
fields, method signatures and method bodies as well as functions.

One thing removed rather than left: `paramTypeAt` was briefly a stub returning `""`. It compiled and
every test passed, because the only thing it costs is an `i64` literal argument emitted at `i32`
width — a hole that no case happened to have. Function parameter types are now recorded, for the same
reason field types are: a literal takes the type of the slot it fills, and a call site has a name
rather than a declaration.

### Rung 4 gains arrays, the first GC type

**86 programs, 128 calls, every answer agreeing.** Construction in all three spellings, indexed read
and write, `.len()`, packed elements, wide elements, and an array crossing a call.

An array is the first thing here that is **not a value type**. It is a *declared* type: `i32[]` is a
reference to an entry in the type section, written `0x64 <typeidx>`, so a value type stopped being one
byte and every place that wrote one had to become a call that writes a sequence. And because the entry
has to exist before anything names it, the module now takes a **pre-pass** over every signature and
every local to collect the set — the first thing in this emitter that is not local to one function.

The encodings were measured rather than recalled, by compiling three programs with the reference and
reading its bytes: `array.new_default` is `fb 07`, `new` is `fb 06`, `new_fixed` is `fb 08 <t> <n>`,
`get` is `fb 0b` with `_s`/`_u` at `0c`/`0d`, `set` is `fb 0e`, `len` is `fb 0f`. wasm having a
distinct instruction for each construction shape is unusually generous and means none has to be built
out of the others.

**A packed element needs the unsigned getter**, which is the checker's own rule — that a packed
element is an `i32` at the point of use — arrived at from the other end of the compiler. `u8[]` reads
zero-extended and `i8[]` sign-extended, and the two differ exactly on the values a test has to bother
to include.

Two bugs, both of the same kind: **something that returns `""` for "unknown" and also for "I have no
arm for this"**.

- `typeOfTyName` had no `Arr` case, so every array type came back empty. The type section had no array
  entry, the local was declared an `i32`, and the module asked for an array of whatever was on the
  stack — *"requested new array is too large"*, three layers from the cause.
- Integer literals were parsed into an `i32`, so `4294967296` in an `i64` slot became zero. The text
  of a literal says nothing about its width, so it is parsed wide and narrowed where the target is
  known.

Neither was findable by reading the code that failed. Both were one measurement away — dump the bytes,
compare with the reference's — which is the habit this rung is built on and the reason it is cheap.

### Rung 4: the divergence closed, and a loop that hung instead of failing

**74 programs, 115 calls, every answer agreeing.** The saturating cast is no longer a divergence, and
control flow is complete: `for`, `do..while`, `break`, `continue`, `switch`, `trap`.

**A scratch local** is what the cast needed. Saturating a narrowing conversion reads its operand three
times — once against each bound and once to convert — and an expression is not a thing you can
evaluate three times. So it is spilled to a nameless local, allocated on demand and reused per width.
Which forced a second change: the locals *declaration* precedes the code, and the count is not final
until the last instruction is written, so the body is now emitted apart and spliced in. That is the
same shape as a section, whose length is only knowable once its contents are.

Then the emitter's own new rule met it from the other side. `u32`'s upper bound is 4294967295, which
does not fit an `i32`, and writing it with `as~` **saturated it to `i32` max** — so the clamp pinned
every large value there. `as@` is the spelling that means the bit pattern. The rule this emitter had
just learned to implement, got wrong in the code implementing it, one function away.

**And a loop that hung rather than failed.** `i++` is the commonest `for` update in the language and
had no arm in the statement emitter at all, so the update emitted nothing, the counter never advanced,
and the module **validated and span**. The test did not report a wrong answer; it stopped. That is the
failure mode named two sections above as the argument for running the code, met in the least
convenient way: an oracle that runs things cannot politely report a program that never finishes.

It is worth being plain that the test suite can therefore hang on a future emitter bug, and that no
guard here prevents it — bounding wasm from the outside needs a worker and a timeout, which this slice
does not have. The loop bounds in the cases are small so a mis-emitted loop is more often a wrong
answer than an infinite one, and that is a mitigation rather than a fix.

`continue` is the other thing worth writing down: it cannot branch to the loop's own label, because
the update sits between the body's end and the back edge. It leaves a **third block** wrapped around
the body, whose end is where the update begins. Branching to the loop instead is a `for` that never
advances — the same hang, from the other direction.

### Rung 4 learns types, and the oracle corrects two assumptions

**64 programs, 87 calls, every answer agreeing.** Unsigned opcodes, `i64`, `f32`, `f64`, and the
conversions between them.

The boundary the last slice ended at was exactly this: `/`, `%`, `>>` and the four comparisons each
have a `_u` twin, and **the wasm value type cannot choose between them**. `u32` and `bool` are both
`i32` in wasm and `u64` is `i64` — the mapping is many-to-one, so which opcode is right is a fact
about the *wac* type that the wasm type has already thrown away. Hence a small type pass in the
emitter: not the checker's, which answers a much harder question over the whole language, but one that
only has to be right for what this slice emits, and is *needed* rather than merely useful.

**The oracle corrected two assumptions about the language**, and neither would have been found by
reading anything:

- **`as~` from a float rounds, it does not truncate.** `3.9 as~ i32` is 4. The spelling reads like C's
  cast and is not it, so the value goes through `nearest` before wasm's `trunc`. The ties are now
  asked about too, because half-to-even and half-away differ exactly there and both are defensible.
- **`as~` between integer widths saturates.** `(2^32 + 7) as~ i32` is `i32` max, not 7. This emitter
  writes `i32.wrap_i64`, which agrees in range and not outside it — clamping needs the operand twice
  and therefore a scratch local, which this slice has no mechanism for. **Named as a divergence** in
  the emitter and here, and its test narrowed to the range where the answer is right, rather than
  left to look correct.

And one bug that read as a rounding error and was not one: every `f64` constant came out wrong by
exactly one part in 2²⁰. Shifting a `u64` by an `i32` produced `ff ff ff ff` in the low half — keeping
both sides the same width is the fix, and "a floating-point answer that is slightly off is a
floating-point problem" is the assumption that cost the time.

The float opcodes are worth a line because a table from memory gets them wrong: the two blocks are
**14 apart for arithmetic and 6 apart for comparison**. `f32.add` is `0x92` and `f64.add` is `0xa0`,
while `f32.eq` is `0x5b` and `f64.eq` is `0x61`.

### Rung 4: a slice that can express a real function

**33 programs, 52 calls, every answer agreeing with the reference.** From nine and thirteen: locals
and assignment, compound assignment, the whole `i32` operator set, comparisons, short-circuiting `&&`
and `||`, `if`/`else`, `while`, the ternary, calls, a call to something declared further down, and
recursion. Every module validates, and each construct earns its place by being *run* rather than read.

Three things are worth writing down.

**wasm has no names.** A parameter and a local are both an index, parameters first, and a call names a
function by index too — so the whole environment is two lists whose *position* is the answer. That is
the emitter's version of what the checker's flat name table already was, arrived at from the other
end.

**The locals declaration comes before the code that uses it**, so every local a body declares has to
be collected before anything is emitted — nested blocks included, since wasm has one flat frame per
function whatever the language's scopes look like. That is the same shape as the checker's
declare-before-walk pass, for a related reason.

**`&&` and `||` cannot be two operands and an opcode**, because they short-circuit: the right side may
not be evaluated at all. Each becomes an `if` with a value type, which is the one place this emitter
writes a block that produces something. The test for it divides by zero on the side that must not run,
so a wrong answer traps rather than merely differing.

`while` is a `block` wrapping a `loop`, the condition inverted and branching out, the body branching
back — labels relative, 1 for the block and 0 for the loop. Getting them the wrong way round produces
a module that **validates and hangs**, which is the argument for an oracle that runs the code in one
sentence.

The slice ends where a second numeric type begins. `/`, `%`, `>>` and the four comparisons each have a
`_u` twin, and choosing between them needs the *type* of the operand rather than the token — so `>>>`
is deliberately not exercised rather than exercised wrongly, and an unsigned cast is the first thing
the next slice will want.

Checked, as before, by emitting `i32.div_u` where `i32.div_s` belonged and watching it report
*"f(-7, 2) is 2147483644 from us and -3 from the reference"*.

### Rung 4's first skeleton

`emitModule` produces a wasm module, and the module **runs**. An exported `i32` function whose body is
one `return` over literals, parameters and arithmetic — a fraction of the language, and the fraction is
not the point. The point is that the shape is end to end, so the next rule the emitter learns is
measured by running it rather than by reading it.

**The oracle is the one this README argued for before there was anything to measure**: ask each
program of both compilers, instantiate both modules, call the export with the same arguments, compare
what comes back. Nine programs, thirteen calls, every answer agreeing. Nothing in the test asserts an
expected answer — a hand-written `5` would be a *third* opinion, and the whole point of a differential
test is that there are only two. Beside it, `WebAssembly.validate` on every module: a second opinion
about the bytes that costs nothing and is not the reference's, because a module can run the one
function a test calls and still be malformed elsewhere.

Checked the only way that means anything, again: by emitting `i32.sub` where `i32.add` belonged and
watching it report *"add(2, 3) is -1 from us and 5 from the reference"*.

What the scaffolding is, since everything after builds on it:

- **A growable byte buffer**, written locally rather than imported. `packages/wacc` has no
  dependencies, and the whole value of a self-hosting compiler is that it needs none.
- **LEB128, signed and unsigned.** The encoding is *not* canonical — `0` may be written as one byte or
  five — which is the argument against byte identity restated as a fact about the format.
- **A section is built in a buffer of its own and spliced in**, because its length has to be written
  before its contents. That is why a wasm emitter is a tree of buffers rather than one.

Three things the language pushed back on while writing it, all in the first ten minutes: `else if`
does not chain here, `fn` is a keyword and cannot name a variable, and a packed array element takes an
`i32` directly — `v as~ u8` is *"no valid cast"*, which is this checker's own rule seen from the other
side.

### What rung 3's oracle looks like, measured

The pipeline exists and works from outside: `wacLex` → `wacParse` → `wacResolve` → `wacTypeCheck`,
which is what the reference's own test drives, and a one-line wrong program comes back as

    return: expected i32, found string   @ 1:28

So the oracle is available today and needs no new plumbing. Three things about its shape, measured
rather than assumed, because they decide how the rung is cut:

- **`wacTypeCheck` takes a resolved multi-module result, not a source string.** Rungs 1 and 2 each
  took bytes and gave an answer; this one needs `wacResolve` in front of it, so wacc will need a
  resolver — or a stub of one — before a single diagnostic can be compared. That is a rung-3
  dependency that the ladder does not currently name.
- **~210 distinct message texts across 3,190 reference lines.** Rung 2 compared diagnostics by count
  and position rather than by text, because the wac side reports numeric codes and the reference
  reports English. The same applies here and matters more: 210 messages is a lot of English to
  reproduce, and none of it is the language.
- **The reference's own test is 267 `ok`/`fail` cases**, which is the closest thing to a specification
  of what the checker is supposed to reject. It is a better starting corpus than the repo's 326
  files, which all type-check cleanly and therefore exercise only the accepting half.

The corpus point is the one that changes the plan. Rungs 1 and 2 got most of their coverage from real
code; rung 3 cannot, because working code produces no diagnostics. Its coverage has to be written, and
the reference's test file is where the list already is.

### How a partial checker is compared to a complete one

Rungs 1 and 2 compare whole outputs and demand equality. Rung 3 cannot do that until it is finished,
and a test that fails until then is the same as no test. So the comparison is shaped for a subset:

- **soundness** — every diagnostic we report, the reference reports at the same line and column. A
  position we invent is a bug even when the program really is wrong.
- **no false alarms** — we say nothing about a program the reference accepts, and nothing about any
  file in `src/`, all of which type-check cleanly.

Completeness is deliberately not asserted. That makes each slice safe to land on its own, and it puts
the burden where it belongs: a slice may know about less than the reference, and must never disagree
with it about what it does know.

The first slice found two things by being written this way. `u8` cannot be a return type at all
(*"packed type 'u8' cannot be a return type"*), and an integer literal **is** an `i32` rather than
something that widens — `i64` accepts `return 1`, `f64` does not. Both were assumptions in the test's
clean list, both were wrong, and both were the reference correcting them rather than a design
decision. See the note on `u8` as a value type in
`~/notes/living/wac/language-friction-log.md`.

The two test kinds do different jobs, which is visible when one is broken. Merging integral and
floating back together — the coarse rule the first slice shipped — leaves soundness, the clean list
and the corpus all green, and fails only the grid, with *"the reference rejects 32 cells and we catch
26"*. Soundness catches a checker that is wrong; the grid catches one that is merely incomplete, and
nothing else here can.

## What rung 1 cost, in language terms

Worth recording precisely, since measuring this is the point.

**83 token kinds became 83 zero-argument functions** (`kinds.wac`, 264 lines) with
no module-level constants. The numbering has to match the reference's union order,
so the test derives that order from `wacLex.ts` at run time rather than trusting a
copy — a hand-synced enum would drift silently.

**Tokens are flat `i32` quintuples, not a `Token[]`.** A growable array of structs
means writing a container by hand, and gzip and json have already each written one.
Flattening also removed growth entirely: a source of n bytes yields at most n
tokens, so the array is sized once.

**Keyword matching packs bytes into an `i64`.** Indexing a `string` yields a
one-character string rather than a byte, so `src[i] == want[i]` does not typecheck.
`string.toBytes` landed mid-write and makes the direct version possible, but it
allocates per candidate and this runs once per identifier.

**No closures**, so the reference's captured `pos`/`line`/`col` become a `Lexer`
struct threaded through every helper. Mechanical, and arguably clearer.

**One compiler bug found and fixed** (`wac` 13e83cc): casting a packed array element
to a wider type emitted no widening at all — `bytes[0] as i64` was invalid wasm for
every packed type. Found because packing bytes into an i64 is the natural way to
compare keywords.

The two design worries from before writing any code both turned out fine. Byte
spans are a better token representation than strings anyway, and counting columns in
UTF-16 code units inside `advance` reproduces the reference's positions exactly — so
the non-ASCII divergence I expected to have to negotiate at rung 3 simply is not
there.

## What rung 2 cost, in language terms

**The AST is sum types, and that was the point.** It began as a flat integer node
pool, because wac had no alternative when it was written. Porting it to `enum` removed:

- `pack2` / `unpackLo` / `unpackHi` / `none` — the whole bit-packing convention, which
  existed only because a record held three fields and `for` and `func` needed four.
- The single tag space, which forced `sCase` to be a statement and `dParam` a
  declaration. Case clauses, params, fields, methods, variants and import items are
  now ordinary structs.
- Every untyped integer field access. `a`, `b` and `c` meant something different per
  tag and nothing checked it; the comments were the only schema.

`print.wac` is the payoff made concrete: 5 exhaustive `match` statements over 49
variants, written in one pass and compiling first try. The same walk over the node
pool would have been a chain of integer comparisons with a silent fall-through, and
adding a variant would not have broken it.

**Positions had to be exactly right, and guessing was expensive.** Three divergences
cost real time, all of them the reference doing something not inferable from the
grammar:

- Each `[]` or `?` suffix on a type carries *its own* token position, not the base
  type's. 34 of 42 corpus files disagreed on this alone.
- A malformed type is reported and **substituted** with `i32` without consuming a
  token. Advancing instead desynchronises the two parsers for the rest of the file.
- After `is`, whether the right side is a type or a value is decided by **naming
  convention** — a lowercase initial means a variable. A plausible approximation of
  this read `(a is b)` in the tour and `byStr! is byBytes!` in the json tests as type
  tests.

Every one of those was found by the differential test and none would have been found
by a test written from the same understanding as the implementation.

**Thirteen growable-list structs, character-identical but for the type name.** A
recursive-descent parser collects a list of every node type it builds, and with no
generics each needs its own `push`/`take`. This is now the most-repeated cost of that
gap in the repo, ahead of the four hand-written byte buffers.

**Two bugs of my own, both from the language rather than the algorithm.** A
zero-argument `XList()` default-constructs rather than calling the static `create()`,
so every list started with a zero-length backing array that doubled to zero and trapped
on first push. And `const` on a free-function parameter is not accepted — only `const
this` on a method — so the read-only intent of the lookahead helpers cannot be stated.

**Five compiler bugs found, all in `match`** — reported and fixed upstream in wac
`08fedd2` and `2a5c1c1`. Four were statement walks that predated `match` and were
never extended, so anything reachable only inside an arm was invisible to them; the
fifth was `break` in an arm, which reaches the enclosing loop but which the return
checker assumed did not. A sixth and seventh were enums resolved by name where
identity was meant, which only two files declaring the same enum name could expose.
