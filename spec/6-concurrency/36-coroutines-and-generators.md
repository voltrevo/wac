# 36 — Coroutines and generators

A coroutine is a function that can stop partway and be resumed. wac has three constructs built on one machine: a
**generator** yields values, an **`async` function** waits on tickets ([35](35-tickets-and-await.md)), and an
**async generator** does both. `coroutine f()` gives the machine itself, without running it.

## A generator yields values

`gen<Y> R f(…)` declares a generator that yields values of type `Y` and finally returns an `R`. Calling it runs
nothing, and answers a `Generator<Y, R>`; `for … in` steps one:

```wac
// expect: answers sumUpTo(3) = 6
// expect: answers sumUpTo(0) = 0
gen<i32> void upTo(i32 n) {
  for (i32 i = 1; i <= n; i++) { yield i; }
}

export i32 sumUpTo(i32 n) {
  i32 total = 0;
  for (i32 v in upTo(n)) { total += v; }
  return total;
}
```

`[§wac-generator-mbr4wfh]` `gen<Y> R f(…)` is a generator: calling it answers a `Generator<Y, R>` and runs nothing; each
step runs it to its next `yield v` or its `return`.

`[§wac-for-in-generator-yxdabjc]` `for (Y x in g)` steps a generator, binding each yielded value until it is done, and
discards its return value.

Writing an iterator is writing a loop:

```wac
// expect: answers sumOfTree = 6
enum Tree {
  Leaf(i32 value),
  Node(Tree left, Tree right)

  gen<i32> void values(const this) {
    match (this) {
      Leaf(v): {
        yield v;
      }
      Node(l, r): {
        for (i32 v in l.values()) { yield v; }
        for (i32 v in r.values()) { yield v; }
      }
    }
  }
}

i32 sum(Tree t) {
  i32 total = 0;
  for (i32 v in t.values()) { total += v; }
  return total;
}

export i32 sumOfTree() {
  return sum(Tree.Node(Tree.Leaf(1), Tree.Node(Tree.Leaf(2), Tree.Leaf(3))));
}
```

A method may be a generator, as here on an enum.

## Three constructs, three called forms, one operator to descend

```wac
// fragment
gen<i32> void       values()     { … }
async i32           doubled(t)   { … }
async gen<i32> void counter(t)   { … }

Generator<i32, void>      a = values();
Ticket<i32>               b = doubled(t);
AsyncGenerator<i32, void> c = counter(t);

Coroutine<never, i32, void>       d = coroutine values();
Coroutine<TicketBase, never, i32> e = coroutine doubled(t);
Coroutine<TicketBase, i32, void>  f = coroutine counter(t);
```

`Coroutine<W, Y, R>` is the machine: what it waits on, what it yields, what it returns. `W` is `never` where it cannot
wait, and `Y` is `never` where it cannot yield.

`[§wac-coroutine-forms-esw44gj]` Calling a generator answers a `Generator<Y, R>`, an `async` function a `Ticket<R>`, and an
async generator an `AsyncGenerator<Y, R>`. `coroutine call` answers the same call's machine, a `Coroutine<W, Y, R>`.

## One step family

```wac
// fragment — from core
enum Step<W, Y, R> {
  Waiting(W ticket),
  Yielded(Y value),
  Done(R result)
}
```

| Receiver | Result of `step()` |
| --- | --- |
| `Coroutine<W, Y, R>` | `Step<W, Y, R>` |
| `Generator<Y, R>` | `Step<never, Y, R>` |
| `AsyncGenerator<Y, R>` | `Ticket<Step<never, Y, R>>` |

The async-generator wrapper handles waiting; its underlying coroutine exposes it.

`[§wac-step-family-m6fdqkj]` `step()` answers a `Step`: `Waiting` with the ticket the machine now waits on, `Yielded` with a
value, or `Done` with the result. A `Generator`'s steps never wait, and an `AsyncGenerator`'s step is a ticket that
does the waiting itself.

```wac
// fragment — a generator that never finishes
gen<i32> never forever() {
  while (true) { yield 1; }
}

void consume() {
  auto g = forever();
  match (g.step()) {
    Yielded(v): { v; }
  }                           // exhaustive: Waiting and Done are impossible
}
```

A variant with a required `never` payload is uninhabited, so the `match` above is exhaustive
([11](../2-types/11-never-and-uninhabited.md)). `R = never` is valid for an infinite generator. `R = void` permits
completion and gives a payload-free `Done`.

## `coroutine` answers the machine and runs nothing

```wac
// expect: answers runsWhenStepped = true
import { Coroutine, TicketBase } from "core";

struct Slot {
  i32 n;

  async void tick(this) {
    this.n += 1;
    await;
    this.n += 10;
  }
}

export bool runsWhenStepped() {
  Slot s = Slot(0);
  Coroutine<TicketBase, never, void> c = coroutine s.tick();

  bool before = s.n == 0;                  // nothing has run
  c.step();                                // Waiting
  bool middle = s.n == 1;
  c.step();                                // Done
  return before && middle && s.n == 11;
}
```

`[§wac-coroutine-runs-nothing-zumpwje]` `coroutine f(…)` runs none of `f`'s body; each `step()` runs it to its next suspension
or to its end.

`await;` suspends on a ticket that is already settled, so the step that reaches it answers `Waiting` with a settled
ticket, and the next step continues:

```wac
// expect: answers bareAwaitIsOneStep = true
import { Coroutine, TicketBase } from "core";

async void tick() {
  await;
}

export bool bareAwaitIsOneStep() {
  Coroutine<TicketBase, never, void> c = coroutine tick();
  bool settled = match (c.step()) {
    Waiting(t): t.settled(),               // true
    default:    false,
  };
  bool done = match (c.step()) {
    Done:    true,
    default: false,
  };
  return settled && done;
}
```

A pause deeper down is still one pause at the top. The caller's machine does not gain a state for each frame beneath
it, so its type is what its own body says:

```wac
// fragment
void example() {
  Coroutine<TicketBase, never, void> c = coroutine outer();

  c.step();          // Waiting
  c.step();          // Done
}

async void outer() { await middle(); }
async void middle() { await inner(); }
async void inner() { await; }
```

`[§wac-nested-pause-w7h5evg]` A suspension inside a nested `async` call is a suspension of the outermost machine, and adds
nothing to its type.

An `await` is a boundary because it is written:

```wac
// expect: answers settledAwaitStillSteps = 42
import { Coroutine, Ticket, TicketBase } from "core";

async i32 doubled(Ticket<i32> t) {
  return (await t) * 2;
}

export i32 settledAwaitStillSteps() {
  Ticket<i32> t;
  t.resolve(21);
  Coroutine<TicketBase, never, i32> c = coroutine doubled(t);

  c.step();                                // Waiting — even though t is already settled
  return match (c.step()) {
    Done(v): v,                            // 42
    default: 0,
  };
}
```

`[§wac-await-always-suspends-63fd8pm]` Every `await` is a step boundary of its machine, whether or not its ticket has already
settled.

## Stepping a finished machine

A step after `Done` does nothing, and answers `Done` again. A scheduler may still hold a continuation for a machine
somebody else drove to completion, and there is no way to withdraw a registration:

```wac
// expect: answers doneAgain = true
gen<i32> void one() { yield 1; }

export bool doneAgain() {
  auto g = one();
  g.step();                                // Yielded(1)
  g.step();                                // Done
  return match (g.step()) {                // Done again: a no-op
    Done:    true,
    default: false,
  };
}
```

`[§wac-step-finished-noop-2tenu9x]` Stepping a machine that is done has no effect, and answers `Done`.

## Async generators

An async generator yields and waits:

```wac
// expect: answers yieldsAndWaits = true
import { Coroutine, Ticket, TicketBase } from "core";

async gen<i32> void counter(Ticket<i32> t) {
  yield 1;
  yield await t;
}

export bool yieldsAndWaits() {
  Ticket<i32> t;
  t.resolve(2);
  Coroutine<TicketBase, i32, void> c = coroutine counter(t);

  bool a = match (c.step()) { Yielded(v): v == 1, default: false };
  bool b = match (c.step()) { Waiting(w): true,  default: false };
  bool d = match (c.step()) { Yielded(v): v == 2, default: false };
  bool e = match (c.step()) { Done:       true,  default: false };
  return a && b && d && e;
}
```

`for await` iterates one — awaiting on `Waiting`, binding on `Yielded`, stopping on `Done`:

```wac
// expect: answers forAwaitTotal = 3
import { Ticket } from "core";

async gen<i32> void counter(Ticket<i32> t) {
  yield 1;
  yield await t;
}

async i32 total(Ticket<i32> t) {
  i32 n = 0;
  for await (i32 x in counter(t)) { n += x; }
  return n;
}

export i32 forAwaitTotal() {
  Ticket<i32> t;
  t.resolve(2);
  return total(t).wait()!;
}
```

`[§wac-for-await-hkzruba]` `for await (Y x in g)` iterates an async generator, awaiting each step. It discards the
generator's return value.

The return value arrives inside `Done`, which the loop consumes as it ends, so there is nothing left to ask for
afterwards; taking it means stepping by hand.

Iterating an async generator needs the `await` written:

```wac
// expect: emits
import { Ticket } from "core";

async gen<i32> void counter(Ticket<i32> t) { yield 1; }

export async void bad(Ticket<i32> t) {
  // ERROR: iterating an async generator needs for await
  // for (i32 x in counter(t)) { }

  for await (i32 x in counter(t)) { }
}

export void alsoBad(Ticket<i32> t) {
  // ERROR: await outside an async function
  // for await (i32 x in counter(t)) { }
}
```

`[§wac-for-await-required-4bxqy83]` A plain `for … in` over an async generator is refused; `for await` is required, and is
itself allowed only in an `async` function.

A plain loop that suspends once per step is a boundary nobody wrote. Driving an async generator from synchronous code
is `wait`'s job.

## Which keyword goes where

`await` is not allowed in a generator, and `yield` is not allowed in an `async` function. An async generator has both:

```wac
// expect: emits
import { Ticket } from "core";

export gen<i32> void g(Ticket<i32> t) {
  // ERROR: await in a generator — declare it async gen
  // yield await t;
  yield 1;
}

export async void f() {
  // ERROR: yield in an async function — declare it async gen
  // yield 1;
}
```

`[§wac-yield-await-placement-sjuvqc6]` `yield` is allowed only in a generator, and `await` only in something `async`. A
function that needs both is an `async gen`.
