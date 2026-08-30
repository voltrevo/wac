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

### D6a — `async` lambdas are not in this pass, and the refusal is

D6 says *the whole language*, and a lambda is part of it. This document did not mention one, which is
an omission rather than a decision, so here is the decision.

**Wanted, and after this document rather than in it** — the operator confirmed the feature and left the sequencing to judgement; `issues/lang/0294c` holds it so it is not lost. No acceptance criterion here needs one: A1's `serve` and `accepting` are async
functions, and A6's `relayd` becomes async functions too. A lambda is already hoisted to a function
with a captured environment, so `async` on one is the *same* transform step 4 builds — worth applying
once, to functions, before applying it twice.

The target type is the argument for doing it second rather than never: a lambda's slot is a `fn[…]`, so `fn[Pending<T>(…)]` says whether that slot may take an async lambda, and the rule falls out of a type rather than being written down.

**But the refusal has to exist now**, or step 4 inherits a program it cannot lower. `await` inside a
plain lambda was accepted until 2026-08-30: `c.inAsync` answered *which function am I in* with the
enclosing one, and entering a lambda never changed the answer, so this checked clean —

```wac
async i32 f(Pending<i32> p) {
  fn[void()] g = () => { i32 z = await p; };   // suspend what, exactly?
  …
}
```

`design/lang/0002` settles it: a lambda's `return` returns from the lambda, so its `await` would have
to suspend a plain funcref. The flag is now saved and cleared around a lambda body the way
`lambdaReturn` already was, and both answer the same question. When async lambdas arrive it becomes
the lambda's own flag and nothing else moves.

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

#### What it actually does today, and why the sentence is not written yet

**It does not hang. It answers a default, silently** — measured 2026-08-30 by awaiting a ticket that
is unsettled, carries no scheduler, and whose resolver has nothing to consult:

    about to wait on a chain nothing can advance
    it answered zero

That is worse than the hang this clause assumed, and it raises the stakes rather than lowering them:
a hang is at least a symptom.

**And it is not blocked on `trap "…"`,** which this document claimed. `issues/lang/0147` is closed —
`wac run` prints *trapped: the ring is full* today — and the note in `Pending.then` saying otherwise
was written while it was open.

What blocks it is that **the machine cannot tell the two cases apart**. Both look identical at the
moment of the wait:

| | `sched` | `isDone()` before | `isDone()` after `wait` |
| --- | --- | --- | --- |
| a host ticket, answer not yet arrived | null | false | **false** |
| a ticket nothing can ever answer | null | false | false |

The obvious check — *after waiting, is it settled?* — fails because a host ticket is **not** settled
after being waited on either: the slot is spent and `settled` answers false again. So neither before
nor after distinguishes them.

Making it decidable is a change to `Pending`'s contract, and the smallest one is a ticket knowing
whether anything outside the program can answer it. `resolve` being able to say *nobody will* would do
it, as would a host-backed ticket being distinguishable from a program-made one. Either is a decision
about the type every capability returns, which is why this is recorded rather than taken.

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
open. **Passes as of 2026-08-30**, in `packages/platform/test/wac/asyncserver_test.wac` — with two
differences from the sketch above, both of them the cut's limits rather than the design's:

- **`.linkedTo(core)` on every ticket.** `Cli` hands out tickets with no scheduler, so `then` traps on
  one and a machine awaiting it can only be driven by a `wait`. That is the open question below.
- **What was awaited is bound before the `match`.** A suspension in a `match` subject or arm is
  declined, so it reads `Read r = await cli.recv(sock); match (r) { … }`, and the `send` binds its
  result rather than being a bare `await`.

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

## What the hand lowering found

Step 2 was written as `packages/platform/test/wac/asynclower_test.wac` — the code the compiler will
emit, emitted by hand first, on the principle that a notation whose lowering turns out to be
impossible is worse than no notation. A2 passes: `fileSize(core, cli, "README.md").wait()` answers the
real size with no `drain` and no restructuring, and the same function completes under `drain` alone.

**The shape is smaller than the document assumed.** `Pending<T>` is an id plus three functions of that
id, so an async function's ticket is simply one whose `resolve` drives a state machine instead of
asking a host. `Sched`, `map` and `then` are untouched, and there is no state object: closures capture
**by reference**, so a captured local *is* the state slot. The estimate's reliance on
`design/lang/0002` holds.

**One thing was missing, and it was not the obvious one.** `Sched.off` fuses two operations —
unregister the continuation *and* drop the ticket — and D2's driving needs only the first. Written
with `off`, every wait-driven case trapped: the driver released the host's slot and then waited on a
ticket that no longer existed. `Sched.detach` and `Core.detach` are the other half, and the
distinction is now pinned in `sched_test.wac` with `off` beside it. Taking over is not giving up.

**Two constraints on what step 4 may emit**, both found by writing the lowering rather than by
reading the emitter:

- A lambda written directly as an argument to a static on a generic (`Pending<i32>.of(…)`), or
  directly into an array element, is *"in a position the walk does not type yet"* — four of them
  refused at once. Each must be bound to a local of a stated funcref type first. The lowering has to
  emit the bound form.
- `step[0]()` does not parse. A call after `]` is array construction, so the parser reads `step` as a
  type name — `issues/lang/0265c`. A state machine keeps its resumption point in exactly that shape,
  so step 4 meets that issue head-on rather than merely coexisting with it.

**D7 is not done and is blocked on a message.** A chain that cannot advance currently reaches a bare
`trap`, and `trap "…"` does not carry its text (`issues/lang/0147`). The whole point of D7 is that the
failure is a sentence rather than a hang, so it waits for the thing that can say one.

### What step 3 cost

A new keyword is not one edit. `kAsync` and `kAwait` are numbered after `kEof`, because everything
below 84 mirrors the reference's `TokenKind` order — so they cannot join the contiguous
`kImport`..`kMatch` block that two places tested to decide *is this a keyword*. Extending one of them
left the other reading the bare range, and `i32 async = 1;` produced five cascading parse errors
instead of the *'async' is a keyword and cannot be used as a variable name* that `i32 const = 1;` has
given all along. There is one predicate now, `isKeywordKind`, and both read it. **The test for the new
keyword is what found it** — the feature worked and the collision message did not.

`Await` is its own `ExprKind` rather than a `Unary` carrying the token. There are 23 `case Unary(`
arms; a new operator flowing through them would have been handled by whatever each already does with
an operator it does not recognise, silently. As a variant it broke five exhaustive matches by name,
which is the list of places that had to decide something — including `findLambdasExpr`, where missing
it would have lost a lambda written inside an `await` and produced an invalid module rather than a
diagnostic.

`Func` and `Method` each gained an `isAsync`, appended last: 37 identical `case Func(` arms and 11
constructions. `Method`'s own note already warned why last — it is a third `bool` beside `hasThis`
and `thisConst`, so a slot inserted among them would typecheck and mean something else.

## How step 4 lowers — decided by building both

Two candidates were hand-written as tests before either was generated, so the choice rests on code
that runs rather than on which sounded better.

| | CPS — `asyncchain_test.wac` | flattened state machine — `asyncstate_test.wac` |
| --- | --- | --- |
| one await | works | works |
| two awaits and a branch | works | works |
| **await inside a loop** | needs every continuation hoisted to a named function with its free variables threaded by hand | three lines: the resume arm sets `state` back to the header |
| new runtime | `ready` and `flatMap` in `std/platform.wac` | none |
| meets `issues/lang/0295c` | yes — it emits generic calls inside lambdas | no |
| closures | one per continuation, plus hand-written capture analysis when hoisting | three small ones for the ticket; the frame is an ordinary struct |

The loop row is the decision. It is A1 — the program this document exists for — and CPS needs
closure conversion written by hand there, duplicating what the lambda machinery already does. The
state machine needs the loop's back edge written as data, which is `state = 0`.

### Generated as AST, not as wasm

**Both arguments I first gave for this were wrong**, and correcting them is what settled it.

*"Emitting wasm directly would rebuild the closure subsystem."* Backwards — a state machine **avoids**
closures. The locals that cross an await are fields of a frame, not captures, and `Pending<T>` is an
id plus three functions **of that id**, which is exactly the shape for a frame reached by index.

*"wasm has `br_table`, so only wasm can re-enter a loop."* False. `emitStmt`'s own note says `if` and
`while` are wasm's structured control flow rather than jumps, and a branch can only leave an enclosing
block, never enter one. **wasm has no goto either.** So the control-flow graph has to be flattened
whichever level the machine is built at — that work is common to both and is not a reason to prefer
either.

What is left decides it. Once flattened, every state is straight-line code, so the machine is
ordinary wac and the emitter that already exists emits it. Generating wasm instead would additionally
need its own dispatch, its own frame layout, and its own rewriting of local accesses into frame
accesses — untyped, at the level where mistakes are silent rather than diagnosed. It would buy one
thing: `switch` is emitted as a chain of comparisons rather than a `br_table`, so dispatch is linear
in the number of states. That is a constant factor on each resume, and if it ever matters the fix is
to emit `br_table` for `switch` — which every wac program would get, not only the async ones.

*Assessed rather than built*: the wasm route was sized by reading `emitStmt` (446 lines, 21 statement
kinds, though after flattening the existing arms would emit each segment) and by reading how `Switch`
emits. The state-machine and CPS lowerings were both actually written and both run.

### What the AST route still needs

Synthetic tokens, because every later phase learns what a token says by reading bytes out of the
source, so a node the rewrite invents still needs a span. `wapytok.wac` has the prior art and
`asyncsynth.wac` is the instrument, pinned by its own tests. Its two rules carry over: a synthetic
token keeps the span of the token it came from, so a diagnostic points at the word the reader wrote;
and the appended spellings hide behind a comment, so a source that is lexed twice is not extended
twice.

## How step 4 will lower, and why that way

**An AST-to-AST rewrite after checking, before emission.** The checker already understands `async`
and `await`; the emitter never needs to. So the transform sits between them and hands the emitter
ordinary wac — the shape `packages/platform/test/wac/asynclower_test.wac` writes by hand and which is
therefore known to compile and run.

The two alternatives were considered and are worse:

- **Lowering in the emitter**, straight to wasm. Closures are a whole subsystem
  (`design/lang/0002` tier two) and this would rebuild the environment machinery a second time, by
  hand, at the level where mistakes are silent.
- **Rewriting the source text** and re-lexing. It needs a printer that turns an arbitrary expression
  back into compilable wac, which does not exist — `print.wac` writes a debug form, not source. An
  AST rewrite does not need one, because it **reuses the original subtrees**: only the scaffolding is
  new.

**Synthetic tokens are the mechanism, and there is prior art.** Every later phase reads a name
through `tokenText`, so a node the reader did not write still needs a span. `wapytok.wac` and
`wapyparse.wac` already do this for wapy's rewrites — `for i in range(a, b)` becomes
`for (i32 i = a; i < b; i++)` and none of `i32`, `<`, `++` is in the file. Its two hard-won rules
carry over and are worth repeating rather than rediscovering:

- **A synthetic token keeps the span of the token it came from**, so a diagnostic points at the word
  the reader wrote. `await`'s own token is the honest span for everything derived from it.
- **The appended spellings live behind a `#`**, so the tail is invisible to the lexer and the rewrite
  is idempotent when a file is processed twice. A bare tail was lexed as code the second time round.

### `Sched` holds host ids only, and that decides the shape

`Sched.run` picks what to dispatch with `core.waitAny(live, budget)` — it hands the registered ids
**to the host**. So a ticket the *program* made cannot be registered: the host is asked about an id it
never issued. Measured rather than reasoned:

    core.sched.on(999999, (i32 id) => { core.log("fired"); }, noop);
    core.drain();
    → "registered; draining" / "drained some" — and never "fired"
    → wac: … finished with 1 continuation(s) still waiting

It does not trap; the work simply never runs, and the existing end-of-program report is what says so.

**Three things follow, and they are why the hand lowering is shaped as it is.**

1. **The machine registers on the host ticket it is currently awaiting**, never on its own ticket, and
   re-registers as it advances. `Sched.run` unregisters a handler before running it precisely so a
   handler may register more — which is the mechanism the next `await` uses.
2. **`flatMap` cannot be a method that fixes this.** A `Pending<Pending<U>>` flattened by composing
   `resolve` answers correctly under `wait` and blocks under `drain`, because the composed resolve
   waits on the inner ticket inside a continuation — which would serialise the two clients A1 exists
   to overlap. Two-stage registration needs to know the whole chain, so it belongs in the lowering
   and not in a combinator.
3. **`then` on an async function's own ticket cannot work through `Sched`.** A caller may `wait` it;
   being *notified* when it completes needs the machine to keep its own list of waiters, which is a
   program-level thing rather than a scheduler one. Not needed by any acceptance criterion — A1 and
   A2 wait or drain — so it is recorded rather than built.

The second open question below is answered in passing: **there is already a message for work that was
never run**, and it names the fix. An async ticket nobody consumed should reuse it rather than invent
one.

### The one runtime question it turns up

`then` **traps on an unlinked ticket**, and `Cli`'s tickets are unlinked — only `Core.of` links the
four it hands out. So `await cli.recv(sock)`, written exactly as A1 writes it, would trap at the
moment the continuation is registered. Confirmed by running it.

The lowering therefore registers **only when the ticket carries a scheduler**, reading `up.sched`
rather than requiring a `Core` parameter the function may not have. An unlinked chain still advances
under `wait` — which is the *host-backed → block* row of D2's table — and cannot advance under
`drain`, because there was nowhere to register it.

That is coherent but it leaves a silent stall, which is the failure D7 exists to prevent, and it
means **A1 must say `.linkedTo(core)`** or the tickets it awaits must arrive linked. Both of A1's
functions take a `Core`, so the criterion is writable either way. Which of the two is right is a
decision for the operator, and the second is the larger one: `Cli` could carry the scheduler the way
`Core` does, at which point `linkedTo` disappears from the language. That echoes the correction that
put the ticket capabilities on `Core` in the first place — *the API asks for random bytes from core so
core should already own it* — and it is a change at the host boundary, which is why it is raised
rather than taken.

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
| 2 | **A2 done 2026-08-30** — `packages/platform/test/wac/asynclower_test.wac` 4/4, and `Sched.detach` is what it needed. D7 still open, blocked on `issues/lang/0147` |
| 3 | **done 2026-08-30** — `packages/wacc/test/wac/async_test.wac` 8/8. `async`/`await` lex, parse and check; both halves of D3 (the body against the written type, callers against `Pending<T>`); D4's help; A5's first two refusals as codes 211 and 212. The emitter declines an async function whole, by name |
| 4 | **done 2026-08-30 for A1–A4** — `asyncsyntax_test.wac` 15/15 and `asyncserver_test.wac` 1/1. A1 runs: two clients accepted while the first is open, both echoed, under one `drain`, with `async void`, a suspending `while`, a `match`, and an early `return` out of the loop. Declined by name: a suspension in a loop or `if` **condition**, in a `match` subject or arm, nested in a larger expression, or one whose value is discarded |
| 5 | **spec and corpus done 2026-08-30** — `spec/spec/async.md` with eleven clauses, seven cases in `spec/cases/`. A6 (`relayd`) not started |

## Open

**How `await` in expression position sequences.** `f(await g(), await h())` has an evaluation order
this document does not fix. Left-to-right is the obvious answer and should be written down before it
is implemented rather than after.

**Whether an async function that is never consumed should be reported.** Under D1 it runs eagerly, so
it is not dead — but its *result* may be dropped, and the runtime already counts undrained work. Worth
deciding whether that is the same message.

**What `bindgen` does with an async export.** A host calling one gets a ticket; nothing here says how
that crosses the boundary, and `packages/platform/host/` has opinions about `Pending` already.
