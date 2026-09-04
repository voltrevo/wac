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

    vision/core/coroutine.wac                      ^ expected '{', found ';'
    vision/core/result.wac                         ^ expected '>', found '='
    vision/core/ticket.wac                         ^ expected '{', found ';'
    vision/core/vec.wac                            ^^^^^ found 'items'
    vision/packages/http/src/fault.wac             ^ expected '(', found ';'
    vision/packages/http/src/request.wac           ^^ found 'Ok'
    vision/packages/json/src/json.wac              ^^^^^ expected ')', found 'parse'
    vision/packages/json/src/parse.wac             ^^^^ expected ';', found 'this'
    vision/packages/json/src/value.wac             ^^^ found 'Str'
    vision/packages/server/src/main.wac            ^^^ found 'Err'
    vision/packages/server/src/serve.wac           ^^^^^^^^^^ found 'Incomplete'
    vision/packages/stream/src/scalars.wac         ^^^^ expected '>', found 'void'
    vision/packages/stream/src/transform.wac       ^^^^ expected '>', found 'void'
    vision/packages/url/src/query.wac              ^^ expected '=', found 'in'
    vision/packages/wactest/src/assert.wac         ^^ found 'Ok'
    vision/packages/wactest/src/test.wac           ^^^^^ found 'async'
    vision/std/platform.wac                        ^^^^^ found 'async'

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
| `async` as a member modifier | `async Read recv(this);` | `wactest/test`, `std/platform` |

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
- `const i64 MAX_BODY = 1 << 20;` at module scope — four packages
- `export union<A, B> Fault;` and `export Slice<u8> Bytes;` — one form for naming a type, whether it
  is a union or an instantiation
- `export { itoa } from "./itoa.wac";` — re-export, which `wac-mono 0072` is already open about
- `T??` and `null as T?` — `url/query.wac`, where a parameter is absent, present with no value, or
  present with a value, and the standard keeps the last two apart. Its `get` returns
  `p.value is null ? (null as u8[]?) : formDecode(p.value!)`, which is the middle state written in
  the position it is actually wanted: an arm of a ternary
- `fn<void()>` as a type — `core/ticket`, replacing today's `fn[void()]`
- `\{…}` interpolation inside a string — `server/main`

## What it cannot see

It finds where vision is **ahead** of today's parser. It is blind to where vision code is **behind a
vision decision** — a spelling that is valid today and that `DECISIONS.md` has already replaced
parses fine, so nothing reports it.

That is not hypothetical. Four match arms in this tree were written `else:`, which is today's
spelling and which `DECISIONS.md` replaced with `default:` — reserving `_` for the payload wildcard,
since reusing it for both would be a pun rather than a generalisation. The tool ran over those files
and said nothing, because there was nothing for it to say.

So the two halves need different instruments: this one for what the grammar adds, and reading
`DECISIONS.md` for what it changes.

## The `…` is not a construct

A body written `{ … }` means *the same as the original, not repeated here*. It lexes as an
unexpected character and the tool filters it by name. `core` uses a **bodyless** method to mean
something quite different — *must be overridden* — and that those two look alike is
[a question](QUESTIONS.md).
