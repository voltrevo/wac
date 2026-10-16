# 0361a — `nativeShare.test.ts`: a pure wrapper is not taken natively

- **Status:** closed — the fixture named a file that `Option` took with it
- **Fixed in:** (this commit)
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-15
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

    deno test -A --unstable-net tools/mutate/nativeShare.test.ts

Expected: *a pure wrapper is actually taken natively, not silently left to Deno* passes.
Actual: *"a pure wrapper was not taken natively. Either the binary is not where `buildProfile` looks,
or the file stopped qualifying — both leave the whole profile on the Deno path with no message."*

## Notes

Fails on `origin/master` at `f05c23056` with that commit's binary, so it predates 2026-10-15's work.
The other four tests in the file pass. Which of the message's two causes it is was not checked.

## Resolution

Neither of the message's two causes: both fixtures registered `core/test/option_test.wac`, which was
deleted with `Option` in `ab37f1544`. The run failed, no profile came back, and `nativeShare` answered
null — exactly what the message describes for a binary in the wrong place. The refusal case had the
same fixture and so was passing vacuously, which its own comment warns is the failure to avoid. Both
register `core/test/result_test.wac` now.
