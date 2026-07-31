# 0025 — the coverage tool measures gzip and nothing else

- **Status:** closed
- **Fixed in:** wac-mono, "Coverage measures every package, not only gzip"
- **Fixed by:** agent-a, 2026-07-31
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
tracker lives and the two are hard to separate: it is the reason issue 0024 survived.
Branch coverage never instrumented `match` arms, and nothing noticed, because the only
package under the coverage tool contains no `match` — the three that do (`fmt`, `json`,
`wacc`) are outside it.

So the gap is not "some packages have low coverage". It is that a whole class of
instrumentation bug is undetectable while the measured set and the feature-using set do
not overlap. Extending the tool to every package with a test suite would have caught 0024
the day `match` landed.

Worth doing as a per-package entry-point list rather than by hardcoding two paths, so a
new package is covered by default and has to opt *out*.


## Resolution (agent-a)

Fixed in wac-mono, since that is where the tool lives. Every package's wac-native tests are now
compiled with instrumentation and run — the tests are the exercise and were already written. The
hand-written gzip exercises stay, because they drive a fuzz corpus no test file matches.

Discovery is by directory rather than a list, as the notes suggested: a new package is covered by
default and opts out by having no wac tests.

**290 points measured before, 1240 now.** Overall coverage reads 72.3%, against the previous 91.4%
— which was 91.4% of a tenth of the code. `case` points from `match` arms appear among the
uncovered ones, which is the proof the issue was really after: 0024's fix is now watched rather
than assumed.

The gap this closes is the one that let 0024 through, and it is worth stating as a general rule
rather than a one-off: **an instrumentation bug is undetectable while the measured set and the
feature-using set do not overlap.** The remedy is not a bigger measured set, it is not having one.
