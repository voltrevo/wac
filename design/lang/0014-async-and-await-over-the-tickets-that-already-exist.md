# 0014 — `async` and `await`, over the tickets that already exist

- **Status:** in progress — step 0 landed 2026-08-30; the state of play below is the truth
- **Date:** 2026-08-30
- **Author:** agent-c, with the operator
- **Depends on:** nothing. `issues/lang/0292c` was written up here as a blocker on any new method on
  `Pending<T>` and closed 2026-08-30 as not a bug — a duplicate member, `cancel` having been there
  already. What it did find is real and is `issues/system/0293c`: nothing type-checks the file

## What is wanted

```wac
async i32 fileSize(Cli cli, string path) {
  FileResult f = await cli.readFile(path);
  return f.ok ? f.bytes.len() : -1;
}
```

A function that says what it answers, suspends where it waits, and hands its caller a `Pending<i32>`.
Lowered to the continuations `std/platform.wac` already has — `then`, `Sched`, `drain` — with a state
object for the locals that outlive each `await`. **No stack switching**, which WebAssembly does not
offer us.

### What this is not

**Not a runtime.** There is no ambient event loop and this does not add one. `Sched.run`'s own note
is the rule: *"a continuation can only run inside a call that dispatches… which is the honest cost of
having no preemption and is why `drain` is written by the program rather than happening to it."*

**Not concurrency by itself.** `await` sequences; it does not fan out. Two things at once is still two
tickets and `waitAny`, or two async calls neither of which is awaited yet.

## Why now, and why not before

`then`, `Sched` and `drain` landed **2026-08-17**. Measured 2026-08-30, the tree has **3080**
`.wait()` call sites against **13** `.then(` — and every one of those thirteen is the feature's own
example or test. That reads like a rejected primitive and is not one:

- `packages/tor/src/relayd.wac`'s multiplexing loop was written **2026-08-06**, eleven days before
  `then` existed. So did `packages/ssh`'s. The header complaint — *"a relay needs to be reading from
  every connection it has while accepting new ones, and that is a scheduler rather than a wait"* — is
  a request for something that did not exist yet, and nobody went back.
- Ported on 2026-08-30, that loop lost four parallel arrays rebuilt every round. It works against
  three relays, an authority, an onion service and a real C tor.

So the primitive is good and under-used for reasons of history. What this document adds is the
notation, and the one runtime rule that makes it usable from the 3080 sites that are not async.

## The decisions

### D1 — eager

Calling an async function runs its body immediately, up to the first `await`, which registers a
continuation. It does not build a state machine and wait to be driven.

**Because there is no ambient loop.** Lazy futures put the question *who drives this* on every caller,
which is right in Rust because `block_on` and executors are ordinary; here it would make the common
case — one file, one call — the one that silently does nothing.

### D2 — `wait` drives its own chain, and nothing else

`.wait()` on an async function's ticket may run the work that ticket is waiting on, transitively. It
may **not** run unrelated registered work.

**Because the alternative makes every `.wait()` a yield point.** Pumping the whole scheduler would let
arbitrary continuations run inside any capability call — the failure mode that made reentrant pumps
notorious elsewhere — and 3080 existing sites were written when a `.wait()` was a leaf. Restricting it
also keeps `Sched.run`'s own `monotonicNanos().wait()` from dispatching, which a general pump would
turn into recursion.

What an awaited ticket is decides what happens:

| the ticket | `wait` does |
| --- | --- |
| host-backed | block — something external will answer |
| another async function | drive it, recursively |
| program-made, resolved by someone else's continuation | cannot proceed — see D7 |

### D3 — `async T`, not `async Pending<T>`

The declaration states what the body returns. The caller receives `Pending<T>`.

**Because the wrapper is noise.** This is Rust's `async fn f() -> T` rather than TypeScript's
`Promise<T>` that every writer types and every reader unwraps.

### D4 — returning a ticket is allowed, and is not flattened

```wac
async Pending<Socket> connectLater(Core core, Cli cli) {
  await core.delay(1000);
  return cli.connect("host", 80);
}
```

The caller gets `Pending<Pending<Socket>>`: await once for the second to pass, and you hold a ticket
for a connection that is now being made. Verified to compile and run today.

**Because forbidding it deletes a program rather than a mistake.** An earlier draft made this an
error; the mistake it was aimed at — `async i32 f() { return cli.readFile(p); }` — is an ordinary
return-type mismatch that needs no special rule. JavaScript flattens here and it is widely regretted;
not flattening also matches `§wac-str-noimplicit-p3jw7xf`, which refuses implicit conversion in `+`
for the same reason.

The mismatch should say both readings rather than guess:

    error: expected i32, found Pending<FileResult>
      = help: `await` it for the FileResult, or declare `async Pending<FileResult>` to hand the ticket on

### D5 — `void` becomes usable as a type argument

`async void tick()` has no call-site type today: `Pending<void>` is a **parse** error, and there is no
unit type in `core`.

Nothing deep prevents it. `void` is already a kind — `packages/wacc/src/kinds.wac` gives it 29 — and
what refuses it is a rule about *value positions*.

**Two changes, and the second was missed when this was first written.** The claim here was that
`Pending<T>` never needs a value of `T`, since it stores `fn[T(i32)] resolve` with `T` in return
position. That is true of the field and false of the methods: `then(fn[void(T)] f)` and
`map<U>(fn[U(T)] f)` both put `T` in **parameter** position, so `Pending<void>` asks for
`fn[void(void)]` — a callback taking a value of a type that has none.

1. `void` joins the whitelist in `afterTypeArgs`. It is its own token kind rather than an identifier,
   so `Pending<void> p = …` failed that scan, was read as a comparison, and complained *expected an
   expression, found 'void'*. The same type in return position always parsed.
2. **A `void` argument erases the parameter it stood in for**, so `fn[void(T)]` at `T = void` is
   `fn[void()]`. That is also what one would write by hand: a continuation on a ticket that answers
   nothing takes no argument. Both spellers need it — the emitter's and the checker's — or a lambda
   is offered a target nothing can satisfy.

`Vec<void>` is still refused, by the emitter's existing *a value of a type this emitter cannot write*
rather than by a new check. That message names neither `Vec<void>` nor the line, which is the
diagnostic-quality risk this step was warned about; improving it is not part of this step.

### D6 — the whole language, not a linear subset

`await` works inside `while`, `for`, `if`, `match`, and in expression position.

**Because the motivating program is a loop.** `serve` reads a socket until it closes; an `await` that
cannot appear in a loop would not have written any of the code this is for. A restricted first cut
would refuse the case that prompted it.

### D7 — a chain that cannot advance is an error, not a hang

When `wait` is driving and its chain has nothing outstanding while its ticket is unsettled, nothing in
that chain can ever advance. That is decidable at the moment it happens.

    error: this cannot complete — it is waiting on work only `core.drain()` will run

**Because D2 is what makes it detectable.** A general pump would silently interleave instead; plain
blocking would hang. Narrowing what `wait` may run is what turns the failure into a sentence.

## Acceptance criteria

Each of these compiles, runs, and answers as described. They are the document's definition of done.

### A1 — accept and serve, the motivating program

```wac
async void serve(Core core, Cli cli, i32 sock) {
  while (true) {
    match (await cli.recv(sock)) {
      case Data(bytes): { await cli.send(sock, bytes); }
      case End: { cli.closeSocket(sock); return; }
      case Failed(why): { core.warn("read: " + why); cli.closeSocket(sock); return; }
    }
  }
}

async void accepting(Core core, Cli cli, i32 listener) {
  while (true) {
    Socket s = await cli.accept(listener);
    if (s.handle < 0) { core.warn("accept: " + s.error); return; }
    serve(core, cli, s.handle);          // eager — starts now, deliberately not awaited
  }
}

export i32 main(Core core, Cli cli) {
  Socket l = cli.listen("127.0.0.1", 0).wait();
  accepting(core, cli, l.handle);
  core.drain();
  return 0;
}
```

Two clients overlapping must both be served, and the second must be accepted while the first is still
open — the same assertion `packages/platform/example/echod`-shaped tests make today. Exercises D1, D5,
D6 and `return` from inside a `match` inside a `while`.

### A2 — an ordinary blocking caller

```wac
export i32 main(Core core, Cli cli) {
  core.log("size " + itoa(fileSize(cli, "README.md").wait()));
  return 0;
}
```

Answers the real size. No `drain`, no restructuring — this is the criterion that keeps 3080 existing
call sites able to reach an async function (D2, D3).

### A3 — two awaits and a branch

```wac
async i32 total(Cli cli) {
  FileResult a = await cli.readFile("README.md");
  if (!a.ok) { return -1; }
  FileResult b = await cli.readFile("MERGE.md");
  return a.bytes.len() + b.bytes.len();
}
```

The sum. Today this shape is a `Pending<Pending<i32>>` type error when written by hand with `map`.

### A4 — a ticket handed on

`connectLater` from D4: the outer await returns a `Pending<Socket>` that is already connecting, and
awaiting that gives the socket. Two awaits with two meanings.

### A5 — the refusals

- `async i32 f(…) { return cli.readFile(p); }` — a return-type mismatch carrying the help text in D4.
- `await` applied to something that is not a `Pending<T>` — named.
- `Vec<void>` — `errVoidType`, at the instantiation rather than deep in monomorphisation.
- A `wait` on a chain that cannot advance — D7's sentence, not a hang.

### A6 — `relayd` reads as the loop it is

`packages/tor/src/relayd.wac`'s per-connection read becomes a `while` with an `await` in it, and the
three `*Armed` flags and the `findCirc`-at-fire-time go away — they exist only because a handler
cannot be registered twice and a captured slot number goes stale under compaction, both of which the
lowering owns instead. The live tests must stay green: `network_tor_test`, `ctor_live_test`.

## Order of work

| # | step | done when |
| --- | --- | --- |
| 0 | `void` as a type argument (D5) | `Pending<void>` compiles; `Vec<void>` refused by name |
| 1 | ~~`issues/lang/0292c`~~ | **gone** — not a bug, and `cancel` stays on `Core` for a different reason |
| 2 | The async ticket and D2's driving, plus D7's error | A2 passes with a hand-written lowering |
| 3 | Lex and parse `async`/`await`; the type rules of D3 and D4 | A5's first two refusals fire |
| 4 | The lowering, in full (D6) | A1, A3, A4 pass |
| 5 | Spec clauses and corpus cases; `relayd` (A6) | every criterion above, and the spec carries tags |

Estimated 40–70 hours in total, of which step 4 is 20–40 and is the soft number: it has not been
costed against how `packages/wacc/src/emit.wac` represents control flow. Closures capturing **by
reference** since 2026-08-16 (`design/lang/0002`) is what keeps it that low — a captured local is
already the state slot.

## State of play

| step | state |
| --- | --- |
| 0 | **done 2026-08-30** — `packages/wacc/test/wac/voidtypearg_test.wac` |
| 1 | **dropped 2026-08-30** — `issues/lang/0292c` closed as not a bug; `Pending<T>` takes methods as any struct does. `cancel` stays on `Core` because the ticket's own `cancel` is `const this` and detaching writes to a shared `Sched`, which is a better reason than the one it had |
| 2 | not started; `Sched.off` and `Core.cancel` landed 2026-08-30 as prerequisites |
| 3 | not started |
| 4 | not started |
| 5 | not started |

## Open

**How `await` in expression position sequences.** `f(await g(), await h())` has an evaluation order
this document does not fix. Left-to-right is the obvious answer and should be written down before it
is implemented rather than after.

**Whether an async function that is never consumed should be reported.** Under D1 it runs eagerly, so
it is not dead — but its *result* may be dropped, and the runtime already counts undrained work. Worth
deciding whether that is the same message.

**What `bindgen` does with an async export.** A host calling one gets a ticket; nothing here says how
that crosses the boundary, and `packages/platform/host/` has opinions about `Pending` already.
