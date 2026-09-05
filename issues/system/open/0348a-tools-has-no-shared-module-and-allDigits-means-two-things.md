# 0348a — `tools/` has no shared module, and one duplicated helper means two different things

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** bug
- **Symptom:** a name that means two things, and 23 copies that could drift the same way

Swept every function body under `tools/` and hashed it. Two counts:

**Fifteen helper bodies are byte-identical across two or more files — 23 redundant copies.**

```
flagOf(Cli, i32, string, i32)     x4   corpusbackings, corpushosts, corpusroutes, corpusstderr
joined(string[])                  x4   mutatenative_test, mutateplan_test, mutateprofile_test, mutatescope_test
versionOf(Cli, string, string)    x3   appletvectors, shfuzz, shvectors
childEnv(Cli, string, string)     x3   corpusbackings, corpusroutes, corpusstderr
rightly(string, i32)              x3   corpusthrough, coverageunion, size
indexOfIn(string[], string)       x3   mutatelocate, mutateplan, mutatetriage
```
plus nine pairs — `askBash`, `padded`, `flagValue`, `hasFlag`, `trim`, `write`, `holds`, `sorted`,
`field`.

**And fifteen more share a name and a signature with a *different* body** (excluding `main`, which is
legitimately per-tool): `askBash`, `field`, `splitOn`, `allDigits`, `linesOf`, `numberOf`,
`packageOf`, `quoted`, `numberOr`, `walk`, `makeFixture`, `read`, `writeOracle`, `contains`,
`trimEnd`.

## The one that is a defect rather than a smell

`allDigits(string s)` exists three times and **one of them accepts commas**:

```wac
tools/wac/coverageunion.wac:59      export bool allDigits(string s)   // digits, non-empty
tools/wac/mutateoperators.wac:215          bool allDigits(string s)   // digits, non-empty
tools/wac/readmefigures_test.wac:433       bool allDigits(string s)   // digits and ',', non-empty
```

The third returns true for `"1,234"`. That is a reasonable thing for a README-figure checker to want
and it is not what the name says, and the name is used for the other meaning twice in the same
directory. A reader who moves a call between these files gets a different answer with no diagnostic.

## And the shared version sometimes already exists

`packageOf(string path)` is written three times — `deadexports.wac:380`, `testchanged.wac:82`,
`testtsclassified_test.wac:57` — as three spellings of the same four lines. Checked: they agree on
every input I could construct, including `"packages/"` and `"packages//x"`. **The point is that
`testchanged.wac`'s is already `export`ed**, so the shareable version existed and two files wrote
their own anyway.

`askBash` and `field` have the same shape from the other side: three copies each, two byte-identical
and one different, so the divergent one is the odd one out rather than the original.

## Why it is filed rather than fixed

`tools/wac/` has no library module. Tools import each other's *specific* exports —
`covledger.wac`'s `Pin`, `Rule`, `measure` are imported by every `cov_ledger.wac` — so the mechanism
works and nobody has made a home for the generic helpers.

Deciding where that home is, is the issue. `tools/wac/lib.wac` is the obvious answer and it touches
about twenty files; splitting by family (`corpus*` share `flagOf` and `childEnv`, `mutate*` share
`joined`, `indexOfIn`, `holds`, `sorted`) is less churn and produces three small modules instead of
one. Picking wrong is cheap to undo, which is why this is a paragraph rather than a patch, but doing
it twice would be waste.

`allDigits` should be fixed first and separately: rename the third one to say what it does. That
needs no decision.

## Notes

Method: parse every `Type name(params) {` under `tools/`, brace-match the body, hash the trimmed
lines, and group by `(name, params, hash)` for copies and by `(name, params)` for drift. Bodies under
three lines are ignored, so the counts are a floor.

`CLAUDE.md` says *"a second copy of anything is a copy that drifts"*. Here fifteen have not drifted
and fifteen have, which is the same population observed twice.
