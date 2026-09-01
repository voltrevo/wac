# 0317 — on the wasmtime host a dial to an unbound port appears to succeed

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-09-01
- **Kind:** bug
- **Symptom:** wrong answer — a readiness probe says "listening" about a port nothing is bound to, so a waiter never waits and a server test hangs

## Reproduction

`packages/wactest/test/wac/daemon_test.wac`, four tests, on each Rust host:

| test | v8 | wasmtime |
| --- | --- | --- |
| `test_quoting_keeps_a_value_whole` | ok | ok |
| `test_a_deadline_wait_waits_for_the_deadline` | ok | **fail** — *something answered on a port nothing is listening on* |
| `test_a_command_that_cannot_start_is_reported` | ok | **fail** — *a command that does not exist appeared to serve a port* |
| `test_a_started_server_answers_and_a_stopped_one_does_not` | ok | **hangs** — no output, killed at 600s |

```
$ ./native/v8/target/release/wac test --allow-read --allow-write --allow-run --allow-net --allow-env \
    packages/wactest/test/wac/daemon_test.wac
4 passed, 0 failed in 1.4s

$ ./native/target/release/wac test  <same grants>  packages/wactest/test/wac/daemon_test.wac
   (no output; still running after three minutes)
```

Use `--filter <name>` to take them one at a time; the hang is the fourth and it is what swallows the
other three's output when the file is run whole.

## What the two failures agree on

Both are the same sentence from different directions: a connection to a port **nothing is bound to**
comes back as though it succeeded. `test_a_deadline_wait` proves it directly — it probes a port it has
deliberately left free and is told something is there. `test_a_command_that_cannot_start` then shows
what that costs: a command that cannot even be started is reported as serving.

That also accounts for the hang without needing a second explanation. A readiness wait built on "can I
connect yet?" is satisfied immediately, so the test proceeds to talk to a server that does not exist
and blocks on an answer that never comes.

## What makes it confusing

`packages/platform/test/wac/hostfaults_test.wac`'s
`test_a_refused_connection_is_refused_and_not_merely_failed` **passes on this host** — it dials a port
nothing is listening on and gets `FAULT_REFUSED`, which is the correct answer and the opposite of what
`daemon_test` sees. So the two disagree about the same question, and settling which path each takes is
the first thing to do rather than assuming either. The difference is likely to be *which* dial: one
goes through `Socket`, and the daemon helper's readiness probe may not.

## Not newly broken — newly reachable

These tests have almost certainly never run on this host. Until the fix in `issues/system/0316b`
landed today, `wac test` on the wasmtime host refused **every export of every file** before running
one, so nothing here could fail or hang. The socket code is untouched by that fix, which only changes
how the world is built at load; what changed is that the tests can reach it at all.

Worth stating plainly because it will look like a regression from that commit and it is not: it is what
the commit uncovered. Whether this dates from the beginning or arrived at some point in between cannot
be told from here, since no run of these tests on this host exists to bisect against.

## Where to look

`native/src/main.rs`, the connect path, against `native/v8/src/main.rs`'s — the V8 host answers all
four correctly, so it is a differential with a known-good side. `packages/wactest/src/daemon.wac` is
the helper both go through and names what its readiness probe actually calls.

`issues/system/0128` — the two-host differential that times out under load — is worth reading beside
this. A host that reports every port as live is one way for a differential to look slow rather than
wrong.
