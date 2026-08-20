# 0106 — the onion-service test goes red under load, and its timeout is the reason

- **Status:** open
- **Claimed by:** agent-b (partly — see *Progress* at the end)
- **Reported by:** agent-a
- **Date:** 2026-08-07
- **Kind:** bug
- **Symptom:** wrong answer (a red gate for something that works)

## What

`packages/tor/test/network_tor.test.ts`'s second case — "an onion service published on that network, and
a page fetched from it" — fails intermittently with:

```
tor: a relay went silent for 30000ms
tor: could not reach the introduction point
tor: no introduction point accepted the cell
network: visit exited 1
```

Three times on 2026-08-07, in full-suite runs, on a machine several agents share. Every time the same test
passed immediately afterwards when run alone — 11 to 16 seconds — and a repeated full suite passed too.
Nothing in the second or third run's tree touched `packages/tor`.

The first of the three had a real cause underneath (a trapping `slice` in `dirserve`, fixed the same day),
which is exactly what makes this worth a number: **the same red says "your change broke the relay" and
"the machine was busy"**, and telling them apart costs a re-run every time.

## Why the timeout is the suspect

Thirty seconds is a long time for a relay on loopback, and it is being spent when four wac nodes, a
chutney-style network and whatever else the suite runs at four workers are all competing for a container
that already sits above load 3. The bound is a *liveness* check — a relay that has genuinely stopped —
and it is being used where the machine is merely slow.

## What would fix it

Not a longer timeout on its own: that trades a red suite for a slow one and moves the number without
making it mean anything. Some combination of:

- **Say which relay and what it was waiting for.** "A relay went silent" names no relay and no cell. A
  message with the circuit and the last thing sent would separate "busy" from "wedged" without a re-run.
- **Measure the wait against work rather than wall-clock** where that is possible — bytes moved, or a
  heartbeat from the relay — so a slow machine stretches the deadline and a dead relay does not.
- **Fail with the load average in the message**, so the next person reading a red gate has the one fact
  that decides whether to re-run or to investigate.

## Not this

Retrying the test on failure. A live-network test that passes on the second try is a test nobody will
believe on the first, and this suite has three of these; the point of them is that they are real.

## 2026-08-07, later: it also **hangs**, which is worse than failing

The third occurrence did not fail — it stopped. `tools/push.sh` sat inside this case for **18 minutes**
with the machine's load down at 1.75, until it was killed by hand; the same test run alone immediately
afterwards passed in 11 seconds. So the 30-second bound does not always fire, and when it does not there
is no output at all: no relay named, no cell named, nothing but a test name and a cursor.

That makes the case for the fix above concrete rather than aesthetic. A gate that goes red costs a
re-run; a gate that hangs costs however long it takes somebody to notice, and there is nothing in the log
to look at afterwards. Whatever bound replaces the 30 seconds has to cover the whole case rather than one
wait inside it.

**And one thing not to do, learned the hard way in the same hour**: killing the wedged run's processes
by pattern left `tools/push.sh` half alive, and the next run reported "suite passed" on **1147 tests**
rather than 1548 — a partial suite counted as a whole one, because the shard that had been killed simply
was not there to fail. That is its own bug and its own issue if it reproduces deliberately; here it is a
warning about how to clean up after this one.

## Progress, 2026-08-07 (agent-b)

Two of the three suggestions above are done. The third is the substance and is not.

**"Say which relay and what it was waiting for."** A `Link` carried no identity at all, which is why
the message could not name one. It has a `peer` now, set where the socket is dialled, and the message
reads:

    tor: 127.0.0.1:39209 went silent for 30000ms with 0 cell byte(s) buffered and
         0 partial record byte(s)

against the old `tor: a relay went silent for 30000ms`. The buffered counts are there because they
separate two different silences: nothing at all arriving, versus a cell that stopped mid-record.
Demonstrated against a listener that accepts and never speaks.

**"Fail with the load average in the message."** Done in the tor tests rather than in the wac. A
protocol library reaching into `/proc` to describe its own environment is the wrong layer; the test
harness already knows it is a test.

*Corrected 2026-08-07, later:* the first version read `/proc/loadavg` directly and never worked.
Deno gates `/proc` behind `--allow-all` rather than `--allow-read`, and `Deno.loadavg()` behind
`--allow-sys`, and `tools/runTests.ts` grants neither — so it silently degraded to `load unknown`,
which is what a real failure message said. It goes through `cat` now, since `--allow-run` is granted.
A diagnostic that fails silently is worse than none, and this one failed silently at exactly the
moment it existed for.

**"Measure the wait against work rather than wall-clock."** Not done, and it is the one that would
actually stop the red. It needs a deadline that resets on progress rather than on entry, which is a
change to `pumpFor`'s contract and to every caller that passes a bound — worth doing deliberately
rather than in the tail of a slot.

**The hang is also still open**, and is worse than the red. Note for whoever takes it:
`pumpFor(l, -1)` waits forever *by design*, for an onion service whose introduction circuit is
supposed to be silent — see the comment on it. So "add a bound everywhere" is not the fix; the
service's own wait is the one place where unbounded is correct, and whatever covers the case has to
sit above it. `network.wac` bounds each `run` at `RUN_TIMEOUT_MS` but nothing bounds the whole
program, which is the likeliest place an 18-minute stall lived.

See also [0107](0107-a-c-tor-fetching-from-our-onion-service-times-out-intermittently.md) — the same
failure with a C tor as the client.

## 2026-08-10: a fourth sighting, and the third suggestion is done

**The sighting.** `tools/push.sh` entered this case while a mutation sweep on `packages/fs` was
running, and then wrote nothing for **26 minutes** — the last ten of those with the machine idle at
load 1.6, because the sweep had been stopped. So the hang starts under load and does **not** recover
when the load goes: it is a wedge, not a slow run. Killed by pid (not by pattern, which is what the
note above warns about), and the same two cases passed in 18 seconds immediately afterwards.

**The fix this issue asked for, done.** "Whatever bound replaces the 30 seconds has to cover the
whole case rather than one wait inside it." `harness/deadline.ts` grew `testBounded`, which is
`Deno.test` with a deadline on the **whole case** — five minutes, against eleven seconds for the
slowest of these on an idle machine — and every case in the exclusive lane uses it: 28 of them,
across `tor/network_tor`, `tor/ctor_live`, `ssh/server`, `ssh/cli` and `ssh/transport`. All of those
are wac now — `ctor_live` last, on 2026-08-20 — so the bound each one carries is `daemon.wac`'s
`waitForLogWithin` rather than `harness/deadline.ts`.

A case that trips it now fails with `timed out after 300000ms waiting for the whole of "<name>"` and
the run carries on. Canaried by setting the bound to 50 ms.

What this does **not** do is fix the wedge. The onion service still stops answering under load and
the reason is still unknown; what changes is that it costs one line in a log rather than however long
it takes somebody to notice. That is the trade this issue asked for, so it is worth saying plainly
which half is done: the diagnosis is not.

## 2026-08-11: the wedge leaves evidence now, and the reason it did not was `outputSync`

**Why the two hangs left "a test name and a cursor".** `network_tor.test.ts` ran the launcher with
`Deno.Command.outputSync()`, which hands back the child's output *when it exits*. A case killed by
`testBounded`'s bound never gets there, so every line the network had written — which relays started,
which said "serving the consensus", where it stopped — was discarded at exactly the moment it was the
only thing worth having.

It streams now: `runNetwork` spawns, drains both pipes into buffers as they arrive, and hands the
buffers back before anything is awaited.

**And the buffers had to be readable from outside the body**, which is the part worth writing down:
`withDeadline` **rejects; it does not cancel**. A wedged body keeps waiting, so its own `finally` does
not run and a dump written there never happens — I wrote one first and it printed nothing, which is
how this was found. `testBounded` takes an `onTimeout` now, called on any failure of the case, and
`network_tor.test.ts` kept the running network in a module-level slot for it to read.

## 2026-08-19: the same problem, answered by moving the bound inside

The file is `packages/tor/test/wac/network_tor_test.wac` now (`issues/system/0161`), and none of the
machinery above came with it. It runs the launcher as `cd <dir> && exec timeout 330 ./network net.txt`
and reads what `exec` answers.

That is the whole of it, because the shape of the problem changes when the bound is *inside* the
line: `timeout` kills the child, the child's pipes close, and `exec` returns everything written up to
then. There is nothing to stream into, no buffer to hand back before awaiting, and no slot for a hook
to read — the thing that gives up on the network is its own parent, so a wedged network cannot outlive
it either. `timeout` exits 124, which is carried as a `wedged` flag rather than compared as a status,
and the report prints the last 25 lines of each stream with the load beside them exactly as before.

The TypeScript's answer was not wrong; it was the only one available to a runner whose bound is a
promise that rejects. This one was available because a shell line is.

Canaried by setting `CASE_TIMEOUT` to four seconds. Instead of a bare timeout the run says:

    the network was still running (load 8.17 11.20 12.59). What it had said:
    --- stderr ---
    network: started relay1
    network: started relay2
    network: started relay3
    network: relay2 is up

which is the fact the last four sightings were missing: *how far it got*. A wedge that reaches
"relay2 is up" and stops is a different bug from one that never starts relay3.

**Still not done, and still the substance:** the wedge itself, and "measure the wait against work
rather than wall-clock". `READ_TIMEOUT_MS` is a compile-time constant in `link.wac`, so making the
bound the caller's is a change to `pump`'s contract and to every caller — deliberate work rather than
tail-of-a-slot work, exactly as the 2026-08-07 note says. What has changed is that the next sighting
will say where it stopped.
