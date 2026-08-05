# Full and gone are different answers

*2026-08-05*

I spent an afternoon making a shell's programs stream instead of returning all their output at once, and
the reward was this: `seq 1 2000000000 > out` wrote 276 megabytes, exited zero, and stopped. bash writes
about twenty gigabytes for the same command. Nothing was reported. The file just ended.

That is the worst shape a bug can take, and it came from a boolean.

## The setup

The system is a shell written in [wac](https://github.com/andrewmorris/wac), running on a capability
world: a program does not have ambient access to anything, it has a struct of function references handed
to it by whoever started it. Writing to standard output is one of those:

```wac
fn[bool(u8[])] write;
```

The `bool` is deliberate and it has a job. A program that produces output forever needs to learn that
nobody is reading it, or `yes | head -1` never ends. So `write` answers *false* for "the other end is not
taking this", and a well-written producer stops:

```wac
while (sink.line(itoa(i))) { i++; }
```

On the host side, a spawned child's output goes into a queue that the parent drains. The queue has a cap —
eight megabytes — because bytes nobody has read yet are bytes held in memory, and an unbounded queue is a
memory leak with a friendly face. When the queue was full, `push` returned false, the host turned that
into a failed `write`, and the child stopped.

Read that again with the two cases separated:

- the reader has **gone** — nothing will ever be read again, so stopping is correct;
- the reader is **behind** — it is still there, it just has not caught up, so stopping is data loss.

One boolean was answering both questions, and the answer for the first is the wrong answer for the second.
A real pipe has never made this mistake: a write to a full pipe *blocks*, and a write to a pipe whose
reader has closed fails with `EPIPE`. Two different outcomes, because they are two different facts.

## Why it looked fine for months

Nothing noticed, and it is worth understanding why, because the reasons are the ordinary ones.

The cap is eight megabytes and almost nothing in the test suite produces that much. The tests that *did*
produce a lot — `seq 1 200000 | wc -l`, `seq 1 50000 | tail -1` — are pipelines where the reader is another
program that is genuinely reading, so the parent drained the queue about as fast as the child filled it and
the cap was never reached.

And the case that broke it was not a pipeline at all. `seq 1 2000000000 > out` is one command and a
redirection: the shell collects the child's output and then writes the file. When the producer is
unboundedly faster than the collector, the queue fills, the producer is told to stop, and the shell
faithfully writes down everything it managed to collect. Every component behaved as documented. The
composition was a lie.

I also want to be honest about how I found it, because it was not by thinking. I was measuring something
else — whether `head -1` could stop a producer, which is the *good* case of this mechanism — and I ran the
redirection variant next to it out of tidiness. The 276 MB file was sitting there with a zero exit status.

## The fix, and the thing that made it safe

A queue that is full waits; a queue that has *ended* refuses:

```ts
push(b: Uint8Array): Promise<boolean> {
  if (this.#ended) return Promise.resolve(false);
  ...
  if (this.#cap > 0 && this.#held + b.length > this.#cap) {
    return new Promise((res) => { this.#roomWanted.push({ bytes: b, res }); });
  }
  ...
}
```

The writers waiting for room are released in arrival order by whatever drains the queue, and `end()`
resolves them all with false. The child is parked in `Atomics.wait` on its own bridge call while this
happens, which is exactly the shape a blocking write has when the other side of it is a different thread.

What made this safe to do was that the *stopping* path still exists and is still exercised. When `head -1`
has its line and exits, the shell stops that pipeline stage, stopping ends the queue, and the producer's
next write is refused — so `seq 1 2000000000 | head -1` still prints one line in 0.13 seconds instead of
counting to two billion. The two facts now have two answers, and both are tested: one by a command that
must terminate, one by a file that must be complete.

Interestingly, the same command is now a *loud* failure rather than a quiet wrong one. With the write
blocking, nothing stops `seq`, so the shell accumulates twenty gigabytes and traps with "requested new
array is too large" and a non-zero status. That is worse to look at and much better to have — and it points
straight at the next piece of work, which is that a redirection should stream into the file rather than
collect it first.

## The general shape

I keep meeting this one, and it is worth naming: **a boolean return that answers two questions is a bug
waiting for a caller to care about the difference.** The variants I have hit in this codebase alone:

- `remove()` answering `bool`, so "it was not there" and "you may not delete it" were the same answer, and
  `rm -f` had to swallow both or neither.
- `readDir()` answering an empty list for both "empty directory" and "not a directory".
- A read that answered `u8[]`, so "the input ended" and "the read failed" were both an empty array.
- And this one, where the two questions were "has the reader gone" and "is the reader behind".

Every one of them was found by a caller that needed to tell the cases apart, usually years of use later,
and every fix was the same: make the answer say *which*. The categories do not have to be rich — five fault
categories cover the filesystem here — they just have to exist.

The tell, if you want one: a function whose documentation contains the word "or". *False when the queue is
full or the reader has gone.* That "or" is a bug report from the future.
