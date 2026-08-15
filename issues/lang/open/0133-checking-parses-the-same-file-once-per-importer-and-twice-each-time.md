# 0133 — checking parses the same file once per importer, and twice each time

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-15
- **Kind:** performance
- **Symptom:** not implemented — the checker has no way to reuse a parse between two files that import the same thing

## Reproduction

`deno task bench:compile`. With `issues/lang/0129` folded, a build is two calls, and `diagnoseGraph`
is now the larger share of what is left: **1,148 ms of `packages/box`'s 3,051 ms**, and 25.3 s of the
repo's cold build.

Its cost is a multiplier, and the multiplier is the file count. Timing `diagnoseFiles` (the entry
alone) against `diagnoseGraph` (every file checked as an entry):

| program | files | `diagnoseFiles` | `diagnoseGraph` | |
|---|---:|---:|---:|---:|
| `packages/json` | 11 | 9 ms | 23 ms | 2.5x |
| `packages/wacc` | 15 | 61 ms | 346 ms | 5.6x |
| `packages/box` | 170 | 56 ms | **1,160 ms** | **20.9x** |

## Notes

Two independent causes, and they multiply.

**Every check parses its closure twice.** `checkFiles` runs one loop to size its tables —
`declCap = declCap + declarationsIn(csrc, clexed, parseProgram(cp))` — and a second to do the work,
lexing and parsing every file both times.

**Do not "just over-estimate" it.** That is the obvious fix and both cheap versions of it have
already been tried and reverted, which the comment above the loop records: sizing from the entry's
own token count was too small, so a small file with a large closure ran out of room *silently* and
answered "no such field" about correct code (`issues/lang/0098`); sizing from the closure's tokens
fixed that and cost **230 MB** of peak resident set, because a token is the wrong unit for a table
of declarations (`issues/lang/0099`). The exact count is what it is for a reason.

Two shapes that respect that history:

- **Keep the count, drop the parse.** `declarationsIn` walks the AST, but what it is counting —
  declarations, fields, methods, type parameters — is visible in the *token stream*. A scan that
  lexes and counts without `parseProgram` would give a number in the right unit, slightly loose
  rather than exact, which is safe in the direction that matters. Whether that pays depends on what
  lexing costs against parsing, and nothing here has measured the two apart.
- **Keep the parse, reuse it.** Hold the `Program`s from the sizing pass and hand them to the second
  loop. Costs memory in proportion to the closure, which is the direction `issues/lang/0099` got
  burned in, so it wants measuring before building.

**The per-file loop re-parses what the last file already parsed.** `diagnoseGraph` calls `checkFiles`
once for each file, handing it that file's import closure. The closures overlap almost entirely —
in `packages/box`, `std` is reached by nearly everything — so a core file is lexed and parsed twice
for every file that imports it, hundreds of times in one build.

The per-file loop is not the mistake and should not be undone. Its comment says why it exists, and
it is right: checking each file against the whole list cost `n ×` a full parse, and *"a file cannot
be affected by a file it does not reach"*. What it does not address is that the closures share
nearly all their members, so the redundancy moved rather than went away.

The fix is the same shape as 0129's: parse each file **once**, then check each closure against
programs already parsed. `checkFiles` currently takes `(paths, sources, entry)` — raw text — which
is exactly the API shape that made 0129 what it was. A version taking already-parsed programs would
let `diagnoseGraph` parse 170 files once instead of parsing 170 closures twice apiece.

Worth roughly a third of a build if both halves land, which makes it the largest single item left
in compile time. `issues/lang/0129` has the pattern, the differentials used to gate that fold —
hash every emitted module, compare every description across all 79 programs — and the measurements
to compare against.
