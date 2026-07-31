# 0022 — the coverage tool measures gzip and nothing else

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Symptom:** wrong answer, no error

## Reproduction

`wac-mono`'s `tools/coverage.ts` instruments exactly two entry points:

```
packages/gzip/src/gzip.wac
packages/gzip/src/inflate.wac
```

`packages/bytes` is measured only incidentally, because gzip imports it. `fmt`, `json`,
`crypto`, `wactest` and `wacc` are not measured at all.

## Notes

This is a wac-mono issue rather than a compiler one, filed here because that is where the
tracker lives and the two are hard to separate: it is the reason issue 0021 survived.
Branch coverage never instrumented `match` arms, and nothing noticed, because the only
package under the coverage tool contains no `match` — the three that do (`fmt`, `json`,
`wacc`) are outside it.

So the gap is not "some packages have low coverage". It is that a whole class of
instrumentation bug is undetectable while the measured set and the feature-using set do
not overlap. Extending the tool to every package with a test suite would have caught 0021
the day `match` landed.

Worth doing as a per-package entry-point list rather than by hardcoding two paths, so a
new package is covered by default and has to opt *out*.
