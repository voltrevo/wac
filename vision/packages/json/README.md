# json — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/json`: 1,237 lines over four files. `stringify.wac` is not rewritten
because nothing in it changes.

---

## The question this package was chosen for

**Should `JsonValue` be a `union` rather than an `enum`?** JSON is the canonical *any of several
types*, so it is where a union should win if it ever does. It does not, and `vision/IDIOMS.md`'s own
test says why without needing a judgement call:

- **It wants methods.** `asStr`, `get` and `at` are true of the whole family, and an enum is the
  only thing that can host them. A bare union has nowhere to put a method.
- **The members do not stand alone.** A JSON number is not an `f64`; it is an `f64` *and the bytes
  it was written as*, because `1e2` has to come back as `1e2` and `-0` has to keep its sign. Once a
  member carries something of its own, it exists only as an alternative of the whole — which is the
  definition of an enum.

A union would also have needed primitives as members, which is still open, and would have boxed the
two hottest cases in the format this repository parses most. So the open question is not blocking
here, and the answer to *what would a union be for* is still nothing concrete.

## What changed

**The reason is the answer.** `parse` returned `JsonValue?` and left the reason on the parser:
`p.err`, one of eleven exported `i32` functions, and `p.errPos`. A caller that forgot to look got
"not JSON" for a document that was three bytes short. It is `Result<JsonValue, ParseError>` now, and
`ParseError` carries both, so the position cannot be dropped and the reason cannot be read off a
parser that has since been reused.

**Eleven `i32` constants became eleven cases.** They were functions returning literals —
`ERR_DEPTH()` is `7` — because that was the only way to name a constant. As cases they cannot be
compared against a position, cannot be added up, and a `match` over them is checked.

**`Canonical` is gone.** It was `(bool ok, i32 err, i32 errPos, u8[] text)`: a `Result` assembled by
hand, three of whose fields mean nothing when `ok` and one of which means nothing when it is not.

**`JsonArray` is gone** — forty lines of hand-rolled `Vec` that existed because two instantiations
of a generic collapse when a type argument is an enum, emitting invalid wasm
(`issues/lang/closed/0047`). The bug is closed; the workaround outlived it. `Vec<JsonValue>` now.

(`packages/json/src/value.wac:43` cites `0046`, which is *an unknown type name in a declaration or a
cast is not reported as unknown* — a diagnostic issue. `0047` is the one it means: same claim, kind
*bug*, symptom *invalid wasm*. This README repeated the wrong number until the issue was read rather
than the comment. **Left unfixed in the source**: `json` is in the seed graph, so a one-character
comment change stales every agent's seed, which is out of proportion. It should ride along with the
next real change to that file, as `core/vec.wac`'s understated retention comment should.)

**`JsonObject`'s `JsonMember?[] slots` plus `i32 count` became a `Vec<JsonMember>`.** The `?` was
there so the array could be allocated at all — a non-defaultable element type has no value to fill
with — and `Vec.push` supplies the value being pushed as the fill, so the nullability was paying for
something the container already solves.

**`JsonObject`'s lazy index is untouched, deliberately.** Ordered members with duplicate keys
preserved, an index built only after 32 members and 15 lookups, both numbers measured. None of that
is language, and a rewrite that quietly improved it would be claiming credit the language is not
owed.

**`Option` is not imported.** `T?` does the job and `core/option.wac` does not exist here.

**`try` carries the parser.** `try this.value()` inside `array()` and `object()` replaces the
check-a-flag-and-return-null-and-hope-the-caller-looks pattern at every recursive call. That is most
of what shrank.

## What could not be written

(A generic method whose type parameter comes only from the return type was listed here as an open
question and is not one. `generics.md` `[§wacc-written-type-args]` settles it: inference is
argument-directed, a slot does not determine a call's type parameters, and the fix is to write the
argument — `this.fail<JsonValue>(Reason.Eof)`, as `Vec<T> empty<T>()` is called as `empty<i32>()`.)

**Two spellings of an elided body.** `core` uses a bodyless method to mean *must be overridden*;
this file needs *written out in the original, not repeated here*, and uses `{ … }` because the
SHOWCASE entries do. Both are needed and neither is described.

(`const i32 MAX_DEPTH = 512;` at module scope was listed here as a gap and is not one — the
grammar has `const_decl` in `program` and it compiles today.)

**Nothing here needed a coroutine.** A token generator was the obvious thing to try and recursive
descent wants one token of lookahead, which a `Generator<Token, R>` does not offer. A `Peekable<T>`
would fix it and would be the third container this exercise has asked `core` for; a parser reading
bytes off a struct is not worse, so it stays. Worth recording as a place the coroutine model has no
pull rather than pretending it does.
