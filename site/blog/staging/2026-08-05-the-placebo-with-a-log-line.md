# The placebo with a log line

*2026-08-05*

Two numbers in this project turned out to be decoration. One was measured once and went stale without
anyone touching it. The other was never measured at all, and printed a success message three times while
doing nothing that mattered. They are worth telling together, because the failure is the same failure:
a mechanism whose *claim* nobody had checked against the thing it claimed to affect.

## The mitigation that freed 0.8% of the problem

The machine this runs on is shared, and its disk had filled twice, failing pushes for whoever happened to
be pushing. So the push gate had a mitigation: on "No space left on device", clear Deno's cache and try
again.

```bash
freeDenoCache() {
  echo "== clearing ~/.cache/deno/gen and retrying: the disk is full and it is not this change =="
  rm -rf "$HOME/.cache/deno/gen"
}
```

That fired three times. Each time it printed its line, retried, and the suite passed — which is exactly
why nobody looked closer. Then I looked at the disk with 5.9 GB free out of 155 GB:

```
28G   ~/.cache/deno/v8_code_cache_v2
220M  ~/.cache/deno/gen              <- the directory the mitigation clears
```

**It had been freeing 220 megabytes while 28 gigabytes sat next to it.** Not a wrong theory —
a *stale* one. When it was written, `gen` really was the problem: a colleague had measured 23 GB there,
with 25,482 of 25,490 entries pointing at sources that no longer existed. They wrote a tool to prune it,
the tool worked, and the growth moved somewhere else without the mitigation noticing.

Somewhere else was V8's code cache. Deno keeps the compiled code for every script it runs, keyed by
content, and never evicts. This project builds programs constantly — each one a unique 400 KB bundle,
run once, deleted — so each leaves an entry that can never be hit again. One run of a single test file
added **166 MB**.

The fix is in the shebang every built program now carries:

```
#!/usr/bin/env -S DENO_EMIT_CACHE_MODE=disable deno run --no-code-cache --allow-read
```

`--no-code-cache` for V8's cache, `DENO_EMIT_CACHE_MODE=disable` for the transpile cache — `env -S` can
set a variable as well as run a command, which is the only place it can go, because whoever runs a built
binary is not going to set it for you. A full suite from an empty cache went from 118 MB + 1216 MB to
97 MB + 566 MB, and none of either now comes from built programs.

But the part I would take to another codebase is not the flags. It is that the mitigation had never been
asked to prove it moved the number it existed to move — and its log line was doing the opposite,
providing evidence of action every time it ran.

## The constant that was a claim about a machine

The other one is a timeout, and its own error message argued both sides of the case:

```
sh: printf: did not report ready within 5000ms: a worker bundle that does not speak
the bridge protocol, or a machine too loaded to have evaluated it
```

Programs here can spawn each other. A child is a worker: it is handed a bundle, evaluates it, and posts
`ready`. A parent that never hears `ready` used to wait forever, so `ready` became mandatory with a
deadline. Five seconds, and the comment I wrote next to it:

> The marker above means the only thing this can still catch is a genuine worker that takes seconds to
> evaluate, which a 700 KiB module on five loaded cores does not — evaluation is tens of milliseconds, so
> this is two orders of magnitude of headroom.

Every clause of that is true. Evaluation *is* tens of milliseconds. It *was* two orders of magnitude of
headroom, on the machine I measured, for the workload of the time.

Then the workload changed shape and nothing in the code did. When I wrote it, the shell spawned a worker
per *pipeline stage*: a handful per script, only for scripts with a pipe. Since then every command became
a spawned worker, the test corpus grew to 722 scripts, the suite runs eight at a time, and the machine
now sits at load 8–14 all day because other people are working on it too.

No diff touched the deadline. No test could point at it. The failure arrived months later in the least
suspicious program in the system — `printf` — and it arrived as a lie: *a worker bundle that does not
speak the bridge protocol*. That reads like a fact about the file. It sends you to the build, the bundle
format, the protocol; anywhere except the deadline, which was the actual defect.

**If a diagnostic names two causes, the reader will act on the first one.** Put the cause you actually
believe first, or make the message narrow enough to be checkable.

The fix was to make the number lopsided in the direction where being wrong is cheap. Before the deadline
can expire, a separate check has already rejected anything that is not a worker bundle, by looking at its
first line. So the timer's only remaining job is to catch something that carries the marker and then
never speaks — which is malformed, not slow. Which makes the costs wildly asymmetric:

- **Waiting too long** costs a broken program 25 extra seconds before it is told it is broken.
- **Waiting too short** costs a working program a false accusation, in someone else's test run, blaming
  a component that is fine.

Thirty seconds. That is not more *correct* than five; it is further from the edge, on the side where
being wrong is survivable. And exactly one test has to sit through the deadline to prove the behaviour,
so the hosts read `WAC_LOAD_GRACE_MS` and that test sets a second — then asserts the message contains
`1000ms`, so it is checking that the knob it set is the deadline that was used. Otherwise it would keep
passing while quietly measuring the default.

## What both of them have in common

Neither was a bad decision. Both were *good decisions with an expiry date that nobody wrote down*.

- The cache mitigation was correct when the growth was in `gen`, and became decoration when the growth
  moved. It had no way to notice, because it never compared the space it freed against the space that was
  missing.
- The timeout was correct for a workload with a few spawns per script, and became a tripwire when the
  workload became a spawn per command. It had no way to notice, because a constant cannot see the
  concurrency around it.

There is a whole class of these: timeouts, buffer sizes, retry counts, thread-pool widths, cache
limits, "generous" bounds of every kind. They encode an assumption about hardware and concurrency,
they are usually measured once at a moment when the assumption holds, and **they go stale in response to
changes somewhere else entirely** — so no diff, no review and no test points at them.

What I do now, and it is cheap:

- **Say what the number is protecting against**, in the code, beside it. If the honest answer is "a case
  that is already broken", the number can be enormous, and it should be.
- **Say what the workload was** when you measured. Mine said "a 700 KiB module on five loaded cores",
  which is the only reason I could see that the workload had changed rather than the code.
- **Make a mitigation report the metric it claims to move**, not the fact that it ran. `freeDenoCache`
  now prints the three largest directories before it deletes anything, which would have made three years
  of nothing visible in three seconds.
- **Make the diagnostic name one cause.** If it names two, the reader debugs the wrong one.

The number I picked will go stale too. What is next to it now is the thing that would let someone else
notice — which is the most I know how to do about it.
