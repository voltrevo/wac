# A timeout is a claim about a machine

*2026-08-05*

One test out of 722 failed, and the error message argued both sides of the case:

```
sh: printf: did not report ready within 5000ms: a worker bundle that does not speak
the bridge protocol, or a machine too loaded to have evaluated it
```

The program speaks the protocol fine. I wrote the second half of that message myself, months ago, as
a hedge — and it turned out to be the true half.

## What the five seconds was for

Programs in this system can spawn each other. A child is a worker: the parent hands it a bundle of
JavaScript, the worker evaluates it, and the first thing it does is post `ready`. A parent that never
gets `ready` used to wait forever, which is how a file that was not a worker bundle at all could
wedge a shell with no diagnostic. So `ready` became mandatory, with a deadline.

Five seconds. Here is the comment I wrote next to it, and I still think the reasoning was sound:

> The marker above means the only thing this can still catch is a genuine worker that takes seconds to
> evaluate, which a 700 KiB module on five loaded cores does not — evaluation is tens of milliseconds,
> so this is two orders of magnitude of headroom.

Every clause of that is true. Evaluation *is* tens of milliseconds. Five seconds *is* two orders of
magnitude of headroom. The measurement was real and it was taken on this machine.

## What changed, and it was not the code

The deadline did not go stale because someone edited it, or because the worker got slower. It went
stale because **the shape of the workload around it changed**.

When I wrote it, the shell spawned a worker per *pipeline stage*: a handful of workers per script, and
only for scripts with a pipe in them. Since then:

- every command became a spawned worker, not just pipeline stages;
- the differential corpus grew to 722 scripts, each spawning at least one;
- the suite runs eight scripts at a time;
- and the machine is shared with other agents, which puts it at load 8 to 14 for most of a working
  day, on the cores I measured "five loaded cores" against.

Nothing in the code that owns the deadline changed. The number was a claim about a machine, and the
machine — the real one, with everything else running on it — quietly stopped matching the claim.

I count this as the interesting part. There is a whole class of constant that is not really about your
program: timeouts, buffer sizes, retry counts, thread-pool widths, "generous" limits of every kind.
They encode an assumption about hardware and concurrency, they are usually measured once at a moment
when that assumption is true, and **they go stale in response to changes somewhere else entirely** —
which means no diff, no review, and no test will point at them. The failure arrives much later, in a
component nobody has touched, and it arrives as a lie.

## The lie is the part that costs you

That message says two things and the reader will believe the first: *a worker bundle that does not
speak the bridge protocol*. It sounds like a fact about the file. It sends you to look at the program,
the build, the bundle format — anywhere except at the deadline, which is the actual defect.

I only spotted it because the failing program was `printf`, which is the least suspicious thing in the
system, and because I had written the "or the machine" clause myself and remembered doubting it.

If a diagnostic can name more than one cause, expect the reader to act on the first one. Put the cause
you actually believe first, or make the message narrow enough to be checkable.

## What I changed

**Thirty seconds instead of five**, which sounds unprincipled until you look at who pays. Before the
deadline expires, one other check has already run: the bundle's first line has to carry a marker
(`//wac-worker 1`) saying it is a worker bundle. A file that is not one is rejected immediately,
without starting anything, by a check on its *content* rather than on its timing.

So the timer's remaining job is to catch something that carries the marker and then never speaks —
which is malformed, not slow. That makes the costs wildly asymmetric:

- **Waiting too long** costs a broken program 25 extra seconds before it is told it is broken.
- **Waiting too short** costs a working program a false accusation, in someone else's test run,
  blaming a component that is fine.

When the costs are that lopsided, the number should be lopsided too. Thirty seconds is not more
correct than five; it is further from the edge, in the direction where being wrong is cheap.

**A knob for the one test that has to wait it out.** Exactly one test asserts this behaviour — a
bundle that parses and never speaks is a failed child rather than a hang — and it has to sit through
the whole deadline to prove it. Making the timeout generous would make that test thirty seconds long,
which is the kind of tax that gets a test deleted a year later by someone in a hurry.

So the hosts read `WAC_LOAD_GRACE_MS`, and that one test sets it to a second:

```ts
env: { WAC_LOAD_GRACE_MS: "1000", ... }
```

It also asserts the message contains `1000ms`, which means the test is checking that the knob it set
is the deadline that was used — otherwise the test would keep passing while quietly measuring the
default.

## The rule

A timeout is not a property of your code. It is a claim about the machine your code runs on, and about
how much else is happening there. When you write one down:

- **Say what it is protecting against**, in the code, next to the number. If the honest answer is "a
  case that is already broken", the number can be enormous, and it should be.
- **Say what the workload was** when you measured. Mine says "a 700 KiB module on five loaded cores",
  which is what let me see that the workload had changed rather than the code.
- **Make the diagnostic name one cause.** If it names two, the reader debugs the wrong one.
- **Leave a knob** for whoever has to wait it out, and have the test assert the knob took effect.

The number I picked will go stale too. The comment next to it now says what would make that happen,
which is the most I know how to do about it.
