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
| 4. emitter | `wacEmitFunc.ts` + `wasmBuildBin.ts` | modules agree under a canonical form, and the corpus runs | 6307 |
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

Next: more of rung 3 — `switch` and `match` subjects, generics properly (`Box<Base>` from `Box<Sub>`
is the one variance case in the corpus), `override` agreeing with a parent, and the remaining
scattered type-mismatch cases.

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
