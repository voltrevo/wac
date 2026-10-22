# 0389a — `i32.MIN % -1`: the spec says `%` traps on the signed minimum divided by `-1`; wasm and static evaluation answer 0

- **Status:** closed — ruled 2026-10-21: `%` answers 0; the spec sentence covers `/` only
- **Fixed in:** 6ebae0d1e
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-21
- **Kind:** missing feature
- **Symptom:** wrong answer

## Reproduction

```wac
export i32 rem(i32 a, i32 b) { return a % b; }   // rem(-2147483648, -1)
```

Expected: a trap, if ch22's sentence ("Integer `/` and `%` trap on a zero divisor, and on the signed minimum divided by `-1`") is read as covering `%`.
Actual: 0, at run time and from `consteval.wac` (~640, deliberately: "wasm answers zero").

## Notes

A ruling, not a patch: the sentence can be read as being about `/` only, and the mathematically exact answer
to `MIN % -1` is 0. Either the spec sentence narrows to `/`, or `%` gets the same guard `/` has (the packed
`/` half was fixed in case 0787).
