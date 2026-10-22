# 0364a — a deep expression overflows the native host's stack, by lottery

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-10-22
- **Kind:** bug
- **Symptom:** trap

## Reproduction

The compiler, run on the native host, over one file whose function body is a left-deep `+` chain
of N calls — `return v0(1) + v1(1) + … + v559(1);`, each `vI` imported from its own file. This is
what `packages/wacc/test/wac/manyfiles_test.wac` built until 2026-10-22:

    N = 100, 300   blockedFiles, emit, coverage table — all fine
    N = 450        blockedFiles fine, the emit traps
    N = 560        blockedFiles traps: `test_more_files_than_the_linkers_tables_used_to_hold — trapped`

The same program through the same tree, **run in-process under Deno** (`harness/appRun.ts`), answers
`blocked: ` (nothing declined) at N = 560. So it is the host, not the compiler's logic: the walk over
the chain recurses once per `+`, and the native binary's V8 has the default stack limit.

**A lottery, not a threshold.** The full gate passed this test on 2026-10-22 (53.7s), and the next gate
an hour later failed it (39s, trapped). Locally it traps in 2s, with that tree *and* with the commit
before it, with both the old and the new binary. Likely V8 tiering: the recursion runs in baseline code
with larger frames until it is optimised, so how deep it gets depends on how long it has run.

Expected: a program whose depth the Deno host handles runs on the native one too.
Actual: `wac: … trapped`, with no message.

## Notes

`manyfiles_test` now writes the 560 calls as statements (`s = s + vI(1);`), because it is about the
linker's tables and not about depth — that takes the test out of the lottery, and leaves the limit.

The fix is the native host's: `v8::V8::set_flags_from_string("--stack-size=…")` before
`initialize`, with the isolate's thread given a stack that backs it (the main thread has the 8 MB
`ulimit`; threads from `std::thread::spawn` default to 2 MB, so any thread that runs an isolate would
need `Builder::stack_size`). Or the walks become iterative over a `+` chain, which is the compiler's.
Not done here: it is a host change with a measurement to make first.
