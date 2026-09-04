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

## What the tool reports

    vision/core/coroutine.wac                      ^ expected '{', found ';'
    vision/core/queue.wac                          ^^^^^^ expected '(', found 'create'
    vision/core/result.wac                         ^ expected '>', found '='
    vision/core/ticket.wac                         ^ expected '{', found ';'
    vision/core/vec.wac                            ^^^^^^ expected '(', found 'create'
    vision/packages/http/src/fault.wac             ^ expected '(', found ';'
    vision/packages/http/src/request.wac           ^^ found 'Ok'
    vision/packages/json/src/json.wac              ^^^^^ expected ')', found 'parse'
    vision/packages/json/src/parse.wac             ^^^^ found 'json'
    vision/packages/json/src/value.wac             ^^^ found 'Str'
    vision/packages/server/src/main.wac            ^^^ found 'Err'
    vision/packages/server/src/serve.wac           ^^^^^^^^^^ found 'Incomplete'
    vision/packages/stream/src/scalars.wac         ^^^^ expected '>', found 'void'
    vision/packages/stream/src/transform.wac       ^^^^ expected '>', found 'void'
    vision/std/platform.wac                        ^^^^^ found 'async'

Eight distinct constructs, in the order a parser would meet them:

| construct | example | where it bit |
|---|---|---|
| a `static` method | `static Vec<T> create() { … }` | `vec`, `queue`, `json/parse` |
| a method with no body | `bool settled(const this);` | `ticket`, `coroutine` |
| a default type argument | `enum Result<T, E = union>` | `result` |
| a named union declaration | `export union<A, B> Fault;` | `http/fault` |
| a match arm without `case` | `Ok(request): { … }` | `request`, `value`, `main`, `serve` |
| the `gen` return form | `gen<i32> void scalars(…)` | `stream` ×2 |
| `async` as a member modifier | `async Read recv(this);` | `std/platform` |
| `try` in expression position | `writeOut(try parse(src))` | `json/json` |

## What is behind them, which nothing has reported

Every file stops at its first divergence, so none of these has ever been reached by the tool. They
are here because they are written in the tree, not because anything found them:

- `try for (u8[] chunk in src) { … }` — three packages, and it does not exist at all
- `schedule this.pending.push;` — `std/platform`, past the `async` refusal
- `defer { conn.close(); }` — `server/main` and `core/ticket`
- `const i64 MAX_BODY = 1 << 20;` at module scope — three packages
- `T??` and `null as Node?` — `TECHNICAL.md` only, no package has needed one yet
- `fn<void()>` as a type — `core/ticket`, replacing today's `fn[void()]`
- `\{…}` interpolation inside a string — `server/main`

## The `…` is not a construct

A body written `{ … }` means *the same as the original, not repeated here*. It lexes as an
unexpected character and the tool filters it by name. `core` uses a **bodyless** method to mean
something quite different — *must be overridden* — and that those two look alike is
[a question](QUESTIONS.md).
