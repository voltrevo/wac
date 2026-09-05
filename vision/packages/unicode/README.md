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

**~~Nothing new.~~** That was true of `utf8.wac`, which was the whole package here until 2026-09-05.
The three files it skipped are the **generated tables**, and they hold the largest instance in the
repository of the shape this directory has counted most.

**Three constant maps, six arrays, and the pairing is a parameter.** `src/tables.wac` is *"Generated
by tools/gentables.ts. Do not edit."* — 65 KB of literals, `LOWER_KEYS`/`LOWER_VALUES` at 1,459 pairs,
`UPPER` at 1,450, `FOLD` at 1,481. The binary search is written **once**, which is the sharper version
rather than a mitigation: `lookup(i32[] keys, i32[] values, i32 cp)` takes two arrays that must be the
same length in the same order, three such pairs exist, and `lookup(LOWER_KEYS, UPPER_VALUES, cp)`
compiles and answers plausible nonsense. 4,390 pairs, and the first time the pair is passed **through
a signature** rather than held in a struct.

**A constant map is not a thing, and three generated files are the workaround.** `unicode/tables.wac`,
`unicode/printable.wac` and `raster/font16.wac` are the only files in `packages/` headed *"Generated
by"*, and all three are parallel key/value arrays with a search: **five logical maps, eleven arrays.**
None can be a `Map<i32, i32>` — not because `Map` is missing but because a `Map` is *built*, and 1,459
insertions at module start is work a constant does not need.

**And the generator is the caller nobody consulted.** The shape is written by a TypeScript program, so
`../../README.md`'s *name a caller and say what it would do differently* is vacuous here — the caller
does what it is told. **A generated file is the one place a representation can be changed without
asking anyone**, and it is where three of the largest parallel-array cases in the repository live.

**A simple mapping is `i32 -> i32` and a full one is `i32 -> Bytes`, and the signature cannot say
which.** `toUpper` answers `cp` for the code points Unicode maps to several — a value in the range,
indistinguishable from *already uppercase*. The only statement of that is the generated header.

**The two generated files are two shapes in one representation.** `tables.wac`'s pairs are
*(key, value)* and its search returns on a hit; `printable.wac`'s are *(first, last)* and its search
runs to exhaustion, keeps the last candidate and then checks its end. Identical array shapes, opposite
queries — so one `Entry` type serves one of them, `src/printable.wac` has a `Range` instead, and
neither search is shareable: the second is *predecessor*, not *find*, and `core` has no name for
either.

**And `printable.wac` says why it is a separate file, which is a linker fact.** *"Kept apart from
`tables.wac` on purpose: a module's constant arrays are all emitted when it is linked, so sharing a
file would make every caller of `isPrintable` carry the case tables too."* A **file boundary standing
in for dead-code elimination** — the unit of inclusion is the module, so one logical package is split
across two files to keep 65 KB out of programs that only ask *is this printable*. Nothing expresses
*include this constant only if reached*, and nothing measures the cost of getting the split wrong.

**And the first draft of `src/case.wac` dropped four of the six exports** — `mapAll`, `lowerAll`,
`upperAll`, `foldEqual` — because the scalar three are what the *table* rewrite needed and the
per-string ones are what the *package* has. That is `../../QUESTIONS.md`'s *a rewrite drops what its
own callers did not happen to want*, written the same afternoon, reproduced within the hour by its
author. The method-level diff built for that entry would not have caught it either: these are free
functions in a file and that instrument walks types.
