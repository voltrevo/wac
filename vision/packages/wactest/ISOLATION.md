# The second consumer of `schedule`, and what it found

Written 2026-09-04, beside [`README.md`](README.md)'s rewrite of the same package. Read
[`../README.md`](../README.md) first: not vetted, does not compile, disposable.

[`src/isolate.wac`](src/isolate.wac) is thirty lines. `schedule` had exactly one consumer before it —
`Sys.drain` — so nothing had tested whether the primitive composes, and three things fall out of
using it twice.

---

## The problem it solves is real

`std/platform.wac` on `drain`: *"A `main` that schedules and returns without draining leaves work
outstanding, which the host treats as an error; `dropAll` is how a program says it meant to."* The
host asks `outstanding()` **once**, before deciding a clean exit.

A runner runs many tests in one program against one `Core`, so there is one queue for all of them. A
test that schedules and does not drain leaves work that runs during **some later test** — and the
later test's failure is attributed to the later test. A flake that appears only when two particular
tests share a process, and moves when the order changes, is the hardest failure in this repository.

`schedule mine.push` inside the loop body gives each test its own queue, and the operator's own
wrinkle is what makes it one line: **the target is restored because the scope resumes**, not because
anybody resets it.

## 1. `Sys.drain` overrides an outer `schedule`, and drains the wrong queue

`vision/std/platform.wac`:

```wac
async void drain(this) {
  schedule this.pending.push;
  while (this.pending.len() > 0) { … }
}
```

It sets the target to its own field and drains its own field. Inside `isolated`, where the target is
`mine`:

- work the test scheduled **before** calling `sys.drain()` is in `mine`;
- `drain` retargets to `sys.pending` and drains `sys.pending`, which is empty;
- it answers zero, and the test's work is still sitting in `mine`.

The same test written against the shipped design works. **So `drain` is not composable with
`schedule`**, and the reason is that it names a queue where it should name *the current target*. It
is the only existing consumer of `schedule` and it is the one that breaks the second one.

The fix is probably that `drain` drains wherever `schedule` currently points rather than a fixed
field — which makes `Sys.pending` an implementation detail of the default target rather than a thing
`drain` knows about. That is a change to the design that was worked out with the operator directly,
so it is written here and promoted, not applied.

## 2. Restoration on a trap is unspecified, and it is `defer`'s question

If `body()` traps, is the target restored?

If not, every later test in the process schedules into a queue nobody will ever drain — **worse than
the bug this file fixes**, and silent. `QUESTIONS.md` already asks the same thing about `defer`, for
`core/ticket.wac`'s `defer { this.inWait = false; }`, which is permanently wrong after one trap.

They are one question. `schedule` and `defer` are both *scope-scoped side effects*, and what a trap
does to a scope is the thing neither has an answer for. Answering it once answers both, and answering
it differently for the two would need a reason.

## 3. Nesting is assumed and never stated

`isolated` sets a target; `body()` may call something that sets another; that call returns. Does the
target go back to `isolated`'s, or to the default?

A stack is the only useful answer and nothing says there is one. The phrase on the pages is *"the
scope resumes"*, which reads like a stack and is not the same as saying so — an implementation that
kept a single current target and restored to the default would satisfy the sentence and break every
nested use, including `drain` inside `isolated`, which is finding 1 arriving a second way.

## What could not be written

**Reporting a leak without draining it.** `isolated` drains what the test left and reports the count,
rather than refusing. Refusing would be the stricter rule and it is not this file's to make: a test
that schedules and expects the runner to dispatch is written against the shipped behaviour, so
refusing it is a new rule rather than a new report. The stricter version needs a decision about what
a test is allowed to leave behind, which nothing has taken.

**Attributing work to the test that scheduled it, rather than to the test that was running.** The
queue tells you *that* something leaked and not *where from* — a continuation is a funcref and a
ticket, and neither carries an origin. Adding one is a debugging feature with a per-continuation
cost, and the honest note is that this file gets the attribution right only because the boundary is
the whole test.
