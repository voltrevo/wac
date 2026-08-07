# 0106 — the onion-service test goes red under load, and its timeout is the reason

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
