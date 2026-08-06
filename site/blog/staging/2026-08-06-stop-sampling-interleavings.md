# Three days sampling, one hour walking

A test in my suite hung. Not failed — hung, about once in fifty runs, and only when the machine was
otherwise idle. Three days of instrumentation told me exactly what the *state* was and nothing about how
it got there. Then two changes found it in an afternoon: making the semantics enumerable, and taking the
schedule away from the operating system. This is about both, and about why the first one alone was not
enough.

## What a hang tells you, which is nothing

The test runs 681 shell scripts through two shells and compares the output. When it wedged, here is
everything the runner said:

```
'every script agrees with bash on output and exit status' has been running for over (4m0s)
```

That is true and useless. Six hundred and eighty-one scripts went in; the one that is stuck is not named.
The suite has a 45-minute timeout, so a wedge cost forty-five minutes of a shared machine and produced no
information at all.

So I instrumented. In stages, over three days:

- The worker pool prints what it is still holding when nothing completes for 45 seconds. That gave me
  *four scripts, one per worker, the tail of the queue* — every worker stuck, nothing else running.
- Each case runs a real `bash` and our own shell concurrently, so the pool entry got a note saying which
  half was outstanding. That gave me **`[wacsh]`**: bash returned every time; ours never did.
- The runner reports which phase it is in. That gave me **`running`**: the child had started and never
  finished, so the output-draining code was never even reached.
- The bridge between the host and the child prints its slot table. That gave me a slot marked `running`
  with the host alive and its counters frozen: a call the host had accepted and never answered.

Each of those took a day of waiting for a hang that happens once in fifty runs on an idle machine — and my
own instrumentation runs made the machine less idle, which made the hang rarer. I want to be fair to this
part: **the instrumentation was necessary**. It told me which of five layers to look at. But I was
sampling. Every run drew one interleaving out of an enormous space and asked "was it this one?"

## The thing I should have done on day one

The queue underneath all of this is about eighty lines: bytes in, bytes out, a cap so a producer whose
reader is behind gets blocked rather than dropped. It was written as a class, with promises in it — a
waiting reader stored in a field, parked writers in a list, resolvers called when the state changes.

That design mixes two things: **what the queue means**, and **when things happen**. And only the second
one is nondeterministic.

So I split them. The meaning became a pure function:

```ts
apply(state, event) → { state, effects }
```

No promises, no timers, no clock. Events are `push`, `next`, `end`. Effects are "resolve this reader with
these bytes", "tell this writer it was accepted". The class became a driver: it turns promises into
events, applies them, and turns effects back into resolutions. It holds no rules of its own.

That refactor is worth nothing by itself. What it buys is that you can now walk the state space instead of
sampling it:

```
every sequence of pushes, reads, ends and cap-driven parks, to depth six:
117,649 paths, checked at every step — 0.2 seconds
```

The invariants are the interesting part, and each one is a bug this codebase has actually had or a hang it
could have:

- a reader told the stream ended when it had not;
- a reader parked while bytes sit queued (a lost wakeup);
- the first parked writer having room and not being released;
- bytes lost, duplicated or reordered after their writer was told "accepted".

## The test that makes the other tests worth running

Here is the part I would argue for hardest. An invariant set that passes a known bug is decoration, and
you cannot tell the difference by reading it. So two of the four tests are **mutants**: they re-introduce
bugs this codebase actually had, and require the enumeration to *fail*.

One of those bugs is my favourite in the repo. The queue treats an empty chunk as end-of-stream. A shell
builtin returned zero bytes. Handed to a *waiting* reader, that zero-length write ended the stream, so
`echo one; true; echo two` printed `one` and nothing else — but only when the reader happened to be
parked at that exact moment, which is why it survived a long time.

Put back into the model, the walk fails in 34 milliseconds and prints the path:

```
push(1b) → push(1b) → next(≤64) → next(≤1) → push(0b)
```

A reader parked, then a zero-length write. That is the counter-example a human took days to find, produced
by exhaustion rather than luck.

## Then it found the thing I was actually looking for

With the queue proved sound for every interleaving, the next step was suddenly obvious, and I would not
have seen it otherwise: **a stream that never ends is not a queue bug. It is `end()` never being called.**

So I gave the child's lifecycle the same treatment — the four things the runtime can tell you about a
child process, in any order, possibly more than once: it loaded, it finished, it died, the readiness
deadline expired. Plus the caller giving up and killing it.

The walk reported a violation at **depth one**:

> `kill` on a child that has not yet reported ready leaves both its "loaded" and its "exit" unsettled.

In the real code, `kill` was the teardown function: it stopped the responder and closed the streams, and
settled neither promise. Meanwhile, asking for a child's exit code is `await child.exit`, and closing a
child's handle anywhere calls `kill`. So: ask for the exit code of a child somebody closed, and you wait
for ever — parked on a call that can never be answered, with the host alive and its counters frozen.

That is the state I had spent three days measuring, described exactly, by a walk that takes a millisecond.

That was a real bug and it is fixed. **It was not the one I was chasing**, and finding that out is the
rest of this story.

## The part where the model was not enough

Enumeration proves things about a design. It cannot tell you which of several possible causes is the one
your machine is actually hitting, because it has no idea what your machine did.

So I built the other half: a scheduler. The host answers a worker's calls, and a worker only makes
progress when it is answered — so the order answers are *delivered* in is the order the whole system runs
in, and today that order is whichever handler's promise resolved first. I made it a choice instead. One
worker running at a time, and among the answers that are ready, either the order they became ready or a
seeded pick.

Then I pointed it at the test that hangs once in fifty runs.

**It hung four times out of four.** In two and a half minutes, on a busy machine, with a report that
listed every bridge in the process at once:

```
bridge 1036: 0:running:RECV(h=3) 1:running:RECV(h=4)   ← a shell reading a child's two streams
bridge 1044: 0:running:READ_CHUNK                      ← that child, reading its own standard input
   …four of each…
```

Four shells waiting for their children's output. Four children waiting for their own standard input. A
cycle, and one line of code long.

A spawned program that inherits standard input inherited it *by omission*: the code left two options out
of the child's world, and a world without them falls back to the process's real standard input. That is
right for a program you run from a terminal. Inside a test it means the child was handed **the test
runner's** standard input, which never ends — while its parent held a queue that had already ended and
would have said so immediately. The parent waited for output the child would never write.

Why once in fifty, and only on an idle machine? The child had to reach its read before the parent's read
was satisfied. A loaded machine spread the two apart; an idle one packed them together. The bad state was
reachable all along and only by luck — and **luck cannot be bisected**, which is why three days of
increasingly precise instrumentation kept describing the state and never the cause.

The fix took a minute once it was visible: inherit the parent's input if the parent has one, fall back to
the real thing only if the parent was reading the real thing too. The scheduled corpus went from four
deadlocks at 155 seconds each to passing in 24. And the eight-fold slowdown I had blamed on the
scheduler's serialisation was this deadlock the whole time; scheduling costs about twenty per cent.

## What I would tell myself on day one

**Nondeterminism in the schedule is not nondeterminism in the meaning.** A queue that can be read before
or after it is written has one legal behaviour for each order. If those behaviours live inside promise
callbacks, the only way to see them is to run the program and hope. If they live in a function of `(state,
event)`, you can look at all of them before lunch.

**Enumeration proves a design; a scheduler reproduces a run.** They are different tools and I needed
both. The walk told me the queue was sound, which is what made "the stream is never ended" the next
question rather than a guess. The scheduler turned a once-in-fifty accident into something that happened
every time I asked. Neither would have got there alone.

**A model earns nothing until it is checked against the code.** Mine is: a thousand seeded operation
sequences run against the real queue and the model, compared call for call. Otherwise the model becomes a
fiction that passes — the most dangerous outcome available, because it looks like evidence.

**Say what it does not cover.** This is a model of a protocol, not of memory. A plain load where an atomic
one belongs, or a torn read of a shared buffer, is invisible to it and always will be. The bugs it caught
were protocol bugs. That is not everything.

**And two of my own invariants were wrong before any of them found anything.** One said a parked writer
with room must be released — but a writer queued *behind* one that does not fit has to wait, or two
producers' bytes interleave. The other allocated byte identities from a global counter that wrapped at
256, about nineteen thousand nodes into the walk, and reported a duplicate that was mine. Both are written
down in the file where they were wrong. A checker that has never accused correct code has not been used
much.
