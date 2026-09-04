# What the syntax adds

Where the language `vision/` proposes stops being parseable by the one that exists. **Generated, not
agreed** — `tools/visiongrammar.sh` runs today's compiler over every `.wac` under `vision/` and
reports where its parser refuses, so this is a diff of two grammars derived from the code rather
than from anybody's memory of what they wrote.

It is also the specification for a parser that would accept vision: the list below is exactly what
such a thing has to add.

Run it again after writing any vision code:

    tools/visiongrammar.sh

---

## It is a lower bound

A parser stops at the first thing it cannot read, so the tool reports **one construct per file** and
nothing about what is behind it. Blanking the offending line and re-running — the obvious fix —
does not work here: the lines are inside struct bodies, so removing one breaks the body and every
line after it comes back as cascade.

So the table is what the tool found. The section after it is what is known to be behind those and
has never been reported by anything, which is a different kind of claim and marked as one.

**Writing more of the language moves things between the two.** `for … in` sat unreported through
fifteen files because every one of them had something else wrong first; `url/query.wac` is the first
file where a `for … in` comes before any other divergence, and the tool found it immediately.

## What the tool reports

    vision/core/core.wac                           ^ found '{'
    vision/core/core.wac                           ^ found '{'
    vision/core/core.wac                           ^ found '{'
    vision/core/core.wac                           ^ found '{'
    vision/core/core.wac                           ^ found '{'
    vision/core/core.wac                           ^ found '{'
    vision/core/coroutine.wac                      ^ expected '{', found ';'
    vision/core/result.wac                         ^ expected '>', found '='
    vision/core/slice.wac                          ^^^^^ found 'items'
    vision/core/ticket.wac                         ^ expected '{', found ';'
    vision/core/vec.wac                            ^^^^^ found 'items'
    vision/packages/bytes/src/bytes.wac            ^ found '{'
    vision/packages/crypto/src/secret.wac          ^ expected ')', found '['
    vision/packages/fmt/src/fmt.wac                ^ found '{'
    vision/packages/http/src/fault.wac             ^ expected '(', found ';'
    vision/packages/http/src/http.wac              ^ found '{'
    vision/packages/http/src/request.wac           ^^ found 'Ok'
    vision/packages/json/src/json.wac              ^^^^^ expected ')', found 'parse'
    vision/packages/json/src/parse.wac             ^^^^ expected ';', found 'this'
    vision/packages/json/src/value.wac             ^^^ found 'Str'
    vision/packages/regex/src/regex.wac            ^^^^^ found 'Found'
    vision/packages/regex/src/regexpkg.wac         ^ found '{'
    vision/packages/server/src/main.wac            ^^^ found 'Err'
    vision/packages/server/src/serve.wac           ^ found ','
    vision/packages/server/src/server.wac          ^ found '{'
    vision/packages/sh/src/exec.wac                ^ expected '{', found ';'
    vision/packages/stream/src/scalars.wac         ^^^^ expected '>', found 'void'
    vision/packages/stream/src/stream.wac          ^ found '{'
    vision/packages/stream/src/transform.wac       ^^^^ expected '>', found 'void'
    vision/packages/unicode/src/unicode.wac        ^ found '{'
    vision/packages/unicode/src/utf8.wac           ^ expected '(', found ';'
    vision/packages/url/src/query.wac              ^^ expected '=', found 'in'
    vision/packages/wactest/src/assert.wac         ^^ found 'Ok'
    vision/packages/wactest/src/test.wac           ^ expected '[', found '<'
    vision/packages/wactest/src/wactest.wac        ^ found '{'
    vision/std/platform.wac                        ^^^^ expected ';', found 'this'

Eight distinct constructs:

| construct | example | where it bit |
|---|---|---|
| a method with no body | `bool settled(const this);` | `ticket`, `coroutine` |
| a default type argument | `enum Result<T, E = union>` | `result` |
| the `gen` return form | `gen<T> void items(const this)` | `vec`, `stream` ×2 |
| a named union declaration | `export union<A, B> Fault;` | `http/fault` |
| a match arm without `case` | `Ok(request): { … }` | `request`, `value`, `main`, `serve`, `assert` |
| `try` in expression position | `try this.value()` | `json/json`, `json/parse` |
| `for … in` | `for (Param p in q.params.items())` | `url/query` |
| re-export | `export { Vec } from "./vec.wac";` | every barrel |

**`async` on a method was here and is not a construct any more**, which is the sharper lesson.
It was measured as `expected a type` and it parses today: the difference is that every measurement
in this document was taken through `native/v8/seed/wacc.wasm`, and that seed was several
`packages/wacc/src` commits behind. `./bootstrap.sh --no-install` and it moved. **A stale seed does
not fail — it answers, a few commits ago, and an answer is what this document is made of.** Two
files' first divergence changed with the rebuild, and the whole table is now re-measured against a
fresh one.

**`static` is not one of them, and was listed here in error.** A method with no `this` parameter *is*
static in wac today — `spec/spec/structs.md` says so and `Vec.create()` is how the real `core` writes
it. Six files here had been given a `static` keyword that the language has never needed, which is
worth more than the correction: the exercise is as able to invent syntax as to find it missing, and
this document is the thing that caught it.

## What is behind them, which nothing has reported

Every file stops at its first divergence, so none of these has ever been reached by the tool. They
are here because they are written in the tree, not because anything found them:

- `try await for (u8[] chunk in src) { … }` — three packages, and no part of it exists
- `schedule this.pending.push;` — `std/platform`, past its bodyless methods
- `defer { conn.close(); }` — `server/main` and `core/ticket`
- `export union<A, B> Fault;` and `export Slice<u8> Bytes;` — one form for naming a type, whether it
  is a union or an instantiation
- `@/packages/http` naming a directory rather than a file in it
- `T??` and `null as T?` — `url/query.wac`, where a parameter is absent, present with no value, or
  present with a value, and the standard keeps the last two apart. Its `get` returns
  `p.value is null ? (null as u8[]?) : formDecode(p.value!)`, which is the middle state written in
  the position it is actually wanted: an arm of a ternary
- `fn<void()>` as a type — `core/ticket`, replacing today's `fn[void()]`
- `\{…}` interpolation inside a string — `server/main`

## There is a machine-readable version of this now, and it parses every file here

`vision/GRAMMAR.ebnf` is the same additions as productions, patched over `spec/spec/grammar.md`, and
`tools/specparse.ts` runs the result:

    deno run --allow-read tools/specparse.ts vision      # 44/44 files parse

**That is a different kind of claim from anything else on this page.** Everything above was derived
by *subtraction* — what today's parser refuses, minus what a desugarer accounts for — so it is a list
of absences and cannot say whether the list is complete. A grammar that **accepts** all forty-four
files says the additions are sufficient, which no amount of refusal-reporting can.

It is not a compiler and does not pretend to be: a recogniser answers *does this parse* and nothing
else, so a file it accepts may be meaningless. What it removes is the possibility of a construct
being used here that nobody has written down.

Three things came out of writing it that this page had wrong or missing:

- **`trap` as an expression** was listed above as unaccounted-for and is now accounted for, as a
  `primary_expr` alternative. It was the last file to refuse.
- **`Found(Match match)`** in `regex` was a payload named with a keyword — vision code wrong under
  *today's* rules, the sixth class this page names, and the only instrument that could see it is one
  that parses.
- **No vision word needs to become a keyword.** `try`, `gen`, `defer`, `schedule`, `yield`, `in`,
  `union` and `secret` all work as contextual words, because the spec already needs that machinery
  for `from` and `fill`. The pages had never said whether they were keywords; the answer is that they
  do not have to be, and making them so is a decision with a sweep behind it.

## The grammar file is itself incomplete

`func_decl` had no `type_params`, so by `grammar.md` a generic *function* did not exist — fixed in
`issues/lang/closed/0320a`. Six more were behind the parser and are fixed in `0326a`, found by
running the grammar rather than by reading it: `this` as an expression and as an assignment target,
calling a funcref value, a bare block as a statement, a generic `enum` — which meant the file could
not describe `core/option.wac` — and type arguments on an array element.

Worth knowing before treating this document as a specification for one: `grammar.md` is the
authority for what it covers, it has been behind the parser four times, and the thing that now
finds that is `tools/specparse.ts` rather than a person.

## Three claimed additions were already in the language

`static` was listed in the table above and removed. Module-level `const` was called a gap in three
package READMEs. `trap` with a message was called undescribed in two. All three are in
`spec/spec/grammar.md` — `method_params` makes a `this`-less method static, `const_decl` is in
`program`, and `trap_stmt = "trap" , [ expr ] , ";"` says outright *the expr is a string message*.
All three compile today.

A fourth was in `generics.md` rather than the grammar: a method whose type parameter appears only in
its return type is called with the argument written, `this.fail<JsonValue>(…)`, exactly as
`Vec<T> empty<T>()` is called as `empty<i32>()`. And a fifth went the other way — I claimed `core`'s
root *aggregates* its files' exports and argued against generalising it. It does not aggregate:
`Read` is the only name that crosses from `"core"`, and `Result`, `Option`, `Map` and `hashBytes` are
each refused with *importing does not re-export*. An invented presence rather than an invented
absence, and the same failure to check.

A sixth is the largest. **String interpolation already exists**, and `IDIOMS.md`'s entry for it is
marked *Not yet* while describing a shipped feature almost in the spec's own words —
`spec/spec/strings.md`: *"exactly sugar for `+` … there is no formatting language — the expression is
whatever `+` accepts on the right of a string"*, with three tagged examples. What has not shipped is
`+` accepting a scalar, so `"n=\{n}"` is `operands have mismatched types` today. The proposal is one
clause wide and I had written it as the whole entry.

**None of them was findable by the tool**, and that is the point rather than an excuse. It reports
what today's parser refuses; a construct that already exists is accepted, so writing `static` in
front of a method produced a diagnostic while *believing module constants were missing* produced
nothing at all. One half of the exercise is instrumented and the other half is not.

What catches this class is reading the spec, and the six above say which parts: `grammar.md` for
syntax, `generics.md` for what inference reaches, `strings.md` for what a literal already does. It
should be read before a README says a thing is missing or present — every one of the six was three
lines of test away, and most had been repeated across several files by the time they were caught.

A seventh was smaller and the same shape: I filed *the shape of `main`* on the premise that a
posix-style exit code was a vision assumption. `export i32 main(Core core, Cli cli)` is what the
tree writes today, so the exit code is already the language and only the parameters change.

The pattern in all seven is one habit: asserting what the language does from memory of writing it,
rather than compiling three lines. The rate matters more than any single correction — seven in a tree of
nine packages is not a run of bad luck.

## Two more, found by desugaring rather than by refusal

The table above is a **lower bound**, and this is what fixed that.
A desugarer rewrote each of the nine into the nearest thing today's parser accepts and parsed again,
so whatever was *still* refused was a construct nobody had written down. (That tool is gone —
`GRAMMAR.ebnf` answers the same question directly, since a construct nobody has accounted for is
exactly one that grammar has no rule for, and it needs no rewrite rule maintained by hand per
construct.) That is the
class both other passes are structurally blind to: one reports rejections and cannot see past the
first, the other checks a fixed list and cannot see a new entry.

Five were reported. **Two survive**, and the other three are the more useful result.

| construct | measured | why it was invisible |
|---|---|---|
| `yield` as a statement | — | every file hit `gen<…>` in the signature first |
| **a generic parent** | `struct Kid : Base<i32>` → `expected '{', found '<'` | five files, each stopped by something above it |

The generic parent is load-bearing: `AllOf`, `AnyOf`, `Generator`, `AsyncGenerator` and `SysTicket`
all need it, and the whole ticket and coroutine design rests on it. Nothing had reported it because
every file that uses it stops at a `gen<…>`, a bodyless method or a default type
argument first.

## The same test, applied to the nine

Three of five falling to *is this avoidable?* is a reason to ask it of the nine, which were found by
refusal and banked without ever being challenged. Five of them are on the vetted pages — `for … in`,
the `gen` return form and an arm without `case` are all in `SHOWCASE.md`, and a default type
argument has a `QUESTIONS.md` entry — so they are the operator's, not mine to withdraw. Four are
mine, and none of the four is withdrawn, but three have an alternative that should be weighed
against them:

| construct | avoidable? | at what cost |
|---|---|---|
| a method with no body | **yes** — a body that traps, measured | not *when* the check happens but *whether*: `struct K : B { }` that never overrides a trapping method compiles clean, measured, and traps only if the path is taken. There is no abstract notion in the checker and nothing reports the omission |
| a named union | **yes** — write the members out at every signature | `http` repeats eleven of them; the alternative is what `ResponseFault` exists to stop |
| re-export | **yes** — import from the declaring file | exactly the cost `wac-mono 0072` is open about: `itoa64` exists twice because unifying it touches forty files |

The fourth was `async` on a method, and the story it carried is worth keeping because every step of
it was wrong in a different way.

It went into the table as a construct. Then the necessity test said `async` on a *free* function
parses today, so the row looked like it overstated things — and I checked, got `expected a type` for
the method form, and wrote a note congratulating the check for saving a correct entry from a test
that had been useful three times running.

The measurement was against a stale seed. `async` on a method parses. **The entry was not correct,
the test that wanted to remove it was right, and the note about nearly deleting something true was
itself the false step.** The row is gone from the table above.

What survives is the shape of the mistake rather than any of its content: three plausible
corrections in a row, each supported by a measurement, and the measurements were all reading a
compiler a few commits old. Being careful in the wrong units is indistinguishable from being right
until something else moves.

**`grammar.md` was behind twice**, in `issues/lang/0020` and `0320a`, and
`packages/wacc/test/wac/specproductions_test.wac` now guards it — a probe per construct, asserted in
both directions. It caught this on its first run.

## Three were withdrawn, which is the better half

Each was reported as a construct and each turned out to be avoidable — a slip or a convenience, not
something the language has to grow.

**An unnamed variant payload**, `Ok(T),`. One file out of eight wrote it. A payload's name is its
*field accessor* — `case Circle: return s.radius;` — so an unnamed one is unreadable.

**A nested pattern**, `Err(NotGranted(what)):`. Used once. `Err(e): { … e.what }` says the same thing
with a field access that already exists.

**A binding with no parentheses**, `Scalar s:`. `enums.md`'s `[§enum-narrow-nonvariable]` already
covers it: *name* the subject and the arm narrows it, so `Decoded d = decode(…); match (d) { Scalar:
{ d.code } }` needs nothing new.

**And each withdrawal took its desugaring rule with it.** A rule that rewrites a mistake into
something the parser accepts is a rule that stops this pass reporting the mistake next time — the
instrument would have been trained to accept exactly the error it had just found. That is the one
maintenance rule this file has: **a rule may only exist for a construct that is actually proposed.**

## Where the pass converges

Two files were still refused and both were accounted for: `trap` as an **expression**
(`core/result.wac`), and the `secret` parameter qualifier (`crypto/src/secret.wac`), which is this
exercise's own proposal rather than a gap. **Both are productions in `GRAMMAR.ebnf` now**, which is
what "accounted for" came to mean: not a note in a table, a rule that parses the file.

It was three. `wactest/assert.wac` wanted a block that ends in a value and no longer does — a method
that records a failure and returns `null` needs no new construct, and the pass reporting one file
fewer is how that was confirmed rather than assumed.

So the tree contains **eight constructs, plus two, plus two known** — and nothing else. That is a
completeness claim the first pass could not make at all.

## It also found errors of mine that are not constructs

`is` binds looser than `&&` and `||` — `is_expr` sits above `or_expr` in the grammar — so
`a is not null && b` is `expected ')', found '&&'` and needs parentheses. Two files wrote the
unparenthesised form, and vision proposes no change to precedence, so they were simply wrong. A
sixth class, after the seven claimed-missing and the one claimed-present: **code that is wrong under
today's rules in a place vision is not changing.** Nothing else would have caught those.

## What it replaces, which is a third thing entirely

`GRAMMAR.md` lists what the syntax **adds** — what today's parser refuses. A separate class is what
it **renames or replaces**, which the parser cannot see because the old spelling is perfectly good.
It is the class with a migration attached, and nothing had collected it.

| vision | shipped | sites |
|---|---|---:|
| `Sys` | `Core` and `Cli`, two parameters | 2,887 + 3,947 mentions |
| `Ticket<T>` | `Pending<T>` | 838 |
| `fn<T(…)>` | `fn[T(…)]` | 958 |
| a match arm with no `case` | `case X:` | 2,237 |
| `default:` | `else:` | — |
| `T?` everywhere | `Option<T>` alongside it | 156 |
| a tag is a function in scope | **`[§jsx-element-is-an-expression]`** — *"the tag as a string. Nothing is looked up"* | — |
| `+` accepts a scalar | `string + i32` is *"deliberately a compile error"* | — |

**The last two are not renames and are the ones to look at.** They contradict a *tagged* claim and a
deliberate decision respectively — the JSX row is the opposite design from the one the spec
documents and tests, and the `+` row reverses a choice `packages/fmt`'s header calls deliberate. An
entry that replaces a shipped design is legitimate; an entry that does it without saying so reads as
though the thing were merely unbuilt.

The renames above are cheap individually and total a five-figure sweep. Worth knowing before any of
it is called *the same language with more in it*.

## Which of these does the existing tree already want?

A different question from *is it in the language*, and the answers are not close together. Measured
across `packages/`, `core/`, `std/` and `tools/`:

| construct | demand today |
|---|---|
| `for … in` | **1,991** loops use a counter only to index its own collection — 47% of the 4,196 counted loops, and about a fifth of every loop in the repository. Filed as `issues/lang/0322a`. (An earlier count here said 4,414: that was the shape, not the subset that only walks) |
| re-export | `wac-mono 0072` is open about it, and `itoa64` exists twice because of it |
| a generic parent | **zero**. Not one `struct X : Base<…>` anywhere, and `issues/lang/closed/0034` lists *"a generic with a parent struct"* — the working direction, `struct X<T> : Base` — as tested. The reverse was never considered |
| `yield`, the `gen` form, `try`, named unions, a default type argument | no demand measurable, because the features they belong to do not exist to be wanted |

**That is three different kinds of thing wearing one label.** `for … in` is a gap the repository
feels 4,414 times and works around in every file. Re-export is a gap somebody filed an issue about.
A generic parent is not a gap at all — it is load-bearing for the ticket design here and nothing
outside this directory has ever reached for it.

Worth keeping separate when any of this is prioritised: *the language is missing this* and *vision
needs this* are different claims, and the constructs list mixes them. The first two would be worth
doing if `vision/` were deleted tomorrow.

## The `Not yet` audit, and where it stops

Every entry on the three pages marked **Not yet** — 46 of them — had its code run through today's
compiler. Nine use no syntax the parser refuses, and those nine were checked properly. The result:

- **`await` needs a ticket** — the refusal it wants exists for a *name* and not for a literal, so
  `await 7` checks clean and fails to emit. `issues/lang/open/0323a`.
- **Every state of a `T??` has a spelling** — the nesting already works, and the one construct that
  reaches the middle state, `null as T?`, checks and cannot be emitted.
  `issues/lang/open/0324a`.
- **Markup is a value** — not unbuilt but a *different design*. `[§jsx-element-is-an-expression]`
  says the tag is a string and nothing is looked up; the entry says every tag is a name in scope.
- The remaining six are correctly marked: they need `Sys` or `never`, which do not exist.

**And the audit stops here, which is worth saying rather than leaving implied.** An entry that uses
a vision *type* cannot be checked at all — there is no `Sys` to resolve. Renaming to the shipped
names was tried and gains nothing, because an entry with `Sys` in it also has `gen<…>` or `try` in
it; the run found exactly the one file it had already found. So 37 of the 46 are unreachable by any
instrument short of implementing the language, and their markers rest on judgement.

Four wrong out of nine checked is the rate to carry into reading the other 37.

## What it cannot see

It finds where vision is **ahead** of today's parser. It is blind to where vision code is **behind a
vision decision** — a spelling that is valid today and that `DECISIONS.md` has already replaced
parses fine, so nothing reports it.

That is not hypothetical. Four match arms in this tree were written `else:`, which is today's
spelling and which `DECISIONS.md` replaced with `default:` — reserving `_` for the payload wildcard,
since reusing it for both would be a pun rather than a generalisation. The tool ran over those files
and said nothing, because there was nothing for it to say.

So the two halves need different instruments. The tool now runs a second pass over spellings
**already known** to be wrong — `else:` for `default:`, `trap("…")` for `trap "…";`, a `static` that
is not a keyword, `fn[` for `fn<`, `Option<` for `T?`. It reports none today.

That pass cannot find a *new* kind of mistake, which is its honest limit: it is a list, not a
parser. The general instrument is reading `spec/spec/grammar.md`, and the section above is what
happens when nobody does.

**And its first hits were all false**, which is worth recording because a clean run had never been
tested. `vision/packages/gzip` quotes the shipped `gunzipStream(fn[Read()] read, fn[bool(u8[])]
write)` three times, and the pass asked for all three to be rewritten as `fn<…>` — which would
falsify the quotation. Quoting the code an argument is about is how every file in this directory is
grounded, so the pass was systematically wrong about a whole class of line and had simply never met
one. A hit inside backticks is now dropped: each line has its backtick spans removed and the pattern
re-tested against what is left, which keeps a fenced example (those lines carry no backticks) and
loses the quotation. Same judgement the `scheduler` check was removed on, one paragraph down.

One check was written and removed rather than kept: `scheduler`, which was a keyword and is not one
now. The *word* is ordinary English in these files — "the scheduler in force where it was called" is
prose about a concept — so it fired on three comments every run, and a section that is never clean
trains the reader to skip it.

## The `…` is not a construct

A body written `{ … }` means *the same as the original, not repeated here*. It lexes as an
unexpected character and the tool filters it by name. `core` uses a **bodyless** method to mean
something quite different — *must be overridden* — and that those two look alike is
[a question](QUESTIONS.md).
