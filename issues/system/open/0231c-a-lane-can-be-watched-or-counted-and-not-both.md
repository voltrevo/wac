# 0231c — a lane can be watched or counted, not both: `Cli.execWith` has no incremental read

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-21
- **Kind:** missing feature (not a blocker — see the recipe below)
- **Symptom:** no error

## What the suite does today, and why the two lanes differ

`tools/runTests.wac` starts its Deno pass with `inherit` and its `wac test` chunks buffered. That is
not a preference; each lane is at the only setting that works for it.

- **The Deno pass is inherited**, because a three-minute pass that prints nothing until it ends is
  unusable. The consequence is that nothing in the runner reads its summary, so the runner cannot add
  the two lanes together and says so in its footer instead.
- **The wac lane is buffered**, for two reasons. Four workers writing to one terminal interleave a
  chunk's `── file` headers with another chunk's failures — the reason the TypeScript runner gave. And
  the lane's own counts are parsed out of those blocks: `375 wac test files`, `2387 tests`, and the
  "N of 53 runs reported a summary" check that catches a lane which quietly stopped running half its
  directories. A lane that inherited could report none of that.

So: **the lane we read cannot stream, and the lane we stream cannot be counted.** Both follow from one
gap — `Cli.execWith` has two modes and nothing between them.

## What it costs, measured 2026-08-21

54 chunks at four workers, so output lands often. But:

- the longest single chunk held **66 seconds** of its own output before printing any of it
  (`packages/wacc/test/wac`, 11 files), and in another run **151s**;
- a slow *file* inside a fast chunk is invisible until the chunk ends, so "which file is it stuck on"
  is a question the lane cannot answer while it is stuck;
- `issues/system/0175` wants a per-test deadline, and a deadline that cannot say what it interrupted
  is half a feature;
- the suite's footer cannot state a total, which is what made a reader take 1,690 for the whole suite
  when 2,387 more ran in the other lane.

None of it loses information: a hang shows up as a chunk that never prints, and every block arrives
eventually. It is *latency* on a diagnosis, not a missing one.

## The source is not the problem, which is worth stating before anybody looks there

**`wac test` streams.** Run directly with its output redirected to a file, the file grows as it goes:

    t= 3s  bytes=0        (the aggregate build a directory's tests share — issues/system/0192)
    t= 6s  bytes=326
    t=15s  bytes=528
    t=18s  bytes=1206
    t=24s  bytes=10178

The host flushes every write, so this holds into a pipe and not only onto a terminal. Nothing is
buffered at the source, and none of what this issue describes is inherent to `wac test` — the bytes
are already available incrementally. What is missing is the *parent's* ability to take them that way:
`Cli.execWith` either hands the whole answer back at the end or hands the descriptor over and keeps
nothing. There is no third option, and a runner needs both halves of one.

The three-second head start is the build, and `inherit` would not close that either: it is silence
with nothing yet to say.

## It can be done today, and that changes what this issue is

**Measured with a probe, 2026-08-21.** Two children, each printing five lines a second apart, from a
wac parent using nothing that does not exist:

    [one] one line 1        <- printed while both children were still running
    [two] two line 1
    ... ten such lines ...
    [one] finished, status 0
    polls: 18                            (2 would mean the deadline never fired)
    prints before either child exited: 10 (0 would mean nothing streamed)
    bytes counted: one=55 two=55         (the parent still has every byte)

The recipe, all of it current API:

1. each chunk gets a shell redirect to its own log — `sh -c 'wac test … > log 2>&1'`, because `exec`
   has no redirect of its own;
2. the parent waits with a **deadline** rather than for ever: `core.waitAny(ids, 300)` returns -1 when
   nothing settled, which is the parent getting control back while the children run;
3. on each wake it re-reads each active log from a remembered offset and prints the whole lines that
   are new, prefixed with the chunk. A partial line is held, which is what stops two children
   splicing into each other — the thing buffering was working around.

So **the platform does not need fixing for the runner to stream and count**. What this issue asks for
is a cleaner way to do it, and the difference is now priced rather than assumed:

| | with a streaming read | with the shell-and-tail recipe |
|---|---|---|
| processes | one per chunk | two per chunk (a shell each: 54 more in a full run) |
| reading cost | the bytes once | each active log re-read per wake — O(n²) in a chunk's output |
| files | none | one log per chunk, in a directory somebody has to sweep |
| latency | the host's write | the poll interval, 300ms in the probe |
| lines | already framed | framed by the parent, which must hold partial lines |

The re-read is the only one that could bite: chunk logs are about 10 KB, so re-reading four of them a
few times a second is nothing, and a chunk that produced megabytes would make it quadratic. That is a
reason to prefer the capability, not a reason to wait for it.

## What is being asked for

An incremental read on `Cli.execWith` — the streaming form `issues/system/0165` deferred with the
right reasoning at the time:

> Of the 107 host-side test files that spawn a process, not one reads a child's output while still
> writing to it… So there is no streaming form here, and adding one should wait for a caller that
> needs it.

**This is that caller**, and it is a different shape from the fifteen that issue counted: those keep a
server alive and talk to it over a socket, which `connect` already does. A test runner wants lines
from a child *as they arrive*, with the child's identity attached, so that four children can be
multiplexed onto one terminal without their output interleaving — which is the thing buffering is
working around.

## The smaller thing that would also help, if the capability is too big

The interleaving problem is only real at more than one worker. A run with a single chunk — which is
what `deno task test packages/foo` usually produces — could inherit safely. That is a two-line change
in the lane and it is **not** proposed here, because it would trade the counts away for exactly the
runs where a person is watching, and the counts are what `issues/system/0161`'s migration is measured
by. Worth revisiting if the count moves somewhere else.

## What is *not* the problem

- Not the orchestrator's language. The TypeScript runner had the same split for the same first reason;
  what is new is that the second reason has been written down.
- Not `inherit` being wrong. It is what makes the Deno pass watchable, and the probe in
  `packages/platform/test/wac/exec_probe.wac` shows it reaching the real descriptor on four hosts.
