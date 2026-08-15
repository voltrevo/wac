# 0158 — JSON numbers outside Clinger's window cost 11x, at a cliff rather than a slope

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-15
- **Kind:** performance
- **Symptom:** wrong answer — `deno task bench:json`'s slowest shape by 5x is a number shape, not a string or object one

## Reproduction

`deno task bench:json` reports `exponent-form numbers` at **8.1 MB/s** where `small integers` is
107.1 and `simple decimals` 89.8 — 123 ms against 14-17 ms for the same megabyte. It is the slowest
row in the benchmark, slower than nested structure, escapes and multi-byte UTF-8.

The shape is `corpus("1e10,2.5e-8,3.75e100,-1.25e-300")`. Two of those four are inside the fast
path's `|exponent| <= 22` window and two are not, so the row is an average of two populations.
Splitting it (1 MiB per corpus, warmed, mean of 3):

| corpus | MB/s | ms |
|---|---:|---:|
| `1e10,2.5e-8` — inside +-22 | 35.0 | 28.5 |
| `3.75e100` | 8.6 | 116.0 |
| `-1.25e-300` | 3.8 | 265.5 |

Per *number* rather than per byte, since the tokens differ in length: **0.18 µs** inside the
window, **1.0 µs** at e100, **2.8 µs** at e-300 — 5.6x and 16x.

## Notes

I expected the cost to scale with the exponent, since each exact comparison cross-multiplies by
`10^|exp|` and the bigint grows with it. It does, but that is the small term. Sweeping one mantissa
across the range:

| corpus | MB/s |
|---|---:|
| `1.25e-10` | 79.2 |
| `1.25e-50` | 7.1 |
| `1.25e-100` | 6.6 |
| `1.25e-200` | 4.9 |
| `1.25e-300` | 3.5 |
| `1.25e+100` | 8.1 |
| `1.25e+300` | 5.8 |

**It is a cliff, not a slope.** Crossing the fast-path boundary costs 11x (79.2 -> 7.1); the next
250 decades cost 2x in total. So the expensive thing is reaching the bignum at all, not how wide
the bignum gets — which means widening the window or shrinking the limbs both address the small
term. Negative exponents are consistently worse than positive at equal magnitude (3.5 against 5.8
at +-300), which fits: the scaling lands on the other side of the comparison.

The gap Eisel-Lemire fills, and `packages/fmt/README.md` is already most of the way to the argument
for it — the estimate that brackets the bisection is described there as able to "cost time, never
correctness", which is exactly the contract a 128-bit-multiply tier would have. It would need a
`u64 x u64 -> u128` multiply, which wasm has no instruction for, and a table of 128-bit powers of
ten (~617 entries), which is the reason this is filed rather than fixed: it is a day of work in a
package other things depend on, not an afternoon.

Not urgent for the packages here — `1e10` and `2.5e-8` take the fast path, and ordinary JSON is
full of those and empty of `1.25e-300`. It matters for anything parsing scientific data, and it is
worth knowing that the benchmark's headline number for this row is an artefact of a corpus that
mixes both populations 50/50. Splitting that row into two would make the benchmark say what it
means, and is a five-minute change if nobody does the rest.
