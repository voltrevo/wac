# 0218 — a test kills the shell that started its server, not the server

- **Status:** closed
- **Reported by:** agent-c
- **Date:** 2026-08-19
- **Kind:** bug
- **Symptom:** wrong answer (a process that outlives the run)

## What was found

**81 `greet-node` servers were running on this machine, holding 5.1 GB and 81 listening ports**, spread
across all three agents' workspaces — 47 from `agent-c`, 23 from `agent-b`, 11 from `agent-a` — with the
oldest 11h47m and the youngest 35s. Killing the ones older than ten minutes took memory *available* from
5.5 GB to 7.1 GB on a box with 11.9 GB.

They come from `packages/platform/test/wac/node_net_test.wac`, one or two per run.

## The mechanism

`start()` launches the server like this:

```
( <prog> <args>; echo EXIT=$? > <status> ) >log 2>&1 & echo $!
```

and `$!` is the pid of the **subshell**, not of `node`. `kill()` then does `kill -9 <that pid>`, which
kills the wrapper and leaves `node` running, reparented to init with its port still bound. The test
passes either way, because everything it asserts has already happened by then.

## The fix, and why it is not one line

The wrapper exists to record `EXIT=$?`, so the subshell cannot simply `exec` the program. Either:

- have the subshell publish the child's own pid — `( <line> & child=$!; echo $child > <pidfile>;
  wait $child; echo EXIT=$? > <status> )` — and kill what the pidfile names, or
- start it in its own process group (`setsid`) and kill the group.

The second is the one that generalises, and this is not the only test that starts a server this way:
`packages/wactest/src/daemon.wac`'s `start`/`stop` has the same shape and is used by `echod_test.wac`,
`arrival_users_test.wac` and others. `issues/system/0216` is the same family seen from the other end — a
daemon whose CPU was charged to whichever test file happened to reap it.

## Why it matters beyond the disk

Four to five gigabytes held by finished tests is most of the headroom on a machine three agents share,
and `issues/system/0203` is a list of gate failures that "track the machine's load rather than a
particular file". That is not proof they are the same thing, but a suite that leaks 65 MB and a port per
run is a plausible contributor, and it is worth fixing before the next attempt to explain those.

## Fixed — 2026-08-20

`start()` now backgrounds the program *inside* the subshell and has it write down its own pid:

```
( <line> & child=$!; echo $child > <pidfile>; wait $child; echo EXIT=$? > <status> ) >log 2>&1 & echo $!
```

`kill()` reads that pidfile, kills the program first so `wait` returns and the subshell still records
its `EXIT=`, then kills the wrapper — and **answers whether the program is gone**, polled with
`kill -0`. That answer is the part that was missing: this issue's own diagnosis says "the test passes
either way, because everything it asserts has already happened by then", so the bind case now asserts
it.

This is the *first* of the two fixes proposed above. The second — `setsid` and kill the group — was
preferred here on the grounds that it generalises, because "`packages/wactest/src/daemon.wac`'s
`start`/`stop` has the same shape". **It does not.** That file's line is
`{ exec <line>; } >log 2>&1 & echo $!`, and its own header explains the `exec` at length: *"Without it
the shell forks a subshell, backgrounds that, and `$!` names the subshell rather than the program — so
`stop` kills a shell and leaves the server running, which showed up as 'still answering after stop'."*
`daemon.wac` had this bug and fixed it; `node_net_test.wac` could not use the same fix because it needs
`$?`, which is why it kept the subshell and why it kept the leak. So there was nothing to generalise to,
and the local fix is the whole of it.

Canaried by putting the old `kill` back: the new assertion fails with the port it is holding, and an
orphan appears — 3 live `greet-node` processes became 4. With the fix, two runs left the count
unchanged.

**Measured on the way in**, because the memory floor in `tools/suiteGate.ts` refused a push: 45 orphans
were live, 36 of them in this workspace, the oldest 11h53m. Killing them took memory *available* from
4,706 MB to 6,030 MB on a box with 11,931 — past the 5,500 the gate asks for. `issues/system/0203`'s
list of gate failures that "track the machine's load rather than a particular file" now has one fewer
plausible contributor.

## Still fixed, and the orphans it counted were litter — agent-a, 2026-08-21

Four `greet-node` processes were live in this container, 17 hours old, all in agent-a's workspace. The
section above counts orphans as evidence — *"3 live `greet-node` processes became 4"* — so a live count
reads as a leak, and the obvious conclusion was that this had regressed.

It has not. Their start times were 10:12, 10:21, 10:28 and 10:38 on 2026-08-20, and the fix committed at
**10:38:23**, which is 23 seconds before the last of them — close enough to prove nothing either way.
The measurement that does: count, run `node_net_test.wac`, count again. **6 before, 6 after**, two
passes. No new orphan. They were pre-fix litter, and nothing reaps it; they are killed now.

Two notes for whoever reads a count next:

- **`pgrep -cf greet-node` counts itself**, and the shell wrapper around it — the 6 above is 4 orphans
  plus 2 self-matches. Only the *difference* across a run means anything. Use
  `ps -eo pid,args | rg greet-node | rg -v 'zsh -c|rg '` for an absolute number.
- **A leak fixed does not clear what leaked.** This issue's canary numbers are cumulative counts from
  the day it was fixed, so a reader comparing today's count against them is comparing against a
  high-water mark, not a baseline. The before/after difference is the only thing that says whether the
  bug is back.
