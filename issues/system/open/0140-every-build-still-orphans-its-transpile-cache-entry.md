# 0140 — every build still orphans its transpile cache entry, and 0068 was closed with the mop

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-12
- **Kind:** bug
- **Symptom:** the shared disk fills; writes then fail for every agent at once

## Reproduction

```
$ du -sh ~/.cache/deno/gen
6.8G
$ du -sh ~/.cache/deno/gen/file/tmp
6.2G
```

7,133 of those entries had **no surviving source**, totalling 6.51 GB, against 40 MB that could
still be hit — on a disk with 13 GB free. Dropping them took it to 19 GB free.

That is the same measurement
[0068](../closed/0068-the-deno-transpile-cache-grows-without-bound-and-filled-the-shared-disk.md)
took on 2026-08-05 (23 GB, 25,482 of 25,490 orphaned) and again the same evening (6.4 GB, 9,637 of
11,139). It has happened three times now.

## What is different this time

The sweep is no longer by hand. `tools/runTests.ts` drops unreachable entries at the start of every
full run, beside the temp sweep and the code-cache guard, so nobody has to notice. That is the
"cheaper variant" 0068 named and it bounds the damage to one run's worth.

**What has not changed is the rate**, which is exactly what 0068 said a sweep would not change, and
it is why that issue should not have been closed: the mop was mistaken for the fix, and the fix is
still not written.

## The fix 0068 asked for, and the tradeoff nobody has weighed

Build into a **stable path per build** rather than a fresh `/tmp` directory per run, so Deno's
entry — keyed by the source's absolute path — is *reused* instead of orphaned.
`packages/platform/build.ts` already computes a content key (`appKey`) and only stages when that key
misses, so the shape is there: stage into `.cache/stage/<key>/` rather than
`Deno.makeTempDir({ prefix: "wac-app-" })`.

Three things have to be decided together, and the second is the one that makes this an issue rather
than a patch:

1. **The staged directory must not be deleted afterwards.** Deleting it is what orphans the entry,
   so the whole gain depends on leaving the source in place. That is fine — the path is a function
   of the content, so a rebuild of the same program lands on the same directory — but it means
   `.cache` grows instead of `~/.cache/deno`.
2. **What it grows by.** The staged glue embeds the module as base64, so a staged directory is
   roughly the size of the artifact — about a megabyte for `wc`, nine for `box`'s shell. Bounded by
   *distinct build contents* rather than by runs, which is 0068's "working set roughly the size of
   the repo", but it is real disk in the repository rather than in a cache directory, and
   `harness/buildCache.ts`'s `prune` **only considers files** (`if (!e.isFile) continue`), so it
   would ignore these directories entirely. Pruning has to learn about them or they accumulate the
   same way, one directory per distinct build instead of one per run.
3. **Concurrency.** Two runs missing the same key stage into the same directory at once. The bytes
   are identical by construction, but a bundler reading a half-written `app.gen.ts` is not. The
   existing cache writes to a temp name and renames; the staging would have to do the same, per
   file, and that is where a mistake would be subtle rather than loud.

**What I would do:** (1) and (3) as described, and for (2) extend `prune` to directories under a
`stage` kind with the same age rule it uses for `.tmp` files.

**And the measurement that decides (2) is already sitting in the cache.** `harness/buildCache.ts`
keeps `KEEP = 120` entries per kind, and the working set that bound produces today is:

    .cache/app    54 MB   120 entries
    .cache/bind   11 MB   120 entries

A staged directory holds the generated glue and the two bundle entry files — the same order as the
artifact it produces — so keeping one per live key under the same bound is **tens of megabytes in
`.cache`**, against the 6.5 GB of `~/.cache/deno` per day-ish that it stops orphaning. That is not a
close trade, and it is the number I said nobody had. What is still unmeasured is the *speed*: the
transpile entries would start hitting, and 0068 guessed builds would get faster as a side effect,
which nobody has checked either way.

**What I would not do** is call this fixed when the sweep lands, which is how it got here.
