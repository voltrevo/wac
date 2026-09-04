# unicode — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

Only `utf8.wac`, and only its answer type. `case.wac`, `tables.wac` and `printable.wac` are tables
and did not move.

---

## The one change

`decode` answered a `Scalar { i32 code; i32 size; }` where `code` is a code point **or** one of two
negative markers:

```wac
export i32 INVALID()   { return -1; }
export i32 TRUNCATED() { return -2; }
```

A sentinel drawn from the field's own type. Nothing stops `s.code` being read as a code point, and
the caller has to test for both before it may look — **in the right order**, because
`if (s.code < 0)` catches truncation too. `packages/stream` is where that shows: every transform
opens with

```wac
if (s.code == -2) { break; }              // TRUNCATED: hold the tail for the next chunk
if (s.code < 0) { return -1; }            // INVALID: not text, and not this loop's problem
```

and those two lines the wrong way round silently treat a chunk boundary as bad input — dropping the
tail of every chunk instead of carrying it. The comments say which is which, which is what a type is
for.

`union<Scalar, Truncated, Malformed>` says it instead and a `match` is checked. The failures carry
no `size`, because they have not got one to give: `Truncated` means *hold what you have and read
more*, and `Malformed` carries `skip` instead, which is how far to move to make progress.

This was argued for in [`../stream/README.md`](../stream/README.md) before it was written, as *"a
change to `packages/unicode`, so the rewrite of one package immediately wanted a second."* It is
now the second.

## What could not be written

**Nothing new.** Every gap is filed from the earlier packages — this one is small and its finding is
a data type rather than a construct.
