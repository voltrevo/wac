# 0115 — wacc's coverage entry points carry no position, so all of a package's collapse into one and an uncalled function is invisible

- **Status:** closed
- **Claimed by:** agent-b
- **Closed:** 2026-08-13
- **Fixed in:** the commit closing this
- **Reported by:** agent-a
- **Date:** 2026-08-13
- **Kind:** missing feature
- **Symptom:** wrong answer

## Reproduction

Two functions. One is called.

```wac
export i32 called() { return 1; }
export i32 neverCalled() { return 2; }
```

```ts
const p = await instrument("never.wac");
(p.mod.called as () => number)();
report([p], dir, { verbose: true });
```

    REFERENCE   1/2 covered; missed 1
                  never.wac:2:1  entry          ← "neverCalled was never called"

    WACC        1/1 covered; missed 0
                  | never.wac | 1 | 1 | 100.0 |

**A function nothing calls is not reported, and the percentage reads 100.**

## Why

Every `entry` point wacc emits has `line` 0, `col` 0 and the *entry file*'s name rather than the
file the function is in. Measured over `packages/fs`'s probe:

    WACC       470 of 1716 points have no position   {"entry": 470}
               all attributed to packages/fs/test/wac/cov_probe.wac
    REFERENCE    0 of 1422

`report` in `harness/wacCoverage.ts` merges per `(file, line, col, kind)` — deliberately, so a file
reachable from two entry points is not counted twice. With no position, every entry point in the
program shares the key `<entry file>:0:0:entry`, so they become **one** point, covered as soon as any
function anywhere has run:

    packages/json/src/json.wac
      REFERENCE:  689 raw points -> 689 distinct keys;  146 entry points -> 146 distinct
      WACC:       908 raw points -> 763 distinct keys;  146 entry points ->   1 distinct

145 of json's 146 "was this function ever called?" measurements do not exist. The arithmetic checks
out exactly — 908 − 145 = 763 — which is what says this is the whole of the difference and not a
sample of it.

The second consequence is misfiling. `report` filters by `p.file.startsWith(prefix)` so that a
package's number does not claim its dependencies' coverage. Entry points all name the entry file, so
`packages/bytes`'s and `packages/std`'s function entries are counted as belonging to whichever
package's probe pulled them in.

## What this is not

Not [0112](0112-waccs-coverage-instrumentation-omits-match-arms-and-ternaries.md), which is fixed:
`case` and both ternary sides are emitted now and match the reference exactly — 125, 158 and 158 for
the same file. This is the same *failure mode* as that issue reached through a different mechanism:
not a missing kind, a missing position. Both make a ratchet report a better number for measuring
less, which is the thing a coverage number cannot show you.

It is also not the reason `entry` counts differ by four. 470 against 474 looks like a rounding
difference and is not — the sets barely overlap, because one side has real positions and the other
has none.

## What would fix it

Give an entry point the file and line of the function it belongs to, as `covTableFiles` already does
for `then`, `loop`, `case` and the ternary kinds. The information is present — every other kind has
it — so this is a field not being filled rather than one that has to be derived.

**A test that would have caught it**, and which should land with the fix: instrument a file with each
compiler and assert that no point has line 0, and that the number of distinct `(file, line, col,
kind)` keys equals the number of points of each kind. A count of points is not enough — 908 raw
points looked healthier than the reference's 689 while carrying 145 fewer measurements.

## Standing on

`harness/wacCoverage.ts` uses wacc for every package as of 2026-08-12
([0111](0111-the-reference-compiler-lacks-the-bit-methods-wacc-has.md)), so this is live in every
`deno task coverage:<pkg>` and in the `coverage:all` the gate reports. `WAC_COV_FROM=reference` still
measures the old way, which is how the two columns above were taken.


## Fixed

`emitFunction` took `covPoint(insns, env, "entry", 0, 0)` because it had no token to take a position
from; it takes the function's **name token** now, threaded from the six call sites that already had
it — plain functions, struct and enum methods, and the three generic-instantiation paths. The
issue's own reproduction:

```
never.wac:1:12 entry  count=1
never.wac:2:12 entry  count=0        <- neverCalled, visible as such
```

The column is the name's rather than the declaration's, which differs from the reference's `2:1`.
Nothing compares columns across compilers — every merge is within one run — and the name is where a
reader looks for which function it is.

**What it unblocked immediately.** `packages/fs`'s `remoteSetExecutable` category had been reporting
*matches no uncovered point — delete it or fix it* since the switch. It was not stale: the function's
only distinguishing point is its entry, every entry point in the program had collapsed into one, and
the category keyed by the declaration's text had nothing to match. It matches again, and `fs` passes.
That is the second time this shape has appeared in as many issues (`0112` was the first), and both
times the ledger was right and the instrument had stopped looking.

`coverage:all` under wacc: **18 of 19**, up from 16. Only `crypto` is left — see `0112`.
