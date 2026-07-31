# 0021 — branch coverage did not instrument match arms

- **Status:** closed
- **Fixed in:** this commit
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** wrong answer, no error

## Reproduction

Compile with `{ coverage: true }`:

```wac
enum E { A(i32 v), B, C }
export i32 pick(E e) {
  match (e) { case A(v): return v; case B: return 2; else: return 3; }
}
```

Expected: three arm counters, as the equivalent `switch` gets.
Actual: none. The whole statement contributed only the function's `entry` point, so the
match reported as fully covered however many arms never ran.

## Notes

Found by asking what a fourth probe round had not covered — the coverage instrumentation
is my own tooling and had never been pointed at `match`. `emitSwitch` emits a `case` point
per clause and a `default` point; `emitMatch` emitted none, because it was written after
the instrumentation and nothing connected the two.

The consequence is worse than a missing feature. Coverage exists to say what has *not*
been exercised, so under-reporting is the one failure mode that cannot be noticed by
looking at the output — a match with three untested arms and a tested `if` beside it reads
as 100%.

**Correcting my own commit message**, which said `packages/wacc` and `packages/gzip` both
had overstated numbers. Neither is true. `gzip` uses no `match` at all — it predates the
feature — and wac-mono's coverage tool instruments only the two gzip entry points, so it
has never measured a file containing one. The packages that do use `match` are `fmt`,
`json` and `wacc`, none of which the tool covers. So no number anyone has looked at was
wrong; what was wrong is that any number produced for those packages would have been,
silently.

That mismatch is a second gap worth naming: **the coverage tool measures gzip and nothing
else**, which is why this bug survived. Filed as 0022.

Fixed by emitting a `case` point per variant arm and one for the `else` arm, matching what
`switch` does. The test runs one arm, checks exactly one counter moved, then runs the rest.
