# 35 — Tickets and await

A `Ticket<T>` is a value that will answer a `T`. An `async` function hands its caller a ticket instead of a value,
and `await` inside one suspends until a ticket answers. Work that nobody awaited is still the program's: its
continuation goes to the current **schedule target**, and `sys.drain()` runs it.

There is no runtime added beyond this, no event loop the program cannot see, and no second stack. An `async`
function is a coroutine ([36](36-coroutines-and-generators.md)) wrapped in a `Ticket`.

## A ticket is a value

Making a ticket starts the work, and `await` waits for one already running:

```wac
// fragment — a program with a read grant
async void both(Sys sys) {
  Ticket<Result<u8[]>> a = sys.readFile("a.txt");
  Ticket<Result<u8[]>> b = sys.readFile("b.txt");

  u8[] first = try await a;                // both reads are in flight before either is awaited
  u8[] second = try await b;
}
```

There is no parallel construct and nothing to join: two tickets started one after the other are both running.

`core` declares `Ticket<T>`, its untyped base `TicketBase`, and `Continuation` ([37](../7-library/37-core.md)). A
ticket made directly is settled by calling `resolve`:

```wac
// expect: answers doubledTen = 20
import { Ticket } from "core";

async i32 doubled(Ticket<i32> t) {
  return (await t) * 2;
}

export i32 doubledTen() {
  Ticket<i32> input;
  Ticket<i32> r = doubled(input);          // runs as far as its await
  input.resolve(10);
  return r.wait()!;                        // drives r to its answer
}
```

`[§wac-ticket-value-9iqsfzw]` A `Ticket<T>` answers a `T` once settled. `resolve(v)` settles one made directly; an `async`
call returns one that its body settles.

## Declaring an `async` function

```wac
// expect: answers sizeOfAbc = 3
import { Ticket } from "core";

async i32 size(Ticket<string> name) {
  string n = await name;
  return n.len();
}

export i32 sizeOfAbc() {
  Ticket<string> t;
  Ticket<i32> s = size(t);                 // size is declared i32; the call is a Ticket<i32>
  t.resolve("abc");
  return s.wait()!;
}
```

`[§wac-async-decl-h3vq81m]` An `async` function's declared return type is what its **body** returns; its caller
receives a `Ticket` of it. `return` is checked against the declared type.

`async` is written after any `export` and before the return type: `export async void tick()`. Writing `async
Ticket<i32>` declares a body that hands back a ticket, not a second spelling of `async i32`.

`[§wac-async-method-4kx7vqd]` A method may be `async`, written where it sits on a free function — after any
`override`, before the return type. The receiver crosses a suspension the way any other parameter does.

```wac
// expect: answers runsToFirstAwait = 1
import { Ticket } from "core";

struct Slot {
  i32 n;

  async void tick(this) {
    this.n += 1;
    await;
    this.n += 10;
  }
}

export i32 runsToFirstAwait() {
  Slot s = Slot(0);
  s.tick();                                // runs to its first suspension now
  return s.n;                              // 1
}
```

`[§wac-async-eager-2rf9kdp]` Calling an `async` function runs its body at once, as far as its first `await`, and
returns a ticket for the rest. It does not wait to be driven.

## `await`

`await e` requires `e` to be a ticket, and has the type of what it answers:

```wac
// expect: emits
import { Ticket } from "core";

export async i32 bad() {
  // ERROR: await needs a ticket, and 5 is an i32
  // return await 5;
  return 0;
}

export i32 plain(Ticket<i32> t) {
  // ERROR: await outside an async function
  // return await t;
  return 0;
}
```

`[§wac-await-pending-9km2xtr]` `await e` requires `e` to be a `Ticket<T>`, and has type `T`. Anything else is
refused, naming the type that was awaited.

`[§wac-await-inside-3nq7wbe]` `await` may appear only inside something declared `async`. A plain lambda written in an
`async` function is a different function, and may not contain one.

JavaScript accepts any value here, which is what lets a forgotten `async` on the callee compile. A boundary is a
boundary because it is written.

`[§wac-await-bind-4wzp7cn]` `await` binds tighter than any binary operator and looser than postfix: `await
f().g()` awaits the call, and `await n + 1` is `(await n) + 1`.

### `await;` is one step boundary

`await` with no operand suspends on a ticket that is already settled: the function pauses once, and its next step
continues:

```wac
// expect: emits
export async void example() {
  await;                                   // one step boundary, no waiting

  // ERROR: null has no type here
  // await null;
}
```

`[§wac-await-bare-ge5p75p]` `await;` suspends once on an already-settled ticket. `await null;` is refused: `null` has
no type to infer here.

`await t` on a `TicketBase?` that is null behaves as `await;`, which is what lets one statement dispatch both a
ready continuation and a blocked one ([below](#draining)).

## `async` lambdas

A lambda writes no return type, so its slot is both the permission and the type: `async` is allowed where the slot
is `fn<Ticket<R>(…)>`, and `R` is what the body is checked against:

```wac
// expect: answers capturedAcrossAwait = 4
import { Ticket } from "core";

export i32 capturedAcrossAwait() {
  i32 base = 3;
  Ticket<i32> input;
  fn<Ticket<i32>(Ticket<i32>)> add = async (Ticket<i32> t) => {
    i32 v = await t;
    return v + base;                       // base is captured, and survives the suspension
  };
  Ticket<i32> r = add(input);
  input.resolve(1);
  return r.wait()!;
}
```

`[§wac-async-lambda-slot-9wq4nkz]` An `async` lambda is allowed only where the expected type is `fn<Ticket<R>(…)>`,
and its body is checked against `R`. `async` on a slot that wants no ticket is refused.

`[§wac-async-lambda-captures-5mtj28r]` An `async` lambda captures, and what it captures survives its suspensions.

## Returning a ticket

`async` wraps the declared return type. It does not adopt a ticket the body happened to produce:

```wac
// expect: emits
import { Ticket } from "core";

async i32 size(Ticket<i32> t) { return await t; }

export async i32 total(Ticket<i32> t) {
  // ERROR: total returns i32, and size(t) is a Ticket<i32> — write return await size(t);
  // return size(t);
  return await size(t);
}
```

`[§wac-async-mismatch-8dxr5va]` Returning a `Ticket<U>` from an `async T` whose `T` is not that ticket is a return
type mismatch; the diagnostic offers `await` for the value, or `async Ticket<U>` to hand the ticket on. It never
suggests a cast.

So `Ticket<Ticket<T>>` is an ordinary type, and the two awaits mean different things:

```wac
// fragment
async Ticket<Response> send(Sys sys, Request r) { … }

async Response roundTrip(Sys sys, Request r) {
  Ticket<Response> sent = await send(sys, r);     // it went out
  return await sent;                              // it came back
}
```

`[§wac-async-nested-6bqt3jf]` A ticket returned from an `async` function is not flattened: the caller of `async
Ticket<T>` receives a `Ticket<Ticket<T>>`.

JavaScript adopts, which is why `Promise<Promise<T>>` cannot be built there: it merges two events into one, and
there is then no way to ask about the first.

## Where unawaited work goes

An unawaited call runs to its first suspension and hands its **continuation** to the current schedule target. A
`schedule` statement sets the target, from that point to the end of its block:

```wac
// expect: answers scheduledToTarget = true
import { Continuation, Vec } from "core";

struct Slot {
  i32 n;

  async void tick(this) {
    this.n += 1;
    await;
    this.n += 10;
  }
}

export bool scheduledToTarget() {
  Vec<Continuation> pending;
  schedule pending.push;

  Slot s = Slot(0);
  s.tick();

  return s.n == 1 && pending.len() == 1;
}
```

`[§wac-schedule-target-fri2qzd]` `schedule f;` makes `f` — a `fn<void(Continuation)>` — the target for the rest of the
enclosing block. A suspension that nothing awaits passes its continuation to the target in force where the
suspended call was made.

`[§wac-schedule-default-is8g8z4]` Where no `schedule` statement is in force, the target is the program's own queue — the
one `sys.drain()` runs, and the one a program's exit inspects for work left over ([07](../1-programs/07-programs.md)).

```wac
// expect: answers targetEndsWithBlock = true
import { Continuation, Vec } from "core";

struct Slot {
  i32 n;
  async void tick(this) { this.n += 1; await; this.n += 10; }
}

export bool targetEndsWithBlock() {
  Vec<Continuation> outer;
  Vec<Continuation> inner;
  schedule outer.push;

  Slot s = Slot(0);
  {
    schedule inner.push;
    s.tick();                              // to inner
  }
  s.tick();                                // to outer again
  return inner.len() == 1 && outer.len() == 1;
}
```

`[§wac-schedule-block-wrhaazj]` A `schedule` statement applies to the end of its block; the target outside the block is
in force again after it.

The target belongs to the suspended scope, not to whoever resumes it. A coroutine's saved state carries the target
in force where it suspended, and it is restored when the coroutine resumes:

```wac
// expect: answers targetRestoredOnResume = true
import { Continuation, Generator, Vec } from "core";

struct Slot {
  i32 n;
  async void tick(this) { this.n += 1; await; this.n += 10; }
}

gen<void> void capture(Vec<Continuation> inner, Slot s) {
  schedule inner.push;
  yield;
  s.tick();
}

export bool targetRestoredOnResume() {
  Vec<Continuation> outer;
  Vec<Continuation> inner;
  schedule outer.push;

  Slot s = Slot(0);
  Generator<void, void> g = capture(inner, s);

  g.step();                                // runs to the yield, installing inner
  s.tick();                                // outer
  g.step();                                // resumes inside capture's scope: inner
  return outer.len() == 1 && inner.len() == 1;
}
```

`[§wac-schedule-restored-b9qsydd]` A resumed coroutine runs under the schedule target that was in force where it
suspended, not the resumer's.

Nothing here is specific to async: a synchronous generator suspends inside a scope the same way. It is what lets
`drain` write `schedule` once and keep it across its own suspensions, and why a resumer needs no cooperation —
`step()` and `call()` are ordinary calls that know nothing about scheduling.

### A continuation is a ticket and a call

```wac
// fragment — from core
struct Continuation {
  TicketBase? t;
  fn<void()> call;
}
```

```wac
// expect: answers continuationResumes = 20
import { Continuation, Ticket, Vec } from "core";

async i32 doubled(Ticket<i32> t) {
  return (await t) * 2;
}

export i32 continuationResumes() {
  Vec<Continuation> pending;
  schedule pending.push;

  Ticket<i32> input;
  Ticket<i32> r = doubled(input);

  bool waitsOnInput = pending.get(0).t is input;   // true
  input.resolve(10);
  pending.get(0).call();

  return waitsOnInput ? r.value() : 0;
}
```

`[§wac-continuation-xj5pyv3]` A `Continuation` holds the ticket its machine is waiting on — `null` for a bare `await;` —
and a `call` that resumes it.

```wac
// expect: traps callsTooEarly
import { Continuation, Ticket, Vec } from "core";

async i32 doubled(Ticket<i32> t) { return (await t) * 2; }

export void callsTooEarly() {
  Vec<Continuation> pending;
  schedule pending.push;

  Ticket<i32> t;
  doubled(t);
  pending.get(0).call();                   // traps: t has not settled
}
```

`[§wac-continuation-early-trap-rg9d475]` Calling a continuation whose ticket has not settled traps.

### Draining

`sys.drain()` runs the work nobody awaited. It is ordinary wac:

```wac
// fragment — Sys's drain, as written in std
struct Sys {
  Queue<Continuation> pending;

  async void drain(this) {
    schedule this.pending.push;

    while (Continuation c matches this.pending.pop()) {
      await c.t;
      c.call();
    }
  }
}
```

`schedule` is its first statement, so a machine that suspends again inside `call()` lands back in `pending` rather
than in whatever target was in force where it was first called: drain captures what it starts, and what it starts
is simply further along the same queue. Its own `await` hands drain's continuation to the target above it, and the
target is back in force when drain is resumed.

`await c.t` is the whole of the dispatch. A null ticket is the bare `await` — one step boundary and no waiting — so
a ready continuation and a blocked one take the same two lines, and drain yields between each and the next rather
than monopolising it.

```wac
// expect: prints
// a
// b
// a
// b
import { Sys } from "std";

async void tick(Sys sys, string name) {
  for (i32 i = 0; i < 2; i++) {
    sys.log(name);
    await;
  }
}

export async void main(Sys sys) {
  tick(sys, "a");
  tick(sys, "b");
  await sys.drain();
}
```

`[§wac-drain-cs2v9rf]` `sys.drain()` resumes queued continuations in order until none remain, awaiting each one's ticket
first. Two unawaited calls that suspend interleave.

A program does not end while work it started remains ([07](../1-programs/07-programs.md)).

## `wait` drives a ticket from synchronous code

`t.wait()` drives the work `t` awaited until `t` answers, without suspending its caller. It answers a `Result`,
because unlike `await` it can be refused:

```wac
// expect: answers viaWait = 2
// expect: answers orphanRefused = -1
import { Ticket } from "core";

async i32 job(Ticket<i32> t) { return (await t) + 1; }

export i32 viaWait() {
  Ticket<i32> t;
  t.resolve(1);
  return job(t).wait()!;
}

export i32 orphanRefused() {
  Ticket<i32> orphan;                      // nothing will ever resolve it
  return match (orphan.wait()) {
    Ok(v):  v,
    Err(_): -1,                            // nothing can advance it, so wait refuses at once
  };
}
```

`[§wac-async-wait-5tqm2wh]` `t.wait()` drives the work `t` depends on — what it awaited, not what was merely started —
and answers `Ok` with `t`'s value, without running unrelated queued work.

`[§wac-wait-refuses-jj8u2ie]` `t.wait()` answers `Err` when nothing it may drive can advance `t`: a ticket nothing will
resolve, or one a different driver owns.

`x.wait()!` and `await x` answer the same value. What differs is what else got to run: under `await` the caller parks
and its siblings advance; under `wait` the caller's frame is live and they do not. So the value is identical, the
program afterwards may not be, and `wait` can refuse where `await` cannot.

```wac
// fragment — a fake Sys run inside a real one
Result<void> example(Sys real) {
  Sys fake = fakeSys();

  return fake.run(async (Sys sys) => {
    real.sleepMillis(10);         // unawaited — its continuation lands in fake's queue
    return sys.drain().wait();    // Err — the ticket is real's, and fake cannot advance it
  }, []);
}
```

`wait` stops between continuations, never inside one, so everything up to a refusal ran and is settled. The
fallibility belongs to the attempt rather than the ticket — which is why `p.wait()` is a `Result` while `await p` is
a value, and why `Ticket<T>` is not `Ticket<Result<T, E>>`:

```wac
// fragment
async i32 recover(Sys sys, Ticket<i32> p) {
  return match (p.wait()) {
    Ok(v):  v,
    Err(_): await p,              // picks up from the link that refused
  };
}
```

A `wait` that depends on itself loops rather than refusing — nothing refuses, so there is no `Err`, and the program
is running rather than idle, so the hung-program check does not see it either:

```wac
// fragment
struct Cell { Ticket<i32>? t; }

Result<i32> example(Sys sys) {
  Cell c;
  Ticket<i32> t = selfish(sys, c);
  c.t = t;                        // it awaits the ticket it will settle
  return t.wait();                // never returns
}

async i32 selfish(Sys sys, Cell c) {
  await;
  return await c.t!;
}
```

`[§wac-async-once-3jhw8qk]` A body runs once however it is driven. A `wait` that arrives while a continuation is
queued takes that continuation back before stepping, so the answer is delivered once.

`sys.drain().wait()` and `await sys.drain()` are the same program from two drivers. They coincide because a drain
ticket's dependency set is the whole queue; elsewhere `wait` resolves what was awaited and leaves the caller's
siblings where they are.

## Several tickets

`Ticket.all` answers a tuple when every ticket has, so two reads cost one wait and the results keep their own types:

```wac
// expect: answers allSettled = 5
import { Ticket } from "core";

export i32 allSettled() {
  Ticket<string> a;
  Ticket<i32> b;
  a.resolve("abc");
  b.resolve(2);
  (string, i32) got = Ticket.all(a, b).wait()!;
  return got.0.len() + got.1;
}
```

`[§wac-ticket-all-2h6iwfr]` `Ticket.all(t1, …, tn)` is a ticket of the tuple of their answers, settled when every one is.
It is variadic, and the tuple is as long as the call ([14](../2-types/14-tuples.md)).

`Ticket.any` answers with the first to settle. The others keep running — a ticket is work already started:

```wac
// fragment
async void example(Sys sys) {
  Ticket<i32> a;
  Ticket<i32> b;
  Slot s;

  Ticket<i32> win = Ticket.any(add(s, a), add(s, b));

  a.resolve(1);
  await win;
  s.n;                  // 1

  b.resolve(10);
  await sys.drain();
  s.n;                  // 11: the loser ran anyway
}

async i32 add(Slot s, Ticket<i32> t) {
  s.n += await t;
  return s.n;
}
```

`[§wac-ticket-any-v8nr3r9]` `Ticket.any(t1, …)` settles with the first of its tickets to settle. The others are not
cancelled.

## `void` as a type argument

```wac
// expect: emits
import { Ticket, Vec } from "core";

async void tick() { await; }

export void voidTypeArgument() {
  Ticket<void> t = tick();                 // async void has a call-site type

  // ERROR: Vec<void> — nothing can hold a value of a type that has none
  // Vec<void> v;
}
```

`[§wac-void-typearg-2mkx9db]` `void` may be a type argument, and erases the parameter it stands in for: `Ticket<void>`'s
continuation takes nothing. A container of `void` is still refused.

## Open

- **Whether a self-dependent `wait` can be diagnosed.** It loops as specified; whether an implementation can detect
  and report the cycle is open.
