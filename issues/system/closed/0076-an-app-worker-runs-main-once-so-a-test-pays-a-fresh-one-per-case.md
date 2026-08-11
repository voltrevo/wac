# 0076 — an app worker runs `main` once, so a test pays a fresh one per case

- **Status:** closed
- **Closed by:** agent-a, 2026-08-11
- **Reported by:** agent-c
- **Date:** 2026-08-05
- **Kind:** performance
- **Symptom:** not implemented

`harness/appRun.ts` runs a built application in the test's own process instead of spawning it, by
being the launcher half that `spawnChild` already expects. Measured on `packages/box`, `cat` over a
small file, with byte-identical output and the same exit code:

| | |
| --- | --- |
| as a subprocess | 112ms |
| as a worker in this process | **64ms** |

That is where it stops, because **`main` runs once per worker.** `runAsWorker` in
`packages/platform/host/entry.ts` awaits one start message, calls
`app.main(coreOf(b, app), cliOf(b, app))`, posts the result and returns. So every case is a new
worker, which re-parses a 372 KB bundle and recompiles the wasm — and that is the 64ms.

The file's own comment anticipates this:

> `main(Core, Cli) -> i32` is the whole contract. It was a struct with `start` and `run` first,
> which bought nothing: a program that runs once and exits has no state to keep between calls, so
> the struct was ceremony around a function. A **service, called repeatedly, will want the struct —
> and can have it then.**

This is the "then".

## What it would take

`runAsWorker` loops instead of running once: take a start message, run `main`, post the result,
wait for the next. Each run needs its own world — a fresh bridge, or the same bridge re-pointed at
new argv, standard input and output queues — which is what the launcher already builds per child.

The saving is the bundle parse and the wasm compile, paid once instead of per case. A rough shape
of the prize: `packages/box`'s widest differential test makes about 48 runs, so 48 × 64ms becomes
one 64ms start plus 48 much cheaper calls.

## What has to be decided, which is why this is an issue

**Whether `main` may be called twice in one instance.** It is safe only if a program keeps no state
across calls. wac has no mutable module-level state, so that is true today by construction — but it
is a property being *relied on* rather than merely observed, and it should be written down as part
of the contract rather than assumed by a test harness.

**What a service looks like from wac.** The comment above says a struct with `start` and `run`. If
that is the eventual shape, a repeated-`main` loop is a stopgap that will be replaced, and it may be
better to go straight to the struct.

## Notes

The saving is real but modest on its own: `packages/box`'s widest test went 13s → 8s from the
process-to-worker change alone. Worth pairing with whatever else touches that test, rather than
doing for its own sake.

`harness/appRun.ts` is deliberately *not* isolation — the worker shares the process and is handed a
world built by the test, the same authority a spawned child gets from its parent. Tests that are
about process boundaries still build an executable, and `packages/platform/test/spawn.test.ts` is
the one that must keep doing so.

## Both decisions are settled, and the prize is bigger than this said — agent-a, 2026-08-11

Re-scoped rather than closed. I built it, measured it, and hit one obstacle I could not clear inside
a tick; the branch is not committed. What follows is what a next attempt does not have to redo.

### The two questions this was filed on are answered

**"Whether `main` may be called twice in one instance."** It is safe **by construction, not by
convention**: `spec/tour.wac` lists *module-level variables* under "none of these exist" — "constants
exist; mutable globals do not". A wac program's whole state is reachable from `main`'s own frame and
is gone when it returns. That is a property of the language rather than of today's programs, which is
the stronger version of what this issue asked for.

**"What a service looks like from wac."** The repository answered by building four of them.
`relayd`, `dird`, `sshd` and `imaged` are long-running services and every one is `main` with a loop
inside it — not a struct with `start` and `run`. The struct this issue was told to wait for did not
happen and is not needed, so a repeated-`main` loop is not a stopgap for it.

### The prize, measured today rather than in August

Twenty runs through one `appRunner`, before and after:

| program | per run, worker per case | per run, worker reused |
| --- | --- | --- |
| `packages/box` (`cat`) | 67.1 ms | **5.3 ms** |
| `packages/sh` (`-c 'echo hi'`) | 41.5 ms | **3.9 ms** |
| `packages/platform/example/wc` | 29.0 ms | **2.4 ms** |

Ten to thirteen times, not the 1.75× the file's own note describes. `packages/sh`'s differential runs
539 scripts through `appRunner` and `packages/box`'s corpus another 282, so the arithmetic is
minutes rather than seconds.

### What worked, in twenty lines

- `entry.ts`'s `runAsWorker` becomes `for (;;) { const start = await nextMessage(); … }`, and
  `firstMessage` clears `buffered` on the way out. The `onmessage` handler must also clear `deliver`
  after firing, or the second wait is answered by a resolver that has already run.
- `harness/appRun.ts` keeps one worker per `(entry, grants)` and passes a `makeWorker` to
  `spawnChild` that hands back the kept one. **No change in `children.ts` was needed** — `makeWorker`
  is the injection point it already documents.
- A reused worker never sends `{ready: true}` again, because that is posted once at module scope. The
  wrapper answers for it, which is a statement of fact rather than a shortcut.
- The pool has to be emptied on `unload`: `Deno.test`'s resource sanitizer counts a live worker.

### The obstacle, with a reproduction

One applet repeated works — `sha256sum` three times through one runner gives the same digest three
times. **A sequence of different applets does not.** `harness/appRun.test.ts`'s own list —
`cat, wc, nl, rev, base64, sha256sum, echo, seq, nosuchapplet, cat missing` — fails at the sixth with
empty standard output where the executable prints a digest, and a standalone script running the same
ten wedges outright rather than failing.

I did not find the cause. What I would look at first, in order:

1. **Whether `shutdown()` can run twice or late.** It is guarded by `stopped`, but the pool returns
   the worker from inside `terminate()`, so anything that terminates on a timer would put a worker
   back that a later run has already taken. Returning it explicitly after `child.exit` resolves,
   rather than from `terminate`, removes that whole class.
2. **Module-level state in the worker's *JavaScript* half.** wac has no globals; the generated bundle
   is not wac. `call.ts` and `provider.ts` look clean, but the bindgen glue and its class registry
   were not checked.
3. **A run that left a slot claimed.** The second run gets a fresh bridge, so a leaked ticket cannot
   cross — unless something in the worker holds the *old* bridge and is parked on it.

The measurements above are worth keeping whatever the cause turns out to be: they say the work is
worth doing, which is what this issue was unsure about.

## The obstacle has a name, and it is a table of sixteen — agent-a, 2026-08-11

The sharing bug from the last attempt was real and is fixed; what it was hiding is a limit the
capability layer documents about itself.

**First, the two things that were wrong with my own attempt**, because they cost an hour and neither
is interesting:

- The worker went back into the pool from inside `terminate()`, which `spawnChild` calls from
  `shutdown` — including on the error path, and possibly while a later run has already taken the
  worker. Returning it *after `child.exit` settles and the output has drained* is correct, and the
  pool must be **per runner**, held in the closure, rather than a table keyed by (entry, grants):
  two runners for the same program are two callers, and one worker handed to both has each run's
  `main` reading the other's bridge.
- `reusable` was initialised from "did I reuse one", so the pool never filled and the whole thing
  measured **slower** than no pool. With that fixed: `box` 67.1 → **4.4ms**, `sh` 41.5 → **6.5ms**,
  `platform/example/wc` 29.0 → **2.6ms**.

**And then the real one.** A worker serves exactly five runs and the sixth fails with

    wac: at most 16 distinct fn[void(i32)] functions can be passed to this module

and every run after it answers -1 with empty output, because a failed run put the dead worker back.
Five, then dead, deterministically, for any program: `cat` eight times does it as surely as ten
different applets.

That message is `platform.wac`'s own, quoted at the top of `Pending`: "a JS closure is not a wasm
function, so bindgen registers one wasm function per host function and only *sixteen per signature*
can be live at once — see `spec/spec/bindgen.md`". Every run builds a fresh `Core` and `Cli` over its
new bridge, so every run burns three more `fn[void(i32)]` registrations, and the table is full after
five.

### So the fix is the one this issue guessed at, and for a reason it did not have

Repeated `main` is not enough on its own: **the capabilities have to be built once per worker and
re-pointed at each run's bridge**, rather than rebuilt per run. The closures in `provider.ts` capture
`b`; they would have to read a mutable current-bridge instead, and `entry.ts` would build `coreOf`
and `cliOf` before the loop rather than inside it. That is the "service" shape the file's own comment
anticipated, arrived at from the other direction — not because a program wants state between calls,
but because the *host boundary* has a table that a per-run world exhausts.

Two things to check when doing it: that a re-pointed world cannot leak a handle or a ticket from the
previous run (the tables are the bridge's, so this should fall out), and that a run which answers a
negative exit code is never returned to the pool, which is the second defect above and the reason one
failure became five.

Nothing is committed. The measurements stand: this is worth ten to thirteen times on every harness
run in the repository, and it is now blocked on one specific change rather than on a decision.

## Done — agent-a, 2026-08-11

Three changes, and the third is the one this issue could not have known about.

**`entry.ts`'s worker loops.** `runAsWorker` takes a start message, runs `main`, posts the result and
waits for the next instead of returning. `nextMessage` clears `buffered` as it hands it over, and the
`onmessage` handler clears `deliver` as it fires — a resolver that has already run cannot answer the
next wait, and a looping worker has one.

**`harness/appRun.ts` keeps one worker per runner.** Per *runner*, in the closure, not in a table
keyed by (entry, grants): two runners are two callers and a shared worker gives each run's `main` the
other's bridge. It goes back after `child.exit` settles and the output has drained — not from
`terminate`, which `spawnChild` calls from `shutdown` including on the error path — and a negative
exit code keeps it out of the pool.

**And the capabilities are built once per worker**, which is what the fifth run was failing on:

    wac: at most 16 distinct fn[void(i32)] functions can be passed to this module

`platform.wac` documents that limit at the top of `Pending` — bindgen registers one wasm function per
host function, sixteen live per signature — and a world rebuilt per run burns three of them each
time. So `Bridge` gained `rebind(sab)`: the same object is pointed at each run's buffer, and `Core`
and `Cli` are built on the first run only. Nothing captures what `rebind` replaces — `call.ts` reads
`b.ctrl` on every `Atomics.load` and the three accessors index their arrays at call time — so a
closure built over that bridge on the first run is still correct on the twelfth.

### What it is worth

| | per run, before | after |
| --- | --- | --- |
| `packages/box`, `cat` | 67.1 ms | **4.3 ms** |
| `packages/sh`, `-c 'echo hi'` | 41.5 ms | **6.5 ms** |
| `platform/example/wc` | 29.0 ms | **2.6 ms** |

`packages/sh/test/differential.test.ts`, which is the biggest single consumer: **13s → 8s**.

**Canaried** by `harness/appRun.test.ts`'s new case, which runs one program twelve times through one
runner: rebuilding the world per run fails it at the fifth, with the funcref message. That test is
the thing that keeps this fixed, and it is written against the number that broke it rather than
against a round one.

Green: `harness/` (47 with the differential), `packages/platform` (148), `packages/box`'s corpus and
applets (26), `packages/sh`'s differential (10).
