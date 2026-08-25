# 0203 — the gate fails one run in six, and mostly it is right to

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** bug
- **Symptom:** no error
- **Note:** filed as "a wide, load-sensitive tail" and corrected twice as the failures were read. Two of
  the five were real defects. Read the table before quoting the rate.

## A sixth failure, read rather than counted — 2026-08-20 (agent-b)

`packages/box/test/sealing.test.ts` turned a gate red on *a program nobody spawned still gets the host*,
and passed on its own immediately afterwards — the shape this issue warns about quoting as a rate. The
log named the cause exactly:

    assertEquals failed — /usr/bin/timeout: failed to run command
      ‘/tmp/wac-sealing-…/box’: Text file busy
      got: ""  want: "on the host\n"

**It is ETXTBSY — wac-mono 0074 — and the retry written for it could not fire.** `harness/spawnRetry.ts`
wraps `Deno.Command` and retries when `spawn`, `output` or `outputSync` *throws* "Text file busy".
`harness/bounded.ts` does not spawn the target: it spawns `timeout` and passes the target as an
argument. Deno's spawn succeeds, `timeout`'s `execve` fails, the message arrives on stderr with exit
126, and nothing throws. `isBusy` is never asked.

The import was present — `tools/spawnretry.test.ts` checks that every build-and-spawn file has it, and
this one does. **A guard that keys on an exception is a guard on the exec staying inside the process**,
and the bound moved it one process out. The diagnostic would also have looked in the wrong place: the
wrapper records the path it spawned, which is `"timeout"`.

Fixed, and made checkable rather than waited for: `harness/boundedBusy.test.ts` holds a binary open for
writing on purpose, so the window is arranged instead of raced. Four cases — held throughout (the answer
must say `busy`, not `out: ""`), released mid-retry (must get through), a program that prints those words
itself (must *not* be called busy — the status is checked as well as the text), and an undisturbed run.
The ETXTBSY policy is one module now, `harness/etxtbsy.ts`, because it is recognised two ways and two
copies of the message and the budget is how they drift.

**So this one was neither a defect in the code under test nor a race in it**, which makes three
categories in this issue rather than two: real defects, load-sensitive bounds, and a guard that was
looking in the wrong place. All 47 tests across the thirteen files that stand on `bounded` pass.

## An eighth: the retry covers a different failure from the one that happens — 2026-08-21 (agent-b)

`packages/platform/test/wac/arrival_users_test.wac` failed with ten assertions of the form

    ada did not land in her own home: got "", want "/home/ada\nada\n"

and the cause is in the eighth of them: `ssh: connect to host 127.0.0.1 port 44723: Connection refused`.
It passes on its own. Ten sentences about home directories for one about a port — the same
consequence-not-cause shape as the two entries below it.

**What the code actually does**, read rather than reconstructed. `Held.take(cli)` binds a port to prove
it is free and must `release` it before the child can bind the same number, so there is an unavoidable
window between the reservation ending and sshd's own `bind`. That is inherent to "find a free port, hand
the number to a child", and the loop around it is the mitigation: three attempts, each waiting 20s for
the daemon to log `listening on port N`.

**The mitigation covers a different failure from the observed one.** The loop retries when the daemon
*never announces itself*. Tonight it announced itself and the client could not reach it — and no attempt
retries that, because the loop has already returned `Server(d, port, "")` by then. So the one failure
the window can produce late is the one the retry cannot catch.

Not fixed here, and deliberately: `packages/platform` had commits from two other agents tonight, and
`issues/system/README.md` says a package someone else is working in gets filed rather than fixed. The
shape a fix would take is in the shared list below — assert the daemon is still reachable *before* the
ten assertions that assume it, so the failure is one sentence about a port.

## `reqbuf` again, and this time its bound was the defect — 2026-08-21 (agent-b)

`packages/platform/test/reqbuf.test.ts` is the first row of the table below, and it failed again:

    the call reaching the handler did not happen within 10s (load 4.45 5.62 5.46)

Five cores, three agents, load 5.6 — and **the message is the test reporting the evidence against its
own bound**. `loadNow()` is in there because somebody already suspected this.

Its `until()` helper carries the right argument and the wrong number. The comment says "the bound is
generous for `harness/bounded.ts`'s reason: it exists to turn a wedge into a readable failure, not to
police latency" — and then waits ten seconds, where the constant that argument belongs to is sixty,
set at sixty precisely because "what takes a minute is a machine at three times its core count". Ten is
six times tighter than the doctrine it cites.

It takes `DEFAULT_SECONDS` now rather than a bigger number of its own, so the next person to re-argue how
long is long enough has one place to do it. On an idle machine the file passes in 61ms, which is the
proof the bound only ever mattered under load.

**This is the load-sensitive-bound category, and the fix is not "retry".** A bound whose failure prints
its own load average was measuring the machine. The three other tests in that file use the same helper
and were one bad moment away from the same failure.

Not swept further: `browser_live.test.ts`'s thirty-second waits are Playwright's own timeouts on a real
browser, a different mechanism with a different argument, and `bounded.ts` itself names two callers whose
*subject* is a hang and which must keep a short bound.

## A seventh, and it is the third category again — 2026-08-20 (agent-b)

`packages/platform/test/wac/native_shell_test.wac` failed the gate with **sixteen** failures, every one
of them

    native echo [$HOME] [$PATH] [$USER]: /bin/sh: 1: cd: can't cd to
      …/.cache/hostshell-seal

and passed on its own afterwards. Sixteen shells blaming themselves for a directory that was not there.

`scratch()` built it and **threw away both answers**: `cli.remove(dir, true).wait()` and
`cli.mkdir(dir, true).wait()`, neither result read. A `mkdir` that failed left every script in the test
running with a cwd that did not exist, and what reached the screen was the *consequence* sixteen times
over with no mention of the fixture.

It reads both now. The `remove` is allowed to fail for exactly one reason — the directory not being
there, which is the ordinary first run and is what `Change.absent()` asks — and anything else is
reported with the host's own words. Canaried by pointing the path at a child of a regular file:

    native_shell: could not create …/.cache/_bad.wasm/hostshell-seal — Not a directory
    0 passed, 3 failed

**What this does not do is explain why the `mkdir` failed**, and that is the honest state: three tests
in that file use three distinct scratch names, nothing else in the repository names that path, and it
did not reproduce. What has changed is that the next occurrence names its own cause instead of costing a
diagnosis — which is the same argument `harness/spawnRetry.ts` makes for keeping its diagnostic on.

So the categories in this issue are now: real defects, load-sensitive bounds, a guard looking in the
wrong place, and **a fixture whose failure was reported as its consequence**. The common thread in the
last two is that neither was a race in the code under test.

## The measurement

Twenty-eight `tools/push.sh` runs on 2026-08-18, one machine, one agent, nothing else pushing:

    23  the suite passed
     5  the suite failed

Every one of the five failed on a **different file**, and each of those files passed on its own
immediately afterwards:

| file | what it said |
|---|---|
| `packages/platform/test/reqbuf.test.ts` | `a slot still holds a request buffer: 0:0` |
| `packages/platform/test/native_examples.test.ts` | nine parse errors at `platform.wac:287` — see `0128` |
| `packages/wacc/test/bindgenWac.test.ts` | — |
| `packages/tls/test/client.test.ts` | — |
| `packages/raster/test/live.test.ts` | — |

**The five have five different causes, and calling them flakiness was wrong.** I filed this issue saying
"a wide, load-sensitive tail", read the five failures properly afterwards, and two of them are not races at
all:

| file | what it was |
|---|---|
| `reqbuf.test.ts` | a race: a fixed 200ms before stopping a responder. Fixed — it waits for the handler. |
| `tls/test/client.test.ts` | a race: the port was taken between choosing it and binding it, so `listening` answered about a stranger and the request was refused. Fixed — a bind failure is retried, and only that. |
| `wacc/test/bindgenWac.test.ts` | **a true red.** The two bindgen generators disagreed about one line, because `ab1f97f8` changed the TypeScript one; `34af4346` brought the wac one back in line and `4dc5aed7` a third. Nothing to do with load. |
| `raster/test/live.test.ts` | **a true red too.** `193e9aca` added the test at 13:46 without the permission guard playwright needs at import time; my gate ran at 13:53 and failed; `8293cf70` — "the live test must ask for the permission it needs" — added the guard at 13:58. |
| `platform/test/native_examples.test.ts` | unexplained; recorded in `issues/system/0128` with its two candidates. |

So the *rate* stands — five of twenty-eight runs failed — and the *diagnosis* is now the opposite of what
this issue was filed to say. **Two of the five were genuine breakage**, both from commits that arrived while
I was working and both fixed by their authors within minutes: `push.sh` merges before it runs the suite, so
another agent's in-flight red becomes my failed push. Two were races and are fixed. One is unexplained.

That leaves a false-red rate of two or three in twenty-eight, not five — and a gate that caught two real
defects in a day. **"The gate is flaky" was wrong twice over**, and both times the only evidence for it was
that I had not read the failures. The rate is worth watching; the story it invites is worth refusing.

What survives of the original point is narrower and still true: a fixed wait standing in for an event is a
false red waiting to happen, and this repository has three good remedies for it already.

## The shape, where it has been diagnosed

Two of the five were looked at properly on the day. Both were a **fixed wait standing in for an event**:

- `reqbuf.test.ts` slept 200ms before stopping a responder, so under load it stopped one before the state
  the test was about existed. Fixed: it waits for the handler to be entered. 63ms instead of 270ms.
- `packages/ssh`'s live fixtures spun 400 *attempts* at a connect that fails in microseconds — ten
  milliseconds of "patience" — which is what made "sshd never accepted" look like port exhaustion.
  Fixed the same day: `waitForPortWithin` takes a deadline.

The remedy already exists in three shapes in this repository, which is the point: `until()` in
`reqbuf.test.ts`, `waitForPortWithin`/`waitForLogWithin` in `packages/wactest/src/daemon.wac`, and `seen`
in `packages/ssh/test/wac/wacsshd.wac`. What is missing is a sweep.

## What to do, in order

1. ~~**Sweep the unconditional sleeps.**~~ Done, 2026-08-18, and it was three sites rather than a class:

   - `packages/platform/test/aliasing.test.ts` (1500ms) — a fake server "holding the connection" for a
     fixed time, which is a guess that the reader finishes inside it *and* a guarantee the test waits out
     whatever is left. It holds on a signal now, released by the `close()` the test already calls in its
     `finally`. Two tests in 11ms rather than 1.5s.
   - `packages/webrtc/test/browser.test.ts` (1200ms, twice) — **deliberate, left alone.** A data channel
     closing and a peer connection closing are different events at the SCTP layer, and the pause exists so
     that whatever arrives after each is attributable to that one. There is no state to wait for; the pause
     *is* the observation. Recorded here so the next reader does not re-derive it.
   - the same file's 5000ms is a `Promise.race` deadline on ICE gathering with an event resolving it early,
     which is the shape everything else is being converted *to*.

   So the remaining candidates are not unconditional sleeps. They are the three undiagnosed files below.
2. ~~**Then the three undiagnosed files above.**~~ Done, and the table above is the answer: two were not
   races, and `tls/client`'s was fixed by asking the one question `listening` cannot — whether the child that
   was supposed to take the port is still alive. Only `native_examples` is open.
3. **And a decision this does not take:** should the suite retry a single failing file once before failing
   the gate? For: the gate's job is to say whether the change is sound, and a one-in-six false red does not
   say that. Against: a retry hides a genuinely intermittent defect, which is exactly what these five might
   be. A middle answer is to retry but *report* it — "passed on the second attempt" is information, and a
   count of those over a week is the same measurement as this issue, taken continuously.

## Two more, 2026-08-19, and both are live-peer tests under a loaded box

Two consecutive gate runs failed on different tests while three agents shared the machine, load average
around ten, with `WAC_SUITE_ANYWAY=1` so a second suite was running beside mine:

| run | failed | on its own |
| --- | --- | --- |
| 361s | `packages/ssh/test/wac/wacsshd_test.wac` — "a line typed while a command is running is still a command" | 12 passed, twice |
| 250s | `packages/webrtc/test/browser.test.ts` — "Chromium completes ICE against us" | 1 passed |

Neither is one of the five in the table above, and both are the same *kind*: a real peer — an OpenSSH
client, a Chromium — where the test waits for something that peer does. That is the population this
issue is about, and it says something the earlier list did not: **the failures track the machine's load
rather than a particular file.** A run alone on a quiet box has not produced one; two runs beside
another suite produced two, in tests that had not failed before.

Which sharpens decision 3 above. A retry-and-report would have turned both of these into information —
"passed on the second attempt, under load" — rather than a red gate that cost two suite runs to
disbelieve. It would not have hidden anything: neither failure is reproducible on its own, and a count
of retries over a week is the measurement this issue keeps asking for.

## A third kind, and this one is not a peer — 2026-08-19

`test/wac/selfhost_test.wac` failed a gate with

```
and does it again: got "wac build exited 1: wac: packages/wacc/example/wacc.wac trapped
```

which is the compiler **trapping while compiling itself**, in the second of the two builds that test
compares. That is not the population above: there is no peer, no port and no timeout in it.

What is known, measured straight afterwards on the same tree:

- four runs of the file alone: **green, 5.9–7.3s each**.
- two `wac build` of `wacc.wac` started together, three times: **both succeeded every time**, peak
  resident 396–436 MB each, with 5.6 GB available. So it is not the concurrency that test uses, and it
  is not memory being tight in isolation.
- the gate it failed in was a four-worker suite with another agent's suite beside it.

So it behaves like the others — load, not input — while looking nothing like them, and a guest *trap*
rather than an OOM or a timeout is a specific enough symptom to be worth catching next time: it means
the compiler reached a `trap` in its own code, which the emitter does when a table it sized turns out
too small (`ranOut`). If that is what it is, the input that overflows would be the same every run and
this would not be load-dependent — which is the part that does not fit, and the reason it is recorded
here rather than diagnosed.

**What would settle it** is the stderr of the failing build, which the assertion above truncates: it
carries the trap's own message when the guest wrote one. Worth widening that message before the next
occurrence.

## The trap is a stale seed, and it is not load-dependent — 2026-08-20

The part that did not fit was right to be suspicious of. The same message —
`wac: packages/wacc/example/wacc.wac trapped` — turned up again, and this time with a reproduction: any
`wac test <file>` produced it, and so did `deno task seed` itself.

```
wac: packages/wacc/example/wacc.wac trapped
wasm://wasm/003a9cda:401394: Uncaught RuntimeError: array element access out of bounds
wasm://wasm/003a9cda:525985: Uncaught RuntimeError: dereferencing a null pointer
```

**The cause is the seed, not the machine.** The binary carries a compiler built before somebody else's
change to `packages/wacc`; that compiler traps on the new sources, and `deno task seed` cannot recover
because it needs the seed to rebuild the seed. `deno task seed:bootstrap` builds wacc with the
*reference* and the trap goes with it: 965,855 bytes, a fixed point, and the file that had been failing
passes. CLAUDE.md describes this case exactly — what it does not say is that the symptom can be a
**trap** rather than a diagnostic, which is why it read as a mystery here.

So this entry leaves the population it was filed into: the earlier gate failure was the same thing —
that gate had pulled immediately before running, and `seedFresh` failed in the same suite, which is the
tell. Nothing about it tracked load; it tracked *when a pull brought a wacc change*. The two peer
failures above are unaffected.

**What would have said so immediately** is the seed's own freshness, and the suite does check it —
`tools/seedFresh.test.ts` failed in that same run and was read as a second, separate problem. A trap
from the compiler and a stale seed in one suite are one fact, and the fix is `seed:bootstrap`.

## Two more, on 2026-08-25, and the tell is the *duration* — agent-c

Two consecutive gate runs on the same commits, each failing on a different test, each passing alone:

| run | test | in the gate | alone |
|---|---|---|---|
| 1 | `packages/ethrpc/test/wac/rpc_live_test.wac` | `eth_blockNumber: 127.0.0.1: Connection refused` | passes |
| 2 | `harness/deadlock.test.ts` | failed after **19s** | passes in **2s** |

Neither file is in the table above, so the tail is wider than the five listed — and the second one
carries the clearest evidence yet that this is load and not the tests: the same test took **nine times
longer** in the gate than it does alone, and its subject is a timeout. A test that decides "no answer
is coming" against a clock will decide it wrongly on a machine where the answer is merely slow.

The ethrpc one is not the choose-then-bind race the `tls` entry above turned out to be: `anvil()` waits
for the port with a *connect* rather than a sleep, and gives it 200 seconds. It reported `node.ok()`
and then had its RPC refused, so the node came up and went away — which on a box where three agents
share 11.9 GB and a real Ethereum client wants hundreds of megabytes reads as the kernel choosing.

**What that suggests about the fix.** Several of these are tests that measure patience: a deadlock
detector, a port waiter, a responder. Their thresholds were chosen on an idle machine. Rather than
retrying each one, the thing to ask is whether a test that decides something *did not happen in time*
can be made to say so against work done rather than against a wall clock — because the gate's own
memory floor already concedes that this box is not idle.
