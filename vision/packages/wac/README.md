# wac — one slice rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/wac`: 8,973 lines over 27 files — the `wac` command itself. **One
function is rewritten**, and how it was chosen is half the point.

---

## Found by looking for the longest argument

[../../QUESTIONS.md](../../QUESTIONS.md) has an entry saying that six times over, the place a
package argues hardest has been the place a type would have said the same thing. This slice was
picked by running that as a **search** rather than reading it as an observation: every doc comment
of 150 words or more in the un-rewritten packages, sorted, mid-file only — 52 of them.

The second-longest, and the longest that argues for a *representation*, is
`packages/wac/src/wac.wac:217`, 359 words on `buildCachePath`. Its first line:

> Where this build's artefact would be cached, **or `""` when it must not be**.

The method works. It is worth saying that it also produced a list where the top entries are file
headers — orienting prose, which is long for a good reason — so the filter that matters is
*mid-file*, where a comment is defending one decision rather than introducing a subject.

## Nine reasons, one empty string

The function has **nine `return "";` sites** and every one is a different reason:

| | why not cached |
|---|---|
| 1–2 | `test` with no target, `app` with no stem — no name to key on |
| 3 | not `build`, or `build` with no `-o` |
| 4 | `--coverage` or `--trace` — the build writes a table this cache does not hold |
| 5 | `--no-cache` |
| 6 | an unknown flag, because keying an unvalidated command line let `wac build --nonsense` pass on a warm cache |
| 7 | `$WAC_BUILD_CACHE_KEEP` is zero |
| 8 | no `$WAC_HOME` |
| 9 | the host did not say which compiler this is |

Each was added after being bitten — the doc records the measurements: `wac run p.wac --check` at 803
then 822 ms because `--check` read as an unknown flag; a self-build back in 160 ms with the bound at
zero; `wac app` recompiling identically a moment after itself.

**And a hit is reported while a miss is silent.** `wac.wac:1463` logs
`"<name>.wasm: N bytes from cache"` when it works. When it does not, nothing is said. So a person
asking *why is this recompiling every time* has nine candidates, no way to ask, and one lever —
`$WAC_BUILD_CACHE_KEEP` — which is one of the nine.

That is the payoff of a reason being a value, and it is not hypothetical. `tools/push.sh` sets that
variable around the fixpoint rounds, and the paragraph in `CLAUDE.md` explaining why the honest
bootstrap figure is 27.2s rather than 12.2s is prose somebody had to write because the tool could
not say it.

## What else changed

**Eight parameters become one `Build`.** `(Cli cli, i32 argc, string cmd, string entry, string[]
paths, string[] texts, string stem, string target)` — four strings in a row, and `paths`/`texts` are
the parallel-array pair this exercise keeps meeting: same length by convention, indexed together in
one loop, nothing saying so. `@/packages/regex` decided to *keep* that shape for its character
classes and had a measured layout reason; there is none here.

## What could not be written

**The nine reasons are not disjoint and nothing orders them.** A `wac run --coverage` with no
`$WAC_HOME` and an unknown flag is three of them at once; the shipped code returns at the first, so
which one a caller sees is the order the checks are written in. For a *diagnostic* the useful answer
is all of them — fixing one and recompiling to find the next is the loop this is supposed to end.
`Result` has one `Err`, and a union of one-or-more is not a shape this language has.

**`--no-cache` serves two callers with opposite needs.** `packages/wacc/test/wac/selfhost_test.wac`
builds wacc twice and requires byte equality — *"served from cache that is one file compared with
itself"* — and `bootstrap.sh`'s fixpoint loop is the same shape. Both are *a build that must prove
something about the compiler*. A person turning the cache off because they suspect a stale hit is
not that, and the two want opposite things from a warning: silence, and a line. One arm covers both,
and splitting it would invent a distinction nobody has asked for — recorded rather than taken.

**A cache path is a `string`.** `home + "/cache/build/" + h.hex() + ".wasm"`, assembled here and
taken apart by whoever reads it. Neither `@/packages/fs` nor `vision/std` has a path type, and every
package in this exercise that touches the filesystem has built one with `+` — four now. It is the
same request as a refinement of an integer, one layer up, and this is the place where the shipped
tree's own vocabulary — `stem`, `baseName`, `outStem` — is already a set of operations with no type
under them.
