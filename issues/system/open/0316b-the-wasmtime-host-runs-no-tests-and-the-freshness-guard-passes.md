# 0316 — the wasmtime host runs no tests at all, and the freshness guard passes anyway

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-09-01
- **Kind:** bug
- **Symptom:** silent loss of a whole host's coverage — eleven test files skip or fail and the check written to catch this stays green

## Reproduction

```
$ ./native/target/release/wac test --allow-read --allow-write --allow-run --allow-net --allow-env \
    packages/platform/test/wac/hostfaults_test.wac
FAIL test_a_path_the_system_refuses_is_denied_rather_than_absent — this module was built without Core and Cli
0 passed, 6 failed in 0 ms
```

Not that file: `packages/wactest/test/wac/` fails the same way in `daemon_test.wac`, `itoa64_test.wac`
and `runner_test.wac`. Every wac test on that host fails before running.

`wac run` on the same binary is **fine** — a program compiled and run there works and answers
correctly. It is the `wac test` path that cannot build a module with `Core` and `Cli` in it.

## The guard that should catch it passes

```
$ ./native/v8/target/release/wac test --allow-read --allow-run tools/wac/seedfresh_test.wac
ok   test_the_wasmtime_host_if_built_is_not_older_than_the_rust_it_is_built_from (0 ms)
3 passed, 0 failed in 549 ms
```

That is the whole of the problem. The guard compares the **binary** against the **Rust it is built
from**, and both are current — I rebuilt that crate today. What is old is the *payload*: the seed the
binary carries, which is an input to the cargo build rather than an output of it, so a `cargo build`
refreshes the binary's timestamp while leaving the stale thing inside it untouched. The check reads a
slice of the question and answers the whole of it.

`native/v8/seed/` has the same shape and `tools/wac/seedfresh_test.wac` has the same gap for it; the
V8 seed is simply rebuilt often enough by ordinary work that nobody meets it there.

## This has happened before and cost a measurement

`issues/system/closed/0306b` met the identical sentence:

> Note that running `socks` under wasmtime is only possible at all because that host's seed was
> rebuilt today; before that it answered *"this module was built without Core and Cli"* and could not
> be asked.

So it recurs, the recovery is known (`./bootstrap.sh --host wasmtime`), and nothing tells you that you
are in it — you find out when a two-host differential answers `0 of N` on the native arm, which is the
shape of a broken instrument rather than of a stale build. `0306b` read that correctly only because it
was already suspicious of its own numbers.

## Why it is worth more than "rebuild it"

Eleven test files reach for this host through `nativeHostWhyNot()`, which returns `""` — *nothing wrong*
— in exactly this state, because it asks the same binary-versus-Rust question. So the host is not
skipped with a reason. Either it fails loudly in the two files that assert the native half, or it
passes vacuously in the ones that compare and find nothing to compare, and the second is the dangerous
one: `design/system/0001` D9 says this host exists to test the claim that a wac program does not depend
on one, and a green suite that never asked it does not test that claim.

## Where to look

`tools/wac/seedfresh_test.wac` is the file, and the missing comparison is the seed payload against
`packages/wacc/src` — the same rule `CLAUDE.md` states for the V8 seed ("`cargo build` does not do it:
the seed is an input to the build, not an output of it"), which is written down for humans and checked
for neither host. `nativeHostWhyNot()` in `packages/wactest/src/built.wac` should then have a reason to
return, since its docstring already promises one; its own comment explains why it names the crate's
inputs rather than walking `native/`, and the seed is the input that naming missed.

Worth deciding as part of it: whether `wac test` on a host whose payload cannot build a module with
`Core` and `Cli` should say *that*, rather than reporting it once per test as a failure.

## How it was found

Incidental to `issues/system/0295c`, running a new cross-host test on both Rust hosts. The v8 arm
passed 6 of 6 and the wasmtime arm failed 6 of 6, which looked like the new test until the same
failure turned up in three files I had not touched. The measurement 0295c needed was taken with
`wac run` instead, which is why that issue could still be closed.
