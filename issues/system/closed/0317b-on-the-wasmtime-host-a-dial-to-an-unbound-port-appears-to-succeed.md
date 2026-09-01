# 0317 — on the wasmtime host a dial to an unbound port appears to succeed

- **Status:** closed
- **Claimed by:** agent-b
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

## Fixed, and the title describes the symptom rather than the fault — agent-b, 2026-09-01

**`closeSocket` matched one socket kind of three.** `Sock` in `native/src/main.rs` is `Listening`,
`Open` and `Datagram`; `Cap::CloseSocket` read

```rust
if let Some(Sock::Open(s)) = socket_at(caller, h) { … }
```

so closing a **listener** — or a bound UDP socket — fell through the `if let` and did nothing at all.
The handle stayed in the table and the port stayed bound. Nothing was wrong with `connect`: it was
answering correctly about a listener that was still there.

Reduced to four lines, which is the reproduction worth keeping:

| | v8 | wasmtime, before | wasmtime, after |
|---|---|---|---|
| dial while listening | `handle=3 fault=0` | `handle=3 fault=0` | `handle=3 fault=0` |
| `closeSocket(listener)`, dial again | `handle=-1 fault=15` | **`handle=4 fault=0`** | `handle=-1 fault=15` |

`fault=15` is `FAULT_REFUSED`, *Connection refused (os error 111)*.

**Why it presented as a `connect` fault.** `packages/wactest/src/daemon.wac` takes a free port by
binding zero and releasing, then waits for readiness by dialling until something answers. With the
release doing nothing, "is the server up yet?" was answered *yes* by the listener the test had just
closed — so the two failures said `something answered on a port nothing is listening on` and
`a command that does not exist appeared to serve a port`, and the third hung talking to a server that
was never started. Three symptoms, none of them shaped like a close that silently returns.

**Only a stream has a `shutdown`** — it is the two directions of an established connection, and a
peer blocked on a read must be told. A listener and a datagram socket have no peer; dropping the last
handle is the whole of closing them. The `match` now names all three kinds, so a fourth would be a
compile error rather than a silent no-op, which is the property the `if let` gave away.

**The datagram half was never reported and is fixed by the same line.** Nothing exercised it, which
is why: `packages/platform/test/wac/datagram_probe.wac` is about delivery rather than about closing.

**Test:** `test_closing_a_listener_stops_it_accepting` in
`packages/platform/test/wac/closewhilereading_test.wac`, beside `0304b`'s — the same question one
socket kind over. It dials while the listener is open first, so a refusal afterwards is the close
rather than a dial that never worked. Canaried against the pre-fix binary: reverting only
`native/src/main.rs` fails it and leaves the neighbouring test passing.

`packages/wactest/test/wac/` is **8 files, 8 ok** on that host, from 0 of 8 before `0316b`.

**Fixed in:** `native/src/main.rs`, `packages/platform/test/wac/closewhilereading_test.wac`.
