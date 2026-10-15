# 0376a — `manyfiles_test`'s first test traps, at every commit the current compiler can build

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-15
- **Kind:** bug
- **Symptom:** trap

## Reproduction

    wac test --allow-read --allow-write --allow-run --allow-env --allow-net packages/wacc/test/wac/manyfiles_test.wac

Expected: `test_more_files_than_the_linkers_tables_used_to_hold` passes — a 561-file program links,
builds, runs, and attributes each coverage point to its own file.
Actual: `FAIL test_more_files_than_the_linkers_tables_used_to_hold — trapped`, in about a second. The
other four tests in the file pass.

## Notes

Measured on 2026-10-15 with the seed built from `f05c23056`'s successors: it fails on `origin/master`,
at `d59a48df0` (2026-10-14) and at `a93934733` (2026-10-03). Sources from before the 2026-10-01 rewrite
do not compile with today's compiler, so it could not be bisected further back; the test file itself
last changed in `be1f345b4` (2026-10-01).

A second ago is too fast for the emit and run the comments describe (`blockedFiles` 167ms, emit 200ms,
run 15ms) to have finished, so the trap is probably early — in `blockedFiles` or in the emit — and inside
the test module, which carries wacc's own sources. Not looked at further.
