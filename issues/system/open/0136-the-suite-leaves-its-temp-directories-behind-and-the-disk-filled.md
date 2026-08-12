# 0136 — the suite leaves temp directories behind, and on 2026-08-11 the disk filled

- **Status:** open — the leaks are fixed and swept; what is left is the rule, which is a decision
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-11
- **Kind:** bug
- **Symptom:** no error

## Reproduction

```
$ ls -d /tmp/wac-* | wc -l
2300
$ df -h /
overlay  155G  147G  569M  100% /
```

2,300 directories and files, dating back to 2026-08-04, all created by this repository's own tests
and never removed. `tools/push.sh` failed three times that evening: twice with
`No space left on device (os error 28): tmpdir` mid-suite, once because a build could not write.
Every agent's push is blocked while that lasts.

By prefix, and what makes each:

| count | prefix | who |
|---:|---|---|
| 1,061 | `wac-box-fail-` | `packages/box/test/box.test.ts` — one directory per run, never removed |
| 990 | `wac-profiled-` | `packages/platform/test/subprocess_profile.test.ts` — a 270 KB binary per run, 261 MB |
| ~250 | 20-odd others | tests that remove on the success path and leak when they fail |

## Fixed here

The two that leak on **every** run, which are 89% of the count:

- `box.test.ts` removes `fixtureDir` where it is created, `chmod 600` first because one file in it is
  `chmod 000`. Canaried by taking the removal out: the count goes 1062 → 1063 on one run and stays
  put with it in.
- `subprocess_profile.test.ts` built its subject's binary with `makeTempFile({prefix:
  "wac-profiled-"})` and nothing removed it. It builds beside the subject now — the outer test
  already removes that directory, so the cleanup that exists covers it, which is better than a second
  cleanup that can be forgotten the same way.

Swept away 1,816 entries older than a day, 284 MB — leaving today's, which may belong to a running
suite.

## The long tail is not what this said it was — measured 2026-08-12

The paragraph that stood here said twenty-odd prefixes leak "only when their test fails: the
`Deno.remove` sits after the assertions rather than in a `finally`". That was read off the source
and it is wrong about almost all of them.

The shape nearly every one of those files uses is a module-level temp directory plus an `unload`
listener. Measured, with a probe that registers exactly that and then fails, hangs, or is killed:

| how the run ends | directory |
|---|---|
| normal exit | removed |
| **a failing test** | **removed** — `deno test` exits normally, so `unload` runs |
| SIGTERM | **left behind** |
| SIGKILL | **left behind** |

So the failing-test case, which is what the text claimed, is the one case that already works. What
leaks is a process that is *killed*, and on a machine three agents share that is an ordinary event:
a suite stopped to free a core, a hung run, `push.sh` hitting its own ceiling. No listener runs, and
no amount of `finally` in the test would help — the test is not executing when it happens.

Two of them really did remove after their assertions, and those are fixed here:
`compiler/wacCompile.test.ts`'s `bindgenModule` and `packages/gzip/test/inflate.test.ts`'s FNAME
case, both now `try`/`finally`.

## Fixed here, part two: the sweep

`tools/runTests.ts` removes `/tmp/wac-*` older than a day at the start of every `deno task test`.
A day is far longer than any suite, so the newest thing it can touch is from yesterday and nothing
another agent is *using* matches; `/tmp/wac-doc-warnings` is excluded by name because it is a tally
`docCheck.ts` keeps across a run's processes. It prints one line when it removes anything, because a
cleanup nobody sees is how the count reached 2,300 in the first place.

Canaried: with one stale directory and one stale excluded tally present, a run reports
`swept 1 temp entry older than a day` and leaves a fresh directory and the tally alone.

That bounds the leak at one run's worth per kill rather than for ever, which is the part that was
costing everybody a full disk. It does not stop a test from making the mistake.

## Still a decision: forbidding the direct call

1. **Move each remaining call to a `finally`.** Mechanical, and it leaves the next new test free to
   make the same mistake — and, now that the sweep exists, it buys less than it looks like: what it
   fixes is a directory living until tomorrow rather than for ever.
2. **A helper — `withTempDir(fn)` in `harness/`** — that creates, calls, and removes, so the shape
   is the cleanup, plus a check that no test calls `Deno.makeTempDir` directly.

I would still do 2, and with less urgency than when this was filed. What makes it a decision rather
than work is that 64 test files call `makeTemp*`, most of them correctly and most of them through
the `unload` pattern, which the helper would *not* replace — a directory that must outlive one test
is not a `withTempDir(fn)`. So the rule cannot be "never call it directly" without a second blessed
shape, and a rule with an exception in it is worth less than the churn of applying it to 64 files.

## What this is not

Not the reason the disk was full: 284 MB of 148 GB. The rest is outside this container's tree and is
the operator's. But it is the part that is ours, it grows every suite run on a machine three agents
share, and it is the part a full disk made visible.
