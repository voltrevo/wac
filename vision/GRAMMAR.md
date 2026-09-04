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

Eight distinct constructs, of which seven are still used:

| construct | example | where it bit |
|---|---|---|
| ~~a method with no body~~ | `bool settled(const this);` | `ticket`, `coroutine` — **and no longer either, see below** |
| a default type argument | `enum Result<T, E = union>` | `result` |
| the `gen` return form | `gen<T> void items(const this)` | `vec`, `stream` ×2 |
| a named union declaration | `export union<A, B> Fault;` | `http/fault` |
| a match arm without `case` | `Ok(request): { … }` | `request`, `value`, `main`, `serve`, `assert` |
| `try` in expression position | `try this.value()` | `json/json`, `json/parse` |
| `for … in` | `for (Param p in q.params.items())` | `url/query` |
| re-export | `export { Vec } from "./vec.wac";` | every barrel |

**The first row is struck through and the count above still says eight.** Measured 2026-09-04: zero
body-less method declarations anywhere in this directory. `core/ticket.wac` says why in the past
tense — *"`settled` and `advance` **were** bodyless methods here"* — and they are `fn<bool()>` fields
now, so the construct was designed out and the table kept it. Left visible rather than deleted,
because a row that was true and stopped being true is the more useful record: it is the second on
this page, and both were found by measuring rather than by reading.

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

## And it was a closed list of the wrong thing, for a week

`GRAMMAR.ebnf` was derived from `vision/packages/**` — the disposable rewrites — so it was a closed
list of what *those* use, not of what vision proposes. Nothing had ever parsed the **vetted pages**.

The 64 ```wac fences in `SHOWCASE.md`, `IDIOMS.md`, `TECHNICAL.md` and `QUESTIONS.md` extracted and
run through `tools/specparse.ts` found **ten constructs on the agreed pages that no rewrite had ever
written**, in two rounds — the second round only became visible once the first was fixed, which is
the ordinary behaviour of a parser and the reason one pass is a lower bound.

| construct | example | pages |
|---|---|---|
| a verbatim name | `i32 double(i32 @"n")`, `export void @"test: …"()` | TECHNICAL |
| a quoted tag | `<"my-widget" />`, `</"label">` | TECHNICAL |
| a hyphenated attribute | `data-size="8"` | TECHNICAL |
| a keyword as an attribute | `for={@"for"}` | TECHNICAL |
| a verbatim name as a tag | `<@"caption">` | TECHNICAL |
| **`auto`** | `auto got = await …` | SHOWCASE, IDIOMS, QUESTIONS |
| a bracket literal | `[1, 2, 3]`, `sys.spawn(wasm, [], [Grant.Read])` | SHOWCASE, IDIOMS, TECHNICAL |
| a `coroutine` expression | `coroutine tick()` | TECHNICAL |
| **a bare `await`** | `await;` | TECHNICAL ×5 |
| a brace pattern | `Ok { v }:`, `Err { .. }:` | TECHNICAL |
| a control-flow arm | `Err(_): continue,` | TECHNICAL |
| a payload matched by type | `Err(is NotFound):` | TECHNICAL |

**`auto` is the one to notice.** It is on three of the vetted tiers, `QUESTIONS.md` already has an
entry about *"`auto` refusing to widen"*, so its **semantics** were being discussed while its syntax
was in no list of the syntax. And the bare `await` was asked for by the operator directly while
`Sys.drain` was being worked out — *"I think the ready case needs a bare await"* — and appears five
times.

So the earlier claim on this page, that the grammar is the closed list and the prose is the argument,
was true of the rewrites and false of the proposal. It is closer to true now, and the way to keep it
true is that **the pages are a corpus** and something has to read them.

**53 of the 64 fences parse, and the other eleven are fully accounted for**: six are fragments — a
bare `if`, a bare `this`, two statements with no function around them — and five are one construct,
below. Nothing is unexplained, which is the standard the tree-wide run set and the reason to say the
number rather than the ratio.

## A declaration with no initialiser, used five times and refused today

`Ticket<i32> t;`, `Slot s;`, `Vec<Continuation> outer;` — five fences in `TECHNICAL.md`, and
`i32 n;` is `found ';'` in today's compiler. wac has default values but not defaulted declarations.

It is **not** in `GRAMMAR.ebnf` and deliberately so, because it could be either an eleventh addition
nobody wrote down or five examples that elided an initialiser for brevity. `Ticket<i32> t;  // nothing
will ever resolve it` reads as literal, which argues for the first. The point is that **the pages
cannot tell you which**, and that is what running them is for.

## There is a machine-readable version of this now, and it parses every file here

`vision/GRAMMAR.ebnf` is the same additions as productions, patched over `spec/spec/grammar.md`, and
`tools/specparse.ts` runs the result:

    deno run --allow-read tools/specparse.ts vision      # 114/114 files parse

**That is a different kind of claim from anything else on this page.** Everything above was derived
by *subtraction* — what today's parser refuses, minus what a desugarer accounts for — so it is a list
of absences and cannot say whether the list is complete. A grammar that **accepts** every
file says the additions are sufficient, which no amount of refusal-reporting can.

It is not a compiler and does not pretend to be: a recogniser answers *does this parse* and nothing
else, so a file it accepts may be meaningless. What it removes is the possibility of a construct
being used here that nobody has written down.

### Two name checks, because a recogniser cannot see a wrong name

Both are twenty lines of Python and neither is committed, because `vision/` is documentation as far
as the tooling is concerned. They are described rather than shipped so the next reader can rebuild
them, and both are **currently zero** — a real zero, proved each time by injecting a name that is
wrong and watching it come back.

**Every imported *and re-exported* name, against what the target exports.** For each
`import { A, B } from "…"` — and, since 2026-09-04, each `export { A, B } from "…"` — resolve the
specifier (`core`, `std`, `@/packages/x`, a relative path) and check the target declares each name.

**Adding `export` took it from 15 findings to 24**, and the nine are a kind the import check could
not see: a **barrel publishing a surface its package does not have**. `packages/unicode`'s names two
files that were never written; `packages/wactest`'s exports `FakeFiles` and `FakeClock` from a file
that exists and has neither. An import that dangles is a file reaching for something; an export that
dangles is a package *advertising* something, which is worse and was invisible for a week. This started as *does the target file exist* and was widened on 2026-09-04; the widening
found three calls to a `Buf.empty()` that `@/packages/bytes` does not have, and one import of `Node`
from `@/packages/page` for a type `core/jsx.wac` declares. Fourteen findings remain and are all the
same one: the overlay imports `wac.json5` records.

**Every static call `Type.member(…)`, against what `Type` declares.** Collect struct and enum
members, resolve aliases (`export Slice<u8> Bytes;` means `Bytes` has `Slice`'s statics — without
that step `Bytes.empty()` is *skipped*, and a skip reads exactly like a pass), then check every
`[A-Z]\w*\.\w+\(` whose receiver is a type this tree declares. Instance calls are out of reach: the
receiver's type needs inference, which a regex has not got.

Neither is a type check and together they are most of what one would catch here, because almost
everything in this directory is a call to something by name.

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

Re-measured 2026-09-04 with strings stripped as well as comments — see below for why that is not a
detail. `grep` is the raw count, *in code* is what a migration actually has to edit:

| vision | shipped | grep | in code | files |
|---|---|---:|---:|---:|
| nine projections | `Core` and `Cli`, two parameters | 3,210 + 4,413 | 2,886 + 3,814 | 710 + 741 |
| `Ticket<T>` | `Pending<T>` | 758 | **418** | 77 |
| `fn<T(…)>` | `fn[T(…)]` | 1,091 | **378** | 75 |
| a match arm with no `case` | `case X:` | 2,399 | 2,396 | 217 |
| `default:` | `else:` | 624 | 623 | 102 |
| `T?` everywhere | `Option<T>` alongside it | 102 | **48** | 17 |

**Every row is a type or a piece of syntax, and there is a second table underneath it.** Diffing
`vision/core` against `core/` *member by member* — done 2026-09-04, and not before — turns up renames
and signature changes inside those types:

| vision | shipped | in code | files | |
|---|---|---:|---:|---|
| `or` | `orElse` | 34 | 11 | a rename |
| `orTrap(why)` | `unwrap` | 16 | 5 | a rename **and** a new required argument |
| `settled` | `isDone` | 30 | 7 | a rename, and method to funcref field |
| — | `then` | 9 | 5 | replaced by `Continuation` |
| — | `cancel` | 19 | 10 | no counterpart proposed |
| | | **108** | **32** | |

Small beside `fn[`'s 378 and the number is not the point: **a migration sized from the table above
would be wrong in kind.** A type rename is mechanical and two of these are not — `unwrap()` becoming
`orTrap(why)` needs a message written at each of sixteen sites, and `cancel` has nowhere to go.

`Result.ok()` and `.err()` are dropped too and are deliberately not in the table: `.ok()` has 372 uses
across 59 distinct receivers and nearly all are `Change.ok()`, a different type that `@/packages/fs`
replaces with a union. No grep separates them, so the row would be a guess. `../QUESTIONS.md` has the
rest, including that a third of these are *deletions* rather than renames and neither table has a
column for one.

**The first row stopped being a rename on 2026-09-04 and the numbers are now a floor.** It said
`Sys`, because vision bundled the projections into one value and a sweep could have replaced two
parameters with one. `Sys` is gone — measured, one function in fifty-nine files took it, and it took
it for `drain` — so what replaces `(Core, Cli)` is *whichever projections that function uses*, which
is a judgement per call site rather than a substitution. The 6,700 sites are still the sites; what
changed is that a script cannot do them.

**The `fn[` row was 444 and is 378, and I cannot say what the 66 were.** The earlier figure was taken
the way this one is — comments and string literals stripped — and no variant tried here reproduces
it: stripping `"""` blocks or not makes no difference, every other row lands within a few percent of
its old value, and the raw grep is identical at 1,091 in both. So the two disagree and only one of
them has a second opinion. Said plainly rather than smoothed over, since a table of numbers with no
method attached is how the first one got here.

What *is* measured is how much of the raw count is prose and text, and why this row is the extreme
one. `packages/wacc/src/coretext.wac` is the whole of `std/` and `core/` embedded in the compiler
**as text**, 3,343 lines, holding 157 occurrences of `fn[` inside string literals. Across the tree,
strings hide 455 of the 833 that survive comment-stripping — more than half, and more than every
other row put together.

    row          after comments   after strings   hidden by strings
    fn[                     833             378                 455
    Pending<                581             418                 163
    Cli                    3982            3814                 168
    Core                   3010            2886                 124
    Option<                  63              48                  15
    case X:                2398            2396                   2
    else:                   623             623                   0

So it is specific rather than general: a count of a *syntactic* construct is wrong here in proportion
to how much a compiler that carries its own source quotes it. `case X:` and `else:` are unaffected
because nothing embeds a match arm as a string; `fn[` is affected most because a funcref slot is what
`std/platform.wac` is mostly made of, and `coretext.wac` is `std/platform.wac`.

**The parser agrees exactly.** Over `packages/`, 21 files refuse under the vision grammar and 21
files contain `fn[` outside comments and strings — the same 21, with nothing on either side. That is
the cross-check the grep could not do for itself, and it is the reason the 378 is trustworthy where
the 444 was not: a number derived by pattern-matching, confirmed by a tool that has to actually
parse.

### `--tokens`, because four counts went wrong in one day

Every construct question on this page and in `QUESTIONS.md` has been answered by grepping text, and
in one day that produced four wrong answers in both directions:

    fn[            833 by grep, 378 in code   — `coretext.wac` carries `std` as string literals
    a list literal   1 by grep,   0 in code   — the hit was an EBNF fragment in a comment
    coroutine f()    1 by grep,   0 in code   — the hit was a doc-comment example
    never           19 by grep,   2 in code   — *never* is an ordinary English word
    secret           0 by grep,   2 in code   — the pattern wanted `secret <word> <word>`
                                                and the spelling is `secret u8[] key`

`tools/specparse.ts --tokens` dumps the lexer's answer — `file`, `line`, `col`, `kind`, `text`, one
token per line, no parsing — so `--tokens | grep` cannot see a comment or a string, because neither
is a token. Every count in this document and in `QUESTIONS.md` that names a number of *files using a
construct* was re-taken that way.

**It does not solve the fifth kind of mistake and says so.** A token stream says a word is *there*,
not that it is used as the construct: `auto` is an ordinary `IDENT`, so this cannot tell a variable
named `auto` from the keyword — which is the contextual-keyword cost recorded above, arriving in a
tool this time instead of in a reader. A parse tree would; an Earley chart big enough to reconstruct
one is not affordable on this machine, and saying so is better than pretending the token stream is
one.

**The counts on this page were greps and three of them are roughly double the truth.** Comments and
string literals are 59% of `fn[`'s occurrences, 50% of `Option<`'s and 43% of `Pending<`'s — a
package that discusses a type mentions it far more often than it uses it, and the three most
discussed are the three most overstated. Stripping comments and strings first gives the column that
matters for a migration. `Core` and `Cli` barely move, because a capability is passed far more often
than it is written about.

### Is vision a superset? No, and the whole of the difference is one bracket

Executable now, and worth more than the counts above. Both grammars were run over `spec/cases` —
323 programs, each the smallest thing that shows one rule:

    deno run --allow-read tools/specparse.ts --no-vision spec/cases    316/323 parse
    deno run --allow-read tools/specparse.ts --vision    spec/cases    269/323 parse

(the 7 the spec grammar refuses are cases written to be refused, and vision refuses all 7 too)

**The two flags are what make this measurement askable**, and until 2026-09-04 it was not: the delta
was applied when `vision` appeared among the roots, so *which grammar* and *which files* were one
switch, and asking for the vision grammar dragged vision's own files into the corpus. Which grammar
to run and what to run it over are two questions.

**Forty-seven cases that today's language accepts, vision refuses. All forty-seven contain `fn[`.**
Not most of them — all of them, checked by grep over the list. Lambdas, funcref tables, bound method
references, every async case, `0181 a cell in a capture record`, `0245 a method may be called with
its own type arguments`: they are refused because a funcref slot is written with brackets somewhere
in the file, and for no other reason.

So the answer to *is this the same language with more in it* is: **it is, apart from one bracket.**
Everything else the delta adds is additive — 37 rules replaced and two extended, and not one of them
takes anything away. That is a much smaller claim than the rename table looks like and a much easier
one to act on: the migration is a mechanical sweep of 378 sites, and the day after it, every one of
these 323 cases parses under both.

Worth saying because nothing else could have said it. A grep tells you how many lines mention a
spelling; running both grammars over the same corpus tells you which *programs* stop being programs,
and it turned out to be one cause with no second.

### And now over the whole tree, which is 1,134 files rather than 323

`spec/cases` is a corpus of deliberately small programs. `packages/` is the production one — 40
packages, 1,134 files, everything from a 16,000-line relay to a nine-file `abi`. Both grammars were
run over all of it, 2026-09-04:

    spec grammar     1134/1134 parse
    vision grammar   1113/1134 parse

**Twenty-one files, one reason.** Every refusal is `no rule reaches '['`, and every one of the
twenty-one files contains `fn[`. Not a majority — the whole set, with nothing else in it, on a corpus
three and a half times the size of the one the claim was first made on. `platform` accounts for
eleven of the twenty-one and the other ten are spread over seven packages.

    box 2   fs 1   gzip 2   platform 11   sh 1   stream 2   wactest 1   zstd 1

### The rest of the tree, and the two files that make it interesting

`packages/` is 1,134 of the repository's 1,578 `.wac` files. The other 444 — `spec/` 324, `tools/`
96, `core/` 14, `native/` 5, `bootstrap/` 4, `std/` 1 — run the same way:

    spec grammar     1568/1578 parse       (10 refused)
    vision grammar   1494/1578 parse       (84 refused)

**The spec's own grammar refuses ten files in the repository, and seven of them are meant to be
refused** — `spec/cases` programs that exist to be rejected. The other three are
`bootstrap/drivers/emit_and_run.wac`, `selfhost.wac` and `spec_cases.wac`, all at the same column, all
on a module-level mutable variable: `u8[] built;`. `packages/wacc/src/parse.wac` has no top-level
case for one either, so wacc and the spec agree and wac-L5 — which compiles the drivers as part of
the ladder — does not. That is `issues/lang/0329a` and it is not a vision question.

**And it is the one place the vision grammar accepts more than the spec's, which is not the good news
it sounds like.** Vision takes 2 of the 4 drivers where the spec grammar takes 1, and the extra one
is `emit_and_run.wac`: its `u8[] built;` matches `typedef = [ "export" ] , type , IDENT , ";"` and is
read as declaring a type named `built`. Over 1,578 files that is the **only** thing the delta accepts
and the spec refuses, and it is a misreading. All 84 differences in the other direction are `fn[`.

`QUESTIONS.md`'s *naming a type takes the only shape a top-level variable could have* said this would
happen, and said it worked *"only because wac has no top-level variables"*. There are top-level
variables; they are in the ladder.

**The 1,568 is worth as much as anything about vision and is not about vision at all.**
`spec/spec/grammar.md` was a document nothing checked against the code it describes — it gained ten
productions this week from files using constructs it did not have. That it now reads every wac file
in the repository except seven written to be refused and three the compiler cannot read either is the
first statement anybody has been able to make about it. A recogniser cannot say a grammar is *right*;
it can say there is nothing written here it cannot read, and until this week nobody could say even
that.

**A note on how it was run.** One `deno` per package — `tools/specparse.ts` called forty times per
arm — because the whole tree in a single process died at about 125 files of 1,134. The machine had
1.8 GB available at the time, against a suite that wants 4 GB, so **whether that is state the
recogniser never releases or simply the peak cost of one large file under a low ceiling was not
determined.** `packages/box` alone is 128 files and completes, which rules out the corpus and rules
out nothing else. Said that way because the obvious explanation is a leak and the obvious explanation
has been wrong twice on this page already.

What it does mean either way: `wac task grammar:parse` — `specparse.ts packages core std spec tools`
in one process — cannot finish on a machine in this state, and there is no sign that it is not
finishing other than the absence of a last line.

**The delta was eight rules smaller than it said, until 2026-09-04.** It grew in three appended
sections — the original from the rewrites, then *six more from the vetted pages*, then *four more on
the second round* — and each later section **restated** rules an earlier one had already replaced, so
that it could change them again. The loader takes the last definition, so eight were dead text, and
the dead one was the copy carrying the comment that explained the construct: a reader looking up
`match_arm` found the superseded form first. Merged, and `tools/ebnfaudit.ts` — which has had a
*two rules with one name* check the whole time and had never been pointed at this file — now reports
none. 47 entries became 39, under 38 names, with 564 productions and what parses both unchanged.

**Re-measured 2026-09-04, after the delta had roughly doubled, and every number above is unchanged.**
When these three lines were first written the patch was 22 rules replaced and one extended; it is now
37 and two, having absorbed page-only constructs, four control-flow forms, and the withdrawal of
bodyless methods. 316, 269, 47, and *all* 47 containing `fn[` — none of them moved. Twenty-three more
productions and the corpus cannot tell.

That is the additivity claim measured rather than asserted. The paragraph above says the delta takes
nothing away; the way to be wrong about that is to add a rule that shadows one of the spec's, and a
replaced rule is precisely a rule that shadows one of the spec's. Forty-five of them do, and the only
program in 323 that any of them stopped accepting is a program that was already refused for its
brackets.

**And only one row is a grammar change at all.** `fn[T(…)]` → `fn<T(…)>` is the single rename the
parser can see: `tools/specparse.ts` with `GRAMMAR.ebnf` refuses `fn[void()] cb;` and accepts the
angle form, so those 378 sites in 75 files stop compiling on the day it lands. Everything else in
this table is a rename of an *identifier* — `Core`, `Pending`, `Option` — or of arm syntax the delta
accepts both spellings of, so a sweep can do it and nothing breaks in between.
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

### And there is a third blind spot, which found the largest omission in this document

A spelling that **parses today and means something else** is invisible to both halves. The parser
does not object, because there is nothing wrong with the syntax; the known-wrong list does not
object, because nobody knew.

The instance, measured 2026-09-04 through `bootstrap/ts/ask_wacc.ts`:

    Res<i32, F> f() { return Ok(3); }     // 1 type error: `a call to Ok`

**An unqualified variant construction is not a thing today.** `spec/spec/enums.md` gives the bare
form for a type test — *"`is` accepts a variant name, bare or qualified by the enum"* — and for a
`case` pattern, and construction is `Enum.Variant(args)` everywhere in `packages/`. Unqualified,
`Ok(3)` is read as a call to a function named `Ok`, which is why the diagnostic says so.

This directory writes it **90 times in a `return` position alone**, across ten files, split 42
`Ok` and 48 `Err` — and the other 53 capitalised names in that position (`Typed`, `Mount`, `Slice`,
`Buf`, `Big`) are struct constructions, which are fine. It is therefore one of the largest
additions vision makes, it is used more than most of the eight in the table above, and **no page
names it.** The table has *a match arm without `case`* — the pattern side of the same idea — and
stops there, because the pattern side is what the parser refused and the construction side is what
it silently accepted as something else.

Two further spellings measured while establishing that, both refused: `Res.Ok()` with empty
parentheses at `T = void` is *a variant with the wrong count*, and unqualified `Ok` with no
parentheses is *unresolved name Ok*. So of the three alternatives `QUESTIONS.md`'s
*Spelling `Ok` when the value is `void`* weighs, exactly one compiles — `Res.Ok`, qualified and
bare — and it compiles through `issues/lang/0335a`, which is a bug.

The lesson for the instrument rather than for the entry: **a construct is invisible to a
first-divergence run precisely when it collides with an existing one.** Anything vision spells the
way today's language spells something else will never appear in the table above, and the way to find
the rest is to run the *semantics* — which is what `ask_wacc.ts` does and what the table was built
without.

Three were found that way on 2026-09-04, and they do not behave alike:

| assumption | today | emits? |
|---|---|---|
| an unqualified variant construction, `return Ok(3);` | `a call to Ok` | no — declined |
| `u8` as a local, parameter, field or cast target | 3 type errors | **yes, and runs correctly** |
| `T[]` widening implicitly to a `Slice<T>` | 1 type error | yes, and the **engine refuses** the module |

The middle row is the one to keep in mind when reading anything else in this directory: the checker
refuses it and the code generator does not care, because a packed element is an `i32` in a register.
A rule whose violation produces a working program is the kind that gets written around 61 times
before anyone notices — `issues/lang/0336a`.

The last row is the opposite and is the honest shape of a *type-system* addition: there is a struct
to allocate and no instruction that invents one, so nothing papers over it. Which is also why it is
a bigger ask than it reads as — `T` to `T?` is free and `T[]` to `Slice<T>` is an allocation per call
site, implicitly.

**And "N/N files parse" is not "N/N files mean what they say."** Both numbers are worth having; only
the first was being quoted at the top of this page.

None of the three is a syntax question, so none can be answered by `GRAMMAR.ebnf` and none belongs
in the table above. They are in `QUESTIONS.md`.

## Costing a desugarer, since the brief keeps suggesting one

*"Consider actually implementing a parser for the new syntax — it may be easy enough to be valuable
without waiting."* The recogniser above is one answer and it does not run anything. The other answer
is a **desugarer**: rewrite the additions into today's wac so some of this directory compiles. This
section is what that would cost, measured 2026-09-04, so the suggestion stops being deferred.

**Baseline.** Under the spec's own grammar, with the delta off, `23 of 104` files parse. The first
divergence is `{` in twenty of them — the barrels — and the histogram of first divergences is a poor
guide, because a file is blocked by everything it uses and reported by one.

**Per construct, over 102 files** (`bench/` excluded, it is today's language by declaration):

| construct | files | a mechanical target in today's wac? |
|---|---:|---|
| a match arm without `case` | 25 | **yes** — prepend `case`, purely token-level |
| `for … in` **over an array** | ≤16 | **yes** — a counted loop |
| `u8` as a local, parameter, field or cast | 19 | **yes**, and not free — `i32` loses the truncation |
| `try` | 17 | **yes** — a temp and a `match`, local |
| unqualified `Ok(x)` / `Err(e)` | 14 | **yes** — qualify; measured, `Res.Ok(3)` on a generic enum checks clean and runs |
| `for … in` **over a generator** | 17 | **yes, since** — `TECHNICAL.md`'s `try for` entry, measured |
| re-export | 20 | no target, and it blocks only barrels — see below |
| `union<…>` in a type | 15 | **yes, since** — an enum of one-field variants, measured |
| a named `union` declaration | 11 | **yes, since** — the same entry |
| `gen` / `yield` | 8 | **yes, since** — a struct with a resume tag, measured |
| a default type argument | 3 | not lowered |
| `never` as a type argument | 2 | an enum with that arm deleted; not written out |
| `coroutine` | 1 | not lowered |

**A row went from that table rather than being answered: "a method with no body", counted at ten.**
It was a regex matching `return f(…);` — a return whose expression is a call, ending in `);`. With
the keyword filter the count is **zero**: `core/ticket.wac` says `settled` and `advance` *"**were**
bodyless methods here"* and they are funcref fields now, so the construct left this directory and
the eight-construct table above still lists it. One of the eight is not used.

**So: 25 files use nothing new, 17 are blocked only by constructs with a target, and 60 need the
language.** Forty-two of 102 reachable, and the ceiling is set by re-export and by generators.

Two things the measurement changed about the plan, both worth having:

- **`for … in` reads as sugar and mostly is not here.** Of 42 uses, **26 are over a generator** — 18
  through `Vec.items()`, 8 through a call, 11 of them `await for`. `core/vec.wac` decided that a
  `Vec` is iterated through a generator and recorded it; the consequence is that the construct that
  looks most like a loop rewrite is, in this corpus, mostly a coroutine.
- **The expensive part is already built.** `tools/specparse.ts --tokens` is a working wac tokeniser —
  interpolation and JSX included — so a token-level rewriter needs no lexer. What it needs and does
  not have is a *tree*: `specparse` is a recogniser and says so, *"it answers does this parse and
  nothing else"*, so `try` and `for … in` — which need expression and block bounds — want either an
  Earley forest extracted from it or a small recursive-descent pass over the tokens.

### The re-export blocker is cheaper to route around than that table makes it look

Checked immediately after writing the row above, because "the single biggest blocker" is the kind of
claim worth a second look. **All twenty files blocked by re-export are barrels** — nineteen contain
nothing but `export … from` lines, and the twentieth is one with a wrapped line. Not one of them has
any code in it.

So re-export does not block any *program*. It blocks the twenty files whose entire content is the
package's name, and the way round it is to delete them and import by path — which costs **24 import
statements in 22 files**, against 55 that already name a file and 71 that name `core` or `std`
(directories, not barrels, and unaffected).

That moves the ceiling: **42 of 102 with the barrels in place, 62 without them**, and the difference
is a mechanical edit to two dozen import lines rather than a language feature.

**So the recommendation is the other way round from where this section started.** A desugarer does
not need `issues/lang/0073`; it needs the barrels dropped for the experiment, which is reversible and
touches nothing but imports. What it genuinely cannot reach is the forty files with real code that
use a generator, a union, or a method with no body — and those are the three features this whole
directory exists to argue for, so a desugarer would compile the half of the corpus that is *least*
about the proposal. Worth knowing before starting, and it is the argument for spending the next
effort on `union` rather than on a rewriter.

### Where the costing ended, three ticks later

Every construct on that table now has a written, measured lowering except four, and those four are
`coroutine` (1 file), a default type argument (3), `never` (2, and it is *"the enum with that arm
deleted"*), and re-export (20, all barrels). `TECHNICAL.md` carries the three lowerings — `union`,
`gen`/`yield`, and `try` / `try for` — each with a target that compiles and runs.

**So the answer to the brief's suggestion has inverted completely.** The question was whether a
desugarer is easy enough to be worth writing without waiting; the measurements say the *desugarings*
are the easy part and every one of them needs the same thing the recogniser does not give:

> `try` needs the statement it sits in, because a `match` arm cannot introduce a name into its
> enclosing scope. `for … in` needs the loop body. `union`'s injection needs the type of the slot.
> `gen` needs every local that outlives a suspension.

None is a token substitution, and **a tree is the whole of the remaining work.** That is what
*"actually implementing a parser"* means, and it is now a better-supported recommendation than it
was when it was a suggestion: the thing to build is a parser, and the passes that hang off it are
each a page of `TECHNICAL.md` that has already been run.

**And one thing more, found by checking the `try` lowering at a type with no default.** The general
form nests the remainder of the block inside the `Ok` arm — there is no uninitialised declaration to
fall back on, `Foo x;` being two parse errors — so a function with eight declaration-form `try`s
lowers eight `match`es deep. `@/packages/datetime`'s `parse` has exactly eight.

That rules out one of the two shapes the work could take. **A source-to-source desugarer is the
wrong target**: its output for that function is unreadable, and every diagnostic, line number and
stack frame a user of the proposal would see points into it. The parser should feed a *compiler
pass* — `wacc`'s own AST — where the nesting is a tree nobody reads.

### And `union` turned out to be a desugaring too

That recommendation was taken the same day and the answer is in `TECHNICAL.md`: **`union<A, B>`
lowers to an enum of one-field variants, and the target compiles and runs today** — measured, zero
type errors, including nested inside a generic `Result<T, E>` and including a union whose member is
a union.

Which moves it onto this table. Of the three rules the lowering needs, two exist:

| rule | today |
|---|---|
| the declaration generates one unary variant per member | a source form, mechanical |
| **injection: a member value in a union slot is wrapped** | the only thing the language adds |
| `Err(is Corrupt):` is `case AsCorrupt(c):` | matching a variant, which works |

So `union` is a declaration form and one coercion — the same coercion `T` to `T?` already has,
applied at a slot. That is much smaller than it has read all week, and it makes the ordering
`union`, then generators, then a rewriter: the first is 15 files of type uses and 11 declarations,
and it is the one whose implementation is bounded.

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
