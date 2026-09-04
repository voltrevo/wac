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
    vision/packages/sh/src/exec.wac                ^^^^^ found 'async'
    vision/packages/stream/src/scalars.wac         ^^^^ expected '>', found 'void'
    vision/packages/stream/src/stream.wac          ^ found '{'
    vision/packages/stream/src/transform.wac       ^^^^ expected '>', found 'void'
    vision/packages/unicode/src/unicode.wac        ^ found '{'
    vision/packages/unicode/src/utf8.wac           ^ expected '(', found ';'
    vision/packages/url/src/query.wac              ^^ expected '=', found 'in'
    vision/packages/wactest/src/assert.wac         ^^ found 'Ok'
    vision/packages/wactest/src/test.wac           ^^^^^ found 'async'
    vision/packages/wactest/src/wactest.wac        ^ found '{'
    vision/std/platform.wac                        ^^^^^ found 'async'

Nine distinct constructs:

| construct | example | where it bit |
|---|---|---|
| a method with no body | `bool settled(const this);` | `ticket`, `coroutine` |
| a default type argument | `enum Result<T, E = union>` | `result` |
| the `gen` return form | `gen<T> void items(const this)` | `vec`, `stream` ×2 |
| a named union declaration | `export union<A, B> Fault;` | `http/fault` |
| a match arm without `case` | `Ok(request): { … }` | `request`, `value`, `main`, `serve`, `assert` |
| `try` in expression position | `try this.value()` | `json/json`, `json/parse` |
| `for … in` | `for (Param p in q.params.items())` | `url/query` |
| `async` as a member modifier | `async Read recv(this);` | `wactest/test`, `std/platform` |
| re-export | `export { Vec } from "./vec.wac";` | every barrel |

**`static` is not one of them, and was listed here in error.** A method with no `this` parameter *is*
static in wac today — `spec/spec/structs.md` says so and `Vec.create()` is how the real `core` writes
it. Six files here had been given a `static` keyword that the language has never needed, which is
worth more than the correction: the exercise is as able to invent syntax as to find it missing, and
this document is the thing that caught it.

## What is behind them, which nothing has reported

Every file stops at its first divergence, so none of these has ever been reached by the tool. They
are here because they are written in the tree, not because anything found them:

- `try await for (u8[] chunk in src) { … }` — three packages, and no part of it exists
- `schedule this.pending.push;` — `std/platform`, past the `async` refusal
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

## The grammar file is itself incomplete

`func_decl` has no `type_params`, so by `grammar.md` a generic *function* does not exist. It does:
`T first<T>(T[] xs)` compiles today and `spec/spec/generics.md` documents the feature at length.
So the EBNF is behind the language, and a parser written from it alone would reject working code.

Worth knowing before treating this document as a specification for one: `grammar.md` is the
authority for what it covers and is not complete.

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
`tools/visiondesugar.ts` rewrites each of the nine into the nearest thing today's parser accepts and
parses again, so whatever is *still* refused is a construct nobody has written down. That is the
class both other passes are structurally blind to: one reports rejections and cannot see past the
first, the other checks a fixed list and cannot see a new entry.

Five were reported. **Two survive**, and the other three are the more useful result.

| construct | measured | why it was invisible |
|---|---|---|
| `yield` as a statement | — | every file hit `gen<…>` in the signature first |
| **a generic parent** | `struct Kid : Base<i32>` → `expected '{', found '<'` | five files, each stopped by something above it |

The generic parent is load-bearing: `AllOf`, `AnyOf`, `Generator`, `AsyncGenerator` and `SysTicket`
all need it, and the whole ticket and coroutine design rests on it. Nothing had reported it because
every file that uses it stops at an `async`, a `gen<…>` or a default type argument first.

## The same test, applied to the nine

Three of five falling to *is this avoidable?* is a reason to ask it of the nine, which were found by
refusal and banked without ever being challenged. Five of them are on the vetted pages — `for … in`,
the `gen` return form and an arm without `case` are all in `SHOWCASE.md`, and a default type
argument has a `QUESTIONS.md` entry — so they are the operator's, not mine to withdraw. Four are
mine, and none of the four is withdrawn, but three have an alternative that should be weighed
against them:

| construct | avoidable? | at what cost |
|---|---|---|
| a method with no body | **yes** — a body that traps, measured | the check moves from compile time to run time, on a base whose only purpose is *you must override this* |
| a named union | **yes** — write the members out at every signature | `http` repeats eleven of them; the alternative is what `ResponseFault` exists to stop |
| re-export | **yes** — import from the declaring file | exactly the cost `wac-mono 0072` is open about: `itoa64` exists twice because unifying it touches forty files |
| `async` on a method | **no** | — |

The last row is worth its own line because I nearly withdrew it. `async` on a *free* function
**parses today** — `export async i32 f() { return 1; }` reaches the emitter and fails there with
*a call to Pending* — so my first reading was that `async` is not new at all and the row overstated
things. It does not: `struct S { async i32 f(this) { … } }` is `expected a type`. The row was right,
the generalisation was wrong, and the test that had just been useful three times was about to remove
a correct entry.

**`grammar.md` is behind a second time.** `func_decl` lists no `async` and the parser accepts one,
just as it lists no `type_params` and generic functions compile. Two independent gaps in the file
this document treats as the authority.

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

Three files are still refused and all three are accounted for: `trap` as an **expression**
(`core/result.wac`), a block that ends in a value (`wactest/assert.wac`), and the `secret` parameter
qualifier (`crypto/src/secret.wac`), which is this exercise's own proposal rather than a gap. Both of
the first two are already in [QUESTIONS.md](QUESTIONS.md).

So the tree contains **nine constructs, plus two, plus three known** — and nothing else. That is a
completeness claim the first pass could not make at all.

## It also found errors of mine that are not constructs

`is` binds looser than `&&` and `||` — `is_expr` sits above `or_expr` in the grammar — so
`a is not null && b` is `expected ')', found '&&'` and needs parentheses. Two files wrote the
unparenthesised form, and vision proposes no change to precedence, so they were simply wrong. A
sixth class, after the seven claimed-missing and the one claimed-present: **code that is wrong under
today's rules in a place vision is not changing.** Nothing else would have caught those.

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

One check was written and removed rather than kept: `scheduler`, which was a keyword and is not one
now. The *word* is ordinary English in these files — "the scheduler in force where it was called" is
prose about a concept — so it fired on three comments every run, and a section that is never clean
trains the reader to skip it.

## The `…` is not a construct

A body written `{ … }` means *the same as the original, not repeated here*. It lexes as an
unexpected character and the tool filters it by name. `core` uses a **bodyless** method to mean
something quite different — *must be overridden* — and that those two look alike is
[a question](QUESTIONS.md).
