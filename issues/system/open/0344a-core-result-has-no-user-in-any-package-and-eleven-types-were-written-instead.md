# 0344a — `core/result.wac` has no user in any package, and eleven types were written instead

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** design decision
- **Symptom:** none — a `core` type nothing imports, and the reason is worth deciding rather than discovering

Counted over `packages/*/src`, excluding comments and `packages/wacc/src/coretext.wac`'s string
literals:

| `core` export | files | code lines |
|---|---:|---:|
| `Vec<T>` | 47 | 439 |
| `Read` | 26 | 89 |
| `Map<K, V>` | 6 | 22 |
| `hashString`, `stringEq` | 5 | 14 |
| `bytesEq` | 4 | 12 |
| `Option<T>` | 2 | 10 |
| `hashBytes` | 1 | 2 |
| `hashI32`, `i32Eq`, `hashI64`, `i64Eq` | 0 | 0 |
| **`Result<T, E>`** | **0** | **0** |

`core/result.wac` landed 2026-08-18 and is one of the nine files carried inside the compiler as
`coretext.wac`, so every program compiled since has had it embedded. **Thirty-eight source files
under `packages/*/src` have been created since, and not one imports it.** The only place the word
appears in production code is `packages/ssh/src/sshd.wac:922`, which declares its own
`struct Result { u8[] out; u8[] err; i32 status; }`.

`Option`'s low number is explained — `T?` is the language's own and does its job. Nothing in the
language does `Result`'s.

## What was written instead

Eleven exported result types across nine packages, in three designs:

```
http/request.wac     Parsed          enum    Ok(Request) / Bad(i32 code) / Incomplete
http/incoming.wac    ParsedResponse  enum    Ok(Incoming) / Bad(i32 code) / Incomplete
git/commit.wac       Parsed          enum    Understood(Commit) / Malformed(string why)
git/commit.wac       ParsedTag       enum    Annotated(Tag) / Unreadable(string why)
abi/abi.wac          Decoded         struct  {bool ok; Value[] items; string error} + of(…)
rlp/rlp.wac          Decoded         struct  {bool ok; Item item;      string error} + of(…)
datetime/rfc3339.wac Parsed          struct  {bool ok; …} — "the fields are then meaningless"
wac/grants.wac       Parsed          struct  {Asked asked; i32 at; string bad}
wacc/wapyparse.wac   WParsed         struct  seven fields, errors a flat i32[] and a count
ssh/sshd.wac         Result          struct  {u8[] out; u8[] err; i32 status}
json/parse.wac       Parser          struct  a code on the parser, entry points answer T?
```

`abi`'s and `rlp`'s are `{bool ok; T value; string error}` with a static `of`, written independently
in two packages twelve days before `core/result.wac` existed — `Result<T, string>` with the
parameters filled in by hand.

## Why it is a decision rather than a deletion

`CLAUDE.md` says *when nothing needs a thing, delete it*, and *if you find yourself proposing to keep
something, say what would break, and check that it is not just a test you could edit.* Answering
that honestly: deleting `core/result.wac` would break `core/test/option_test.wac`'s
`test_result_basics` and `test_result_error_type_varies`, two cases in `core/test/traps_test.wac`
(lines 69 and 93), a section of `core/README.md`, the import-resolution fixtures in
`packages/wacc/test/wac/mappedspec_test.wac` that use it precisely because it imports `./option.wac`
relatively, and the `gen:core` file list. All of them are edits. **By the rule as written, it
goes** — and the `mappedspec_test.wac` one is worth naming separately, because that test does not
care about `Result` at all: it needs *a file in the embedded set whose own import is relative*, and
it would want a replacement rather than a deletion.

The argument against is not that something breaks. It is that the reason for the zero is a *missing
propagation form*, not a wrong type: a `Result` that cannot be propagated is a `match` at every call
site, and two authors priced that after it existed and declined —
`packages/wacc/src/wapyparse.wac`, a parser whose errors are a flat `i32[]` and a count, and
`packages/wac/src/grants.wac`, created 2026-08-25, whose `Parsed` carries `string bad`. The same
price is what `packages/tls/src/wire.wac` and `packages/zstd/src/frame.wac` pay by trapping and what
`packages/ssh/src/wire.wac` and `packages/fs/src/wire.wac` pay by latching a sticky flag.

So deleting it removes the thing eleven types are approximating, and keeping it leaves an export in
`core` that the tree has voted against for eighteen days. Three answers, and picking wrong is cheap
to undo only before someone builds on it:

1. **Delete it.** Honest about today; makes the eleven permanent.
2. **Keep it and say why in `core/README.md`** — that it is waiting on a propagation form, with a
   pointer to whatever tracks that. Costs nothing and stops the next reader re-deriving this count.
3. **Keep it and add the propagation form**, which is `issues/lang/` territory and much larger.

## Notes

Also found by the same sweep and not part of this: `hashI32`, `i32Eq`, `hashI64` and `i64Eq` are
used only by `core`'s own tests. They exist because `Map<K, V>` takes a comparator pair per key type
and six files use `Map`, so that zero is a library sized for a type with few users rather than a
type nobody can use — a different finding, and not one that needs a decision.

The first version of this count said `hashBytes` was zero. It matched `hashBytes\s*\(` and
`packages/json/src/value.wac` passes it as a **funcref** — `Map.withCapacity(this.count, hashBytes,
bytesEq)` — so a call-shaped pattern under-counts exactly the values a language passes as functions.
Corrected by grepping the name.
