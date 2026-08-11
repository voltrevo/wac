# 0136 — the suite leaves temp directories behind, and on 2026-08-11 the disk filled

- **Status:** open — two leaks fixed, the long tail is not
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

## Not fixed: the long tail, and why it is a decision

Twenty-odd prefixes leak only when their test fails: the `Deno.remove` sits after the assertions
rather than in a `finally`. Two ways to end it:

1. **Move each to a `finally`.** About 30 call sites across 10 files, mechanical, and it leaves the
   next new test free to make the same mistake.
2. **A helper — `withTempDir(fn)` in `harness/`** — that creates, calls, and removes, so the shape is
   the cleanup. Then the sweep above becomes a check: no test calls `Deno.makeTempDir` directly.

I would do 2, and 1 as its first step for the files that already have a `finally` to move into. What
makes it a decision rather than work is that 104 files call `makeTemp*`, most of them correctly, and
a rule that forbids the direct call has to be worth the churn to whoever is reading a diff of it.

## What this is not

Not the reason the disk was full: 284 MB of 148 GB. The rest is outside this container's tree and is
the operator's. But it is the part that is ours, it grows every suite run on a machine three agents
share, and it is the part a full disk made visible.
