# Technical

One detail of the language per entry, with the outcome shown. An entry here is not always the best
way to write the thing; it is written to pin the detail down.

Read together these are meant to be enough to implement the language from.

Each is marked **done** or **not yet**, and that marker is the only thing here that refers to an
implementation.

**The marker is about the example, not about the heading**, and the two come apart often enough to
say so. *"`pop` answers an absence rather than trapping"* is marked **not yet** and `core/vec.wac`'s
`pop` has answered `Option<T>` — *"None if empty"* — all along; what does not compile is the entry's
`v.pop() is null`, because the change is `Option<T>` to `T?`. Same for *"an enum with a default"*,
where a catch-all arm compiles today as `else:`, and *"matching an enum"*, which is only *not yet*
because its example writes arms without `case` and matches a payload by type.

**All thirty checked now, and seven were this.** The other two: *"an `await` is a boundary because it
is written"* is a property of the language today — there is no preemption and
`std/platform.wac` says *"a park in `waitAny` runs nothing at all"* — and only its coroutine example
is *not yet*. *"`Vec<T>.pop` is written once and is honest at every `T`"* is written once today,
`Option<T> pop(this)` in `core/vec.wac`; what is *not yet* is the second half, since `T?` at
`T = i32` boxes and at `T = Node?` gives `Node??`, which is the thing the entry is really about.

Five were correctly marked and it is worth saying which, because they are the pattern to copy: *"an
arm can leave"* (`continue` in a match **expression** is `expected an expression` today), *"a
hyphenated attribute"* (`data-size="8"` is `unexpected token`), and *"`Sys.drain`"*, *"a continuation
is a ticket and a call"*, *"calling a `Waiting` continuation … traps"* — all three of which name a
**vision type** in the heading, so no reader takes them for a claim about wac. Naming the vision type
is the whole difference — and it is what let the remaining twenty be triaged rather than measured one
at a time. Seventeen of them name `never`, `coroutine`, `schedule`, `try`, `T??`, `Ticket.any`, a
verbatim name or a `Continuation` in the heading itself, so no reader can take them for a claim about
wac. Two more were read and are fine: *"an unawaited call hands its continuation to the current
target"* is half-shipped and says so, since *the current target* is `schedule`'s and today there is
one scheduler; *"`wait` answers `Err`"* names the vision answer where the shipped one traps.

The last two make seven. *"A nested pause does not change the caller's type"* is true today —
measured, an `async` calling an `async` compiles and the caller still answers a ticket — and only the
coroutine example is new. *"A test names itself"* is the subtlest: a test names itself today as
`export string test_the_thing()`, and what is *not yet* is naming itself with a **sentence**,
`@"test: an empty read returns End"`. Same shape as `pop` — the capability is there and the
expressiveness is what changes — and a reader scanning would conclude wac's tests cannot name
themselves.

So a reader scanning headings and markers is being told that wac cannot do things it does. That is
this directory's most expensive habit — `packages/README.md` counts seven times a rewrite claimed a
shipped feature was missing — and the markers are a machine for producing it. **Read the heading as
the design point and the marker as *"this spelling does not compile yet"*.**

See [README.md](README.md) for the three tiers and why nothing checks them.

---

## Literal tags and verbatim names

```wac
Node label(string id, string @"for", Node[] kids) {   // `for` is a keyword
  return <"label" id={id} for={@"for"}>{kids}</"label">;
}

Node field(string who) {
  return <label id="who" for={who}>Name</label>;
}
```

```wac
Node icon() {
  return <"my-widget" data-size="8" />;
}

Node dot() {
  return <"svg:circle" cx="1" cy="1" r="1" />;
}
```

A quoted tag name may be any name. An attribute name is written as it is in HTML, and runs to `=`,
whitespace, `/` or `>`.

The call site writes `for`, and the parameter it fills is `@"for"`.

**Not yet.**

---

## A hyphenated attribute

```wac
Node widget(string @"data-size") {
  return <"my-widget" data-size={@"data-size"} />;
}

Node sized() {
  return <widget data-size="8" />;
}
```

The parameter is `@"data-size"`. Both tags write the attribute as HTML does.

**Not yet.**

---

## `@` on a name that does not need it

```wac
i32 double(i32 @"n") {
  return n * 2;
}
```

```
warning: `@"n"` is just `n`
  --> math.wac:1:16
   |
 1 | i32 double(i32 @"n") {
   |                ^^^^
   = help: `n` needs no quoting — write `n`
```

`@"n"` and `n` are the same name. The program compiles.

**Not yet.**

---

## A quoted tag and a quoted name

```wac
Node caption(Node[] kids) {
  return <"label">{kids}</"label">;
}

Node one()   { return <caption>Name</caption>; }
Node two()   { return <@"caption">Name</@"caption">; }
Node three() { return <"caption">Name</"caption">; }
```

`one` and `two` both call `caption`. `three` is the `caption` element.

**Not yet.**

---

## A test names itself with a sentence, not an identifier

```wac
export void @"test: an empty read returns End"() {
  // …
}
```

```
ok   test: an empty read returns End
```

**Not yet.**

---

## Const through an accessor

```wac
struct Server {
  Vec<Route> routes;
  Vec<Route> table(const this) { return this.routes; }
}

i32 count(const Server s) {
  return s.table().len();
}
```

```wac
void add(const Server s, Route r) {
  s.table().push(r);
}
```

```
error: a non-const reference cannot be taken from a const one
  --> server.wac:2:13
   |
 2 |   s.table().push(r);
   |             ^ `push` writes, and `s.table()` is const
```

`table` hands back the real `Vec`. Reading it is allowed and writing to it is not.

**Done, except the message.** Both halves are current behaviour, measured: reading through a `const`
accessor checks clean and writing through it is refused. `issues/lang/closed/0060` — *a value
returned from a `const this` method stays const* — is what implemented it.

The caret above is **not** what the compiler says. Today it is

```
   |                                                     ^
   = help: take a copy, or declare the destination `const` too
```

and that help is wrong at this site — there is no destination — which is
`issues/lang/open/0316a`, filed from this entry's own example. So the entry is a picture of the
diagnostic it should have, and it was marked *Not yet* as though the rule were unimplemented.

---

## Matching an enum, with no `case` and a payload matched by type

```wac
async void show(Sys sys) {
  match (await sys.readFile("a.txt")) {
    Ok(bytes):        { use(bytes); }
    Err(is NotFound): { sys.log("no a.txt — using the default"); }
    Err(_):           { sys.warn("cannot read a.txt"); }
  }
}
```

```wac
async Result<Config, string> load(Sys sys) {
  return match (await sys.readFile("config.json")) {
    Ok(bytes):        parse(bytes),
    Err(is NotFound): Result.Ok(Config.defaults()),
    Err(e):           Result.Err(e.message()),
  };
}
```

Arms hold blocks or values, and a match holding values is an expression. `is` matches a variant
inside a payload; a bare name there binds it.

**Not yet.**

---

## An arm can leave

```wac
async i32 totalSize(Sys sys, string[] names) {
  i32 total = 0;
  for (string name in names) {
    u8[] bytes = match (await sys.readFile(name)) {
      Ok(b):  b,
      Err(_): continue,
    };
    total += bytes.len();
  }
  return total;
}
```

An arm that leaves gives no value, and is not asked to agree with the others.

**Not yet.**

---

## An enum with a `default` arm, spelled `default` rather than `else`

```wac
string advice(Fault f) {
  return match (f) {
    NotGranted: "start it with the grant it needs",
    IsDir:      "that path is a directory",
    default:    "",
  };
}
```

```wac
f64 area(Shape s) {
  return match (s) {
    Circle(r):  3.14159 * r * r,
    Square(sd): sd * sd,
    default:    0.0,
  };
}
```

```
error: this `default` is unreachable
  --> shapes.wac:6:5
   |
 6 |     default:    0.0,
   |     ^
   = help: every variant is already named — remove it
```

**Not yet.**

---

## An unawaited call hands its continuation to the current target

```wac
struct Slot {
  i32 n;

  async void tick(this) {
    this.n += 1;
    await;
    this.n += 10;
  }
}

void example() {
  Vec<Continuation> pending;
  schedule pending.push;

  Slot s;
  s.tick();

  s.n;               // 1
  pending.len();     // 1
}
```

An unawaited call runs to its first suspension and hands its continuation to the current target.

**Not yet.**

---

## `schedule` applies to the end of its block

```wac
void example() {
  Vec<Continuation> outer;
  Vec<Continuation> inner;
  schedule outer.push;

  Slot s;
  {
    schedule inner.push;
    s.tick();
  }
  s.tick();

  inner.len();       // 1
  outer.len();       // 1
}
```

**Not yet.**

---

## A resumed coroutine restores its own `schedule`

```wac
void example() {
  Vec<Continuation> outer;
  Vec<Continuation> inner;
  schedule outer.push;

  Slot s;
  Generator<void, void> g = capture(inner, s);

  g.step();          // runs to the yield, installing `inner`
  s.tick();          // outer
  g.step();          // resumes inside capture's scope

  outer.len();       // 1
  inner.len();       // 1
}

gen<void> void capture(Vec<Continuation> inner, Slot s) {
  schedule inner.push;
  yield;
  s.tick();
}
```

The second `step()` is made where `outer` is the target, and the tick inside `capture` still goes to
`inner`. The target belongs to the suspended scope rather than to whoever resumed it: `schedule`
comes back because the scope comes back, and a coroutine's saved state carries it.

Nothing here is specific to async — a sync generator suspends inside a scope the same way. It is
what lets `Sys.drain` write `schedule` once and keep it across its own suspensions, and why the
resumer needs no cooperation: `step()` and `call()` are ordinary calls that know nothing about
scheduling.

**Not yet.**

---

## A continuation is a ticket and a call

```wac
struct Continuation {
  TicketBase? t;
  fn<void()> call;
}

void example() {
  Vec<Continuation> pending;
  schedule pending.push;

  Ticket<i32> input;
  Ticket<i32> r = doubled(input);

  pending[0].t is input;   // true
  input.resolve(10);
  pending[0].call();

  r.value();               // 20
}

async i32 doubled(Ticket<i32> t) {
  return (await t) * 2;
}
```

**Not yet.**

---

## Calling a `Waiting` continuation before its ticket settles traps

```wac
void example() {
  Vec<Continuation> pending;
  schedule pending.push;

  Ticket<i32> t;
  doubled(t);

  pending[0].call();       // trap: `t` has not settled
}
```

**Not yet.**

---

## `Sys.drain` runs the work nobody awaited

```wac
struct Sys {
  Queue<Continuation> pending;

  async void drain(this) {
    schedule this.pending.push;

    while (this.pending.len() > 0) {
      Continuation c = this.pending.pop()!;
      await c.t;
      c.call();
    }
  }
}
```

`schedule` is the first statement, so a machine that suspends again inside `call()` lands back in
`pending` rather than in whatever target was in force where it was first called: drain captures what
it starts, and what it starts is simply further along the same queue. Its own `await` hands drain's
continuation to the target above it, and the target is back in force when drain is resumed.

`await c.t` is the whole of the dispatch. A null ticket is the bare `await` — one step boundary
and no waiting — so a ready continuation and a blocked one take the same two lines, and drain
yields between each and the next rather than monopolising.

`t` is a `TicketBase?`, so one `await` serves every kind of ticket, a fake `Sys`'s included, and
answers nothing, which is all drain wants. A queue rather than a `Vec` because the loop consumes at
one end and grows at the other.

**Not yet.**

---

## `wait` answers `Err` when nothing can advance the ticket

```wac
i32 example() {
  Ticket<i32> t;              // nothing will ever resolve it
  return match (t.wait()) {
    Ok  { v }:  v,
    Err { .. }: -1,
  };
}
```

`wait` advances the ticket, advances it again blocking, and if neither moved it there is nobody left
to try: the sync caller is the driver. The same ticket under `await` is the caller's driver's
problem instead, which is why `await` answers a value and `wait` answers a `Result`.

**Not yet.**

---

## `drain().wait()` and `await drain()` are the same program

```wac
i32 main(Sys sys) {
  tick(sys, "a");
  tick(sys, "b");
  return match (sys.drain().wait()) {
    Ok  { .. }: 0,
    Err { .. }: 1,
  };
}
```

```wac
async i32 main(Sys sys) {
  tick(sys, "a");
  tick(sys, "b");
  await sys.drain();
  return 0;
}
```

```
a
b
a
b
```

`tick` is the one from *Giving other work a turn*. Same machine, two drivers: `wait` advances it
from sync code, `await` suspends the caller and lets the caller's driver advance it. Only the
failure reporting differs, and that difference is forced rather than chosen.

**Not yet.**

---

## `await` needs a ticket

```wac
async i32 example() {
  return await 5;
}
```

```
error: `await` needs a ticket, and `5` is an `i32`
  --> e.wac:2:16
   |
 2 |   return await 5;
   |                ^
```

JavaScript accepts any value here, which is what lets a forgotten `async` on the callee compile:
`await maybePromise` is fine either way and the bug surfaces somewhere else.

**Half done, and the half that is missing is this entry's example.** `await n` for an `i32 n` is
already refused — `[§wac-await-pending-9km2xtr]`, code 212, *this cannot be awaited*. `await 5` is
not: it checks clean and fails in the emitter with *a null in a `Pending<i32>` slot*. The refusal
fires on a name and on nothing else, which is `issues/lang/open/0323a`, found by checking this
entry.

---

## `await;` has no rival

```wac
async void example(Continuation c) {
  await c.t;        // a TicketBase? — one step boundary, and no waiting if it is null
  await;            // the same thing, spelled directly
  await null;       // error: `null` has no type here
}
```

`null` is a literal with no type of its own and `await`'s operand position expects no particular
nullable type, so there is nothing to infer it from. The bare form stays the only way to write a
step boundary without a ticket.

**Not yet.**

---

## Returning a ticket from an `async T` function is an error

```wac
async i32 total(Sys sys) {
  return size(sys, "a.txt");
}

async i32 size(Sys sys, string f) { … }
```

```
error: `total` returns `i32`, and `size(sys, "a.txt")` is a `Ticket<i32>`
  --> e.wac:2:10
   |
 2 |   return size(sys, "a.txt");
   |          ^^^^^^^^^^^^^^^^^^
   = help: `return await size(sys, "a.txt");`
```

`async` wraps the declared return type. It does not adopt a ticket the body happened to produce, so
the two spellings are not interchangeable and dropping the `await` is not a shortcut. JavaScript
adopts, which is why `Promise<Promise<T>>` cannot be built there.

**Done** — and it is not a rule. `design/lang/0014` D4 says so outright: *"an earlier draft made this
an error; the mistake it was aimed at […] is an ordinary return-type mismatch that needs no special
rule."* The compiler already answers, word for word with the note:

```
error: expected i32, found Pending<FileResult>
  = help: `await` it for the FileResult, or declare `async Pending<FileResult>` to hand the ticket on
```

This entry was written as though the refusal needed inventing. It needed nothing.

---

## `Ticket<Ticket<T>>` is an ordinary type

```wac
async Ticket<Response> send(Sys sys, Request r) { … }

async Response roundTrip(Sys sys, Request r) {
  Ticket<Response> sent = await send(sys, r);     // it went out
  return await sent;                              // it came back
}
```

`send` answers a `Ticket<Ticket<Response>>`: one ticket for the request leaving, one for the reply
arriving. A caller that only wants to know it was sent awaits once and keeps the second ticket, or
drops it. Adoption would merge the two events into one and there would be no way to ask about the
first.

**Done.** `async Pending<FileResult> later(Cli cli) { return cli.readFile("x"); }` checks clean and
its caller holds a `Pending<Pending<FileResult>>` — measured. `design/lang/0014` D4 decided it and
records it as *"verified to compile and run today"*.

---

## `coroutine` answers the machine and runs nothing

```wac
struct Slot {
  i32 n;

  async void tick(this) {
    this.n += 1;
    await;
    this.n += 10;
  }
}

void example() {
  Slot s;
  Coroutine<TicketBase, never, void> c = coroutine s.tick();

  s.n;               // 0
  c.step();          // Waiting
  s.n;               // 1
  c.step();          // Done
  s.n;               // 11
}
```

**Not yet.**

---

## `await;` suspends on a settled ticket

```wac
void example() {
  Coroutine<TicketBase, never, void> c = coroutine tick();

  match (c.step()) {
    Waiting(t): { t.settled(); }     // true
    Done(_):    { }
  }
  c.step();          // Done
}

async void tick() {
  await;
}
```

**Not yet.**

---

## A nested pause does not change the caller's type — shown with a coroutine

```wac
void example() {
  Coroutine<TicketBase, never, void> c = coroutine outer();

  c.step();          // Waiting
  c.step();          // Done
}

async void outer() {
  await middle();
}

async void middle() {
  await inner();
}

async void inner() {
  await;
}
```

**Not yet.**

---

## An async generator uses both variants

```wac
void example() {
  Ticket<i32> t;
  t.resolve(2);

  Coroutine<TicketBase, i32, void> c = coroutine counter(t);

  c.step();          // Yielded(1)
  c.step();          // Waiting
  c.step();          // Yielded(2)
  c.step();          // Done
}

async gen<i32> void counter(Ticket<i32> t) {
  yield 1;
  yield await t;
}
```

**Not yet.**

---

## An `await` is a boundary because it is written — shown with a coroutine

```wac
void example() {
  Ticket<i32> t;
  t.resolve(21);

  Coroutine<TicketBase, never, i32> c = coroutine doubled(t);

  c.step();          // Waiting
  c.step();          // Done(42)
}

async i32 doubled(Ticket<i32> t) {
  return (await t) * 2;
}
```

**Not yet.**

---

## `never` satisfies any type

```wac
i32 pick(bool b) {
  if (b) { return 1; }
  return spin();
}

never spin() {
  while (true) { }
}
```

**Not yet.**

---

## A `never` function cannot return

```wac
never spin(bool once) {
  if (once) { return; }
  while (true) { }
}
```

```
error: a `never` function cannot return
```

**Not yet.**

---

## Code after a `never` call is unreachable

```wac
i32 example() {
  i32 x = spin();
  return x;
}
```

```
warning: `x` is never bound — `spin()` does not return
```

```wac
void example() {
  spin();
  more();
}
```

```
warning: `more()` is unreachable — `spin()` does not return
```

**Not yet.**

---

## `try` requires the error to be in the set, not equal to it

```wac
async Result<Config, union<NotFound>> load(Sys sys) {
  u8[] bytes = try await sys.readFile("config.json");
  Config config = try parse(bytes);
  return Result.Ok(config);
}

Result<Config, Malformed> parse(u8[] bytes) { … }
```

```
error: `parse` can fail with `Malformed`, which `load` does not return
  --> load.wac:3:20
   |
 3 |   Config config = try parse(bytes);
   |                   ^^^
   = help: add it to the error set, or handle it here
```

**Not yet.**

---

## `Ticket.any`'s losers keep running

```wac
async void example(Sys sys) {
  Ticket<i32> a;
  Ticket<i32> b;
  Slot s;

  Ticket<i32> win = Ticket.any([
    add(s, a),
    add(s, b),
  ]);

  a.resolve(1);
  await win;
  s.n;                  // 1

  b.resolve(10);
  await sys.drain();
  s.n;                  // 11
}

async i32 add(Slot s, Ticket<i32> t) {
  s.n += await t;
  return s.n;
}
```

**Not yet.**

---

## Every state of a `T??` has a spelling

```wac
void example() {
  Node   n = Node();
  Node?? a = null;                // absent
  Node?? b = null as Node?;       // present, holding a null
  Node?? c = n;                   // present, holding it

  a is null;        // true
  b is null;        // false
  b! is null;       // true
  c!! is n;         // true
}
```

`as` is what types the literal. Widening a typed value wraps it, so a `Node?` reaching a `Node??`
arrives present whatever it holds, and only a bare `null` means the outermost absence.

**Mostly done, and the exception is the interesting line.** `Node?? a = null`, widening a `Node` two
levels, and `c!!` all check *and emit* today — measured, so nesting is not the new part. `null as
Node?` checks and then fails to emit with *cast to an unsupported type*, at one level of nullability
as readily as two. That is `issues/lang/open/0324a`, found from this entry: the one construct that
reaches the middle state is the one that cannot be built.

**Not yet.**

---

## `pop` answers an absence rather than trapping — spelled `T?`

```wac
void example() {
  Vec<i32> v;

  v.pop() is null;      // true
  v.push(3);
  v.pop()!;             // 3
  v.pop() is null;      // true
}
```

**Not yet.**

---

## `Vec<T>.pop` is written once — and with `T?` must be honest at every `T`

```wac
struct Vec<T> {
  T[] data;
  i32 len;

  T? pop(this) {
    if (this.len == 0) { return null; }
    this.len -= 1;
    return this.data[this.len];
  }
}

i32 example(Vec<Node?> v) {
  Node?? got = v.pop();

  if (got is null)  { return 0; }     // the vec was empty
  if (got! is null) { return 1; }     // it held a null
  return 2;
}
```

Neither `return` mentions nullability and neither needs a second case. At `T = Node?` the bare
`null` is the outer absence, and `this.data[i]` widens into a present outer whatever it holds. Under
flattening the two would arrive as one value, and there is nothing the body could write to tell them
apart again.

**Not yet.**


## `union<A, B>` lowers to an enum of one-field variants — **done**, in the sense that the target runs

The marker needs its usual care: the *source* form does not parse today, and the **target** below is
today's wac, checked and run on 2026-09-04 through `bootstrap/ts/ask_wacc.ts`. That is what makes
this entry worth having — `union` has looked like a type-system feature all week and the measurement
says it is a declaration form and one coercion.

**What is written:**

```wac
export struct Truncated { i32 at; }
export struct LeadingZero { i32 at; }
export union<Truncated, LeadingZero> RlpFault;

Result<Item, RlpFault> decode(Bytes b) {
  …
  return Err(LeadingZero(at));          // an `Err` of a *member*, not of the union
}
```

**What it becomes:**

```wac
enum RlpFault { AsTruncated(Truncated v), AsLeadingZero(LeadingZero v) }

Res<Item, RlpFault> decode(Bytes b) {
  …
  return Res.Err(RlpFault.AsLeadingZero(LeadingZero(at)));
}
```

`probe() = 207` for the two-member case, `1004` for the same inside a generic `Result<T, E>`; zero
parse errors and zero type errors on both.

### Three rules, and only the second is new

1. **The declaration** generates an enum with one unary variant per member. The variant names are
   compiler-internal and never written — `AsLeadingZero` above is a name invented for the example,
   and the fact that no natural one exists is the reason the source form does not name them either.
2. **Injection is implicit.** A value of a member type, in a slot whose type is the union, is wrapped.
   `Err(LeadingZero(at))` against `E = RlpFault` becomes `Err(RlpFault.AsLeadingZero(…))`. **This is
   the whole of what the language adds** — everything else here compiles today — and it is the same
   coercion `T` to `T?` already has, at a slot rather than at a nullable.
3. **`Err(is Corrupt):` is `case AsCorrupt(c):`.** Matching a member by type is matching its variant,
   and the binding that `../QUESTIONS.md` records as impossible — *"a payload matched by type does
   not bind"* — is not impossible in the target: `case AsCorrupt(c)` binds. So the missing binding is
   a property of the **source syntax** rather than of the lowering, which narrows that question to a
   spelling.

### Nesting works, and it settles the flattening question

`union<SourceFailed, Corrupt>` where `Corrupt` is itself a union becomes an enum whose variant
carries an enum. Measured:

```wac
enum Corrupt { AsBadMagic(BadMagic v), AsChecksum(ChecksumMismatch v) }
enum Fault   { AsSourceFailed(SourceFailed v), AsCorrupt(Corrupt v) }

match (f) {
  case AsSourceFailed(s): …
  case AsCorrupt(c):      …      // all of Corrupt's members, in one arm
}
```

`probe() = 20`, constructed as `Fault.AsCorrupt(Corrupt.AsBadMagic(BadMagic(3)))`.

That is exactly what `@/packages/box/src/gunzip.wac` wants — one sentence for the whole `Corrupt`
group — and it is the argument against flattening made concrete: under a flattening lowering
`union<A, union<B, C>>` is `union<A, B, C>`, `AsCorrupt` does not exist, and the applet is back to
eight arms.

**And it is not the whole argument, which is worth correcting here rather than elsewhere.** This
entry said nesting *"is the one that preserves the grouping, and it is also the simpler one to
implement"*, and grouping is only one of the two things an error union is for. The other is
stacking, and `@/packages/box/src/upper.wac` — the first program in this directory to compose two
stream transforms — is the case that wants the opposite.

`upperCase<E>` takes a stream failing with `E` and answers one failing with `union<E, NotText>`. Two
stages give `union<union<NotGranted, NotText>, NotText>`: **`NotText` at two depths**, two variants
of two enums, and `Err(is NotText):` matching the outer one only. A caller asking *was the input not
text* is right when the second stage found it and wrong when the first did.

Flattening gives `union<NotGranted, NotText>` — one `NotText`, the question answerable, the depth
gone — and loses `is Corrupt`.

So the two lowerings each have a consumer and the consumers want opposite things. Neither is a
corner case: grouping a family of faults and stacking a pipeline are what error unions are for. The
lowering above is still what a `union` *compiles to*; which of the two the **declaration** means is
open, and is `../QUESTIONS.md`'s.

### What the lowering does not answer

**Two unions sharing a member** are two enums with two wrappers, so an `A` injects into either by
slot and a `union<A,B>` is not assignable to a `union<A,B,C>`. Whether it should be is a subtyping
question the lowering does not force; nothing in this directory needs it.

**A member appearing twice** — `union<A, A>` — is two variants of one payload type, which the
lowering builds and no rule refuses. Worth refusing at the declaration.

**And the cost of not having it, from the same programs.** `Res.Err(RlpFault.AsLeadingZero(
LeadingZero(at)))` against `Err(LeadingZero(at))`: three constructor calls and one invented name,
against one call. Eleven files here declare a union and fifteen use one in a type, so the injection
rule is the difference between the error types this exercise has been arguing for and a spelling
nobody would write twice.

## `gen<T>` and `yield` lower to a struct with a resume tag — **the target runs; the transform is wacc's own**

Same treatment as `union` above, and the same caveat: the source form does not parse today, the
**target** does. Both programs below were checked and run on 2026-09-04.

**A `Vec`'s `items()`**, which is 18 of this directory's 42 `for … in` receivers:

```wac
enum Step<T> { Yielded(T value), Done }
struct Items<T> { Vec2<T> of; i32 at; }

Step<i32> next(Items<i32> it) {
  if (it.at >= it.of.len) { return Step.Done; }
  i32 v = it.of.data[it.at];
  it.at = it.at + 1;
  return Step.Yielded(v);
}
```

and the loop that consumes it — which is what `for (i32 x in v.items()) { … }` becomes:

```wac
Items<i32> it = itemsOf(v);
while (true) {
  match (next(it)) { case Done: { break; } case Yielded(x): { sum = sum + x; } }
}
```

`probe() = 15`. Zero parse errors, zero type errors.

**A yield inside a nested loop**, which is the case that decides whether this is a real lowering or
a special case for cursors. Both counters and a resume tag go into the state:

```wac
struct Pairs { i32 n; i32 i; i32 j; i32 resume; }
```

`probe() = 22` — `0 + 1 + 10 + 11` over a 2×2 sweep, resuming into the inner loop each time.

### Why `Step<T>` and not `T?`

`T? next()` cannot distinguish *done* from *a null element*, and `Vec<Node?>` is not hypothetical —
`core/vec.wac`'s `pop` already documents the same problem and answers `T??`, where *"the outer
absence is the vec was empty and the inner is the element was null"*. A generator is stepped in a
loop, so the outer absence is the loop's exit condition and getting it wrong is an infinite loop
rather than a wrong value. `Step<T>` is two arms and no nesting.

### The transform is one wacc already performs

**And the file that performs it said otherwise until today.** `packages/wacc/src/asyncplan.wac` is
the plan for lowering `async` bodies, and its header said an `await` inside a loop *"needs the loop's
back edge as a state, which is the next increment rather than this one"*. Three other places in the
same file say the increment landed — the walk descends into `While`, `For` and `DoWhile`; `hoistTy`
records that locals *"started being hoisted out of loop bodies"*; `suspendAt` records that a
top-level index stopped meaning anything *"with loops"* — and `test/wac/asyncplan_test.wac` pins an
`await` in a `for` body at `ok suspends=1 hoist=3`, *"total, i and a hoisted"*. The header is
corrected.

Which matters here rather than only there: **a generator needs exactly what that plan computes** —
where the suspension points are, which locals outlive one, and their types. The differences are that
a generator is driven by its caller rather than by a scheduler, and that it passes a value out at
each suspension. Neither needs new analysis.

What still declines in that plan declines here too: an `await` — or a `yield` — in a loop's
**condition, initialiser or update**, or nested inside a larger expression. `@/packages/rlp`'s
`while (this.at < end) { items.push(try this.item()); }` is a suspension in a *body* and is fine;
`while (try more())` would not be.

### What this does not lower

**`try await for`** is three constructs at once — a generator, an await, and a failure propagated as
the loop's own return — and the target for it is a `while` over `Step<T>` inside an `async` body
whose `Err` arm returns. Each part is above; nothing has written the combination out, and it is the
loop head in eleven files here.

## `try` and `try for` lower to a `match` with an early return — **the targets run**

The last two entries lowered `union` and `gen`/`yield`. This is the third piece, and with it
`try await for` — the loop head in eleven files here — has no part left unaccounted for.

**`T x = try e;`**, in a function answering `Result<U, F>`:

```wac
i32 x = 0;
match (step(a)) {
  case Err(e): { return Res.Err(e); }
  case Ok(v):  { x = v; }
}
```

`probe() = 10` on the happy path and `probeBad() = -9` on the failing one — the `Err` propagated
through two chained steps. Zero parse and zero type errors.

**That program is correct and the lowering it shows is not general**, which is worth putting here
rather than quietly fixing, because the reason is the antipattern this whole directory is about.

`i32 x = 0;` invents a value. It is available at `i32` and not at a `T` with no cheap construction —
and wac has no uninitialised declaration to fall back on: `Foo x;` is **two parse errors**, measured.
So *declare, then assign in the arm* only works where the desugarer can make up an `x`, which is the
same *invent a value you do not have* that `@/packages/rlp`'s four `Item.Bytes(u8[0]())` and
`@/packages/abi`'s `Value[0](fill: …)` are findings about.

**The general lowering puts the rest of the block inside the `Ok` arm:**

```wac
Res<i32, Fault> use(i32 a) {
  match (step(a)) {
    case Err(e): { return Res.Err(e); }
    case Ok(x): {
      // everything that followed `Big x = try step(a);` is now here
      return Res.Ok(x.limbs.len());
    }
  }
}
```

`probe() = 3` and `probeBad() = -9` at a `Big` that has no default. Nothing is invented.

### And that is the cost, which is not the one the first version suggested

Each declaration-form `try` nests the remainder of its block one level deeper.
`@/packages/datetime`'s `parse` has **eight** of them — `i32 year = try c.digits(4);` and its
siblings, one per field of the grammar — so its lowered form is eight `match`es deep before the
first arithmetic.

Which decides something about the *shape of the implementation* rather than about the language:
**a source-to-source desugarer is the wrong target.** Its output for that function is unreadable, and
unreadable output is not a minor cost for a tool whose purpose is to let people run the proposal —
every diagnostic, every line number and every stack frame would point into it. The transform belongs
in a compiler pass over an AST, where the nesting is a tree shape nobody reads.

The declaration also has to be split from the binding, because a `match` arm is a block and cannot
introduce a name into its enclosing scope — which is why `try` is not a token rewrite at all: it
needs the statement it sits in **and everything after it**.

**`try for (T x in src) { … }`** over a generator answering `Result<void, E>`:

```wac
while (true) {
  match (nextOf(s)) {
    case Yielded(x): { sum = sum + x; }
    case Done(r): {
      match (r) { case Err(e): { return Res2.Err(e); } case Ok(_): { } }
      break;
    }
  }
}
```

`probe() = 3` over a source yielding 1 and 2, `probeBad() = -5` when the same source ends with
`Err`. Zero errors on both.

### `try await for` is these three and nothing else

| part | established by |
|---|---|
| the `while` over a two-arm `Step`, `Done(Err)` returning and `Done(Ok)` breaking | the program above |
| `try`'s propagation | the program above it |
| an `await` in the loop **body** | `packages/wacc/test/wac/asyncplan_test.wac` — `ok suspends=1 hoist=3` |

Nothing in the combination is new. What the three-word head buys is that the reader does not write
fourteen lines of it per loop, and what it costs an implementation is a tree — every one of the
three needs the enclosing statement, and none is a token substitution.

### The `Step` the loop matches has two arms and the type has three

`core/coroutine.wac` declares `Step<W, Y, R>` with `Waiting`, `Yielded` and `Done`, and an
`AsyncGenerator`'s `nextStep` answers `Ticket<Step<never, Y, R>>` — *"a slot typed `never` removes
its arm"*. The target above is a two-arm enum, so the lowering of `Step<never, Y, R>` is *the enum
with the `never` arm deleted*, which is a fourth transform and is the one place `never` earns its
keep rather than being a type nobody can construct. Two files use `never`; both are that.
