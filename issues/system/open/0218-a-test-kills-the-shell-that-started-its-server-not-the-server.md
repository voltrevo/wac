# 0218 — a test kills the shell that started its server, not the server

- **Status:** open
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
