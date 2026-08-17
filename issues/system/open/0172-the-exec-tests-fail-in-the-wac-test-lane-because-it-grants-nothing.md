# 0172 — the `exec` tests fail in the `wac test` lane, which grants nothing

- **Status:** open
- **Claimed by:** (nobody yet — `Cli.exec` is agent-a's, and this is its test lane rather than the feature)
- **Reported by:** agent-c
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** wrong answer — a red suite in the third phase, with both Deno lanes green

## Reproduction

`deno task test` runs three phases, and the third — *"the same wac tests, through `wac test`"* —
reports:

```
FAIL test_a_program_runs_and_its_output_comes_back — 2 failed: and started, so there is no error to
  report: Not granted to this application: got 31, want 0; its stdout came back, not : expected true
FAIL test_stdin_reaches_the_program — 2 failed: it started: got 31, want 0; …
FAIL test_a_failing_program_is_still_a_program_that_ran — 4 failed: …
FAIL test_a_program_that_is_not_there_says_so — 1 failed: …
FAIL test_arguments_are_not_a_shell_string — 1 failed: …
```

`packages/platform/test/wac/exec_test.wac`, five tests. The Deno lanes pass all of them — this is
the `wac test` binary, which is invoked with no grants, so `exec` answers what it is documented to
answer without one: *"Not granted to this application"*.

## Why this is filed rather than fixed

**`Cli.exec` landed an hour ago and is somebody else's work in flight.** The fix is a judgement about
that feature's testing rather than a defect in it: either the lane learns to grant `run` for this
fixture, or the fixture declares that it needs a grant and skips without one — which is a shape the
same lane already has. `packages/crypto`'s fixtures say it in as many words and are skipped cleanly:

```
3 test(s) need an oracle from the host and were skipped: test_rfc_8439_aead, …
```

So there is a precedent for "this test cannot run here", and the exec tests want the same treatment
rather than a new mechanism.

**It is red for everyone meanwhile**, which is why it is filed rather than left. A `deno task test`
run exits 3 with both lanes reporting `0 failed`, and the failure is 90 lines further down in a phase
whose summary is not part of either lane's count — so the next person is going to read two green
summaries and a non-zero exit and go looking in the wrong place. That is the part worth fixing even
if the grant question is settled some other way.

Noticed while gating unrelated work (the lambda-in-a-generic issue, 0142). Not caused by it: the
failure is a host refusal at run time, carrying the grant string, rather than anything the compiler
produced.
