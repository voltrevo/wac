# 0300 — a program cannot make a ticket the scheduler can dispatch, so `await` has no bounded form

- **Status:** open — a language/platform gap, found by trying to write around it and failing
- **Claimed by:** (nobody — `issues/system/0294c` is the migration this blocks)
- **Reported by:** agent-b
- **Date:** 2026-08-30
- **Kind:** missing feature
- **Symptom:** no error. An `await` on a program-made ticket never resumes, and the program exits
  saying *"finished with 1 continuation(s) still waiting"*

## What is wanted

A read with a deadline that **suspends** rather than blocks:

```wac
Timed got = await within(core, cli.recv(sock), 30000);
```

`design/lang/0014` gave wac `async`/`await` over the tickets that already exist. What it did not give
is a bounded wait, and `spec/spec/async.md` does not mention a timeout, a deadline or a race. The only
deadline in the system is `core.waitAny(ids, millis)`, and that **blocks** — so inside an `async`
function it stalls every other continuation.

**Bounded and concurrent are therefore mutually exclusive**, which is not a small gap: it is the
difference between a package that can adopt `async` and one that cannot. `dird` and `relayd` were
portable precisely because their reads had no deadline to lose — an onion service's introduction
circuit is silent by design and `dird` accepts for ever. `packages/tor`'s circuit layer bounds every
read (`pumpFor(l, READ_TIMEOUT_MS)`, thirty seconds, because *"a relay that says nothing for thirty
seconds is wedged"*), and so cannot move at all.

## Why it cannot be written in a package, which is the finding

`Pending` is constructible from wac: `Pending<T>(id, resolve, settled, drop, sched, waitable)`, and
`then` registers a continuation. So a race combinator looks writable —

```wac
export Pending<Timed> within(Core core, Pending<Read> p, i32 ms) {
  Race r = Race(false, false, Read.End());
  Pending<i64> timer = core.delay(ms);
  p.then((Read v) => { if (!r.done) { r.done = true; r.ok = true; r.value = v; … } });
  timer.then((i64 t) => { if (!r.done) { r.done = true; r.ok = false; … } });
  return Pending<Timed>(0 - 1, (i32 id) => Timed(r.ok, r.value), (i32 id) => r.done,
                        (i32 id) => { }, null, false).linkedTo(core);
}
```

— and it **half-works**, which is the trap. Poll it and it answers: `settled()` returns the flag the
winning continuation set. `await` it and the awaiting function never resumes.

The mechanism is `Sched.run`:

```wac
i32 which = core.waitAny(live, budget);
```

**Dispatch goes through `waitAny` over the registered ids, and `waitAny` asks the host.** A ticket the
program invented has no host id, so it can never be reported ready, so the continuation an `await`
registered on it is never fired. An `async` function's own ticket works because the *compiler*
synthesises it; there is no route from wac source to the same thing.

That is why `std/platform.wac`'s note is still right, and why the way it is phrased is worth keeping:

> An earlier design passed a timer ticket in the list instead; it worked, and every caller had to
> remember to cancel the loser or lose a slot for good.

It "worked" as a *host* ticket in the `waitAny` list. It does not work as a program-made one.

## Reproduction

`packages/tor/src/within.wac` and a probe, both on this branch and not committed. A connected socket
pair nobody writes to, so only the deadline can answer:

    A: connected pair, server=ok
    B: async call returned a ticket
    C: drained ran=some in under a second
    D: bounded answered no, outstanding=some
    wac: … finished with 1 continuation(s) still waiting

`C` is the trap: `drainFor` did run something — the timer's own continuation — so a reader checking
only that it "ran" concludes the chain advanced. `D` is the answer: the async function's ticket never
settled.

## What would close it

Any one of these; they are not equivalent and the choice is a design decision:

- **A `Sched`-minted id a program can resolve.** The smallest thing: something like
  `core.promise<T>()` handing back a ticket plus a resolver, registered so `run` can dispatch it.
  Every other item below can then be written in wac.
- **A bounded `await` in the language** — `await e within ms`, lowered to the same machinery
  `waitAny` uses. Narrower, and it answers only the timeout case.
- **A `waitAny` that yields.** The deadline is already there; what blocks is that it does not
  suspend. A form that registers instead of blocking would make the existing spelling correct
  inside `async`.

## Until then

`issues/system/0294c`'s migration takes relayd's route: delete per-read deadlines and move them to a
supervising `core.drainFor(budget)`. That works for a server with a loop to put the budget in and
costs three client `main`s a restructure — `hsfetch`, `hsconnect`, `app` — and it changes when a Tor
client notices a silent relay, which is why it is written down here rather than done quietly.

## One thing that is true regardless

Releasing a ticket takes **two** calls and code that does one leaks a slot. `Pending.cancel()` runs
the ticket's own `drop` — the host's — while a continuation registered by `then` lives in the
scheduler keyed by that id, and only `Core.cancel(id)` takes it back. The first version of the
combinator above did the first and not the second, and the program said so on exit: *finished with 2
continuation(s) still waiting*, exactly two per call.
