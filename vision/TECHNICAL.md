# Technical

One detail of the language per entry, with the outcome shown. An entry here is not always the best
way to write the thing; it is written to pin the detail down.

Read together these are meant to be enough to implement the language from.

Each is marked **done** or **not yet**, and that marker is the only thing here that refers to an
implementation.

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

## A test names itself

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

**Not yet.**

---

## Matching an enum

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

## An enum with a default

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

## A `Waiting` names the ticket its continuation is waiting on

```wac
void example() {
  Vec<Continuation> pending;
  schedule pending.push;

  Ticket<i32> input;
  Ticket<i32> r = doubled(input);

  match (pending[0]) {
    Ready { .. }: { }
    Waiting { t, call }: {
      t is input;          // true
      input.resolve(10);
      call();
    }
  }
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

  match (pending[0]) {
    Ready { .. }:     { }
    Waiting { call, .. }: { call(); }     // trap
  }
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
      match (this.pending.pop()!) {
        Ready { call }:      { await;   call(); }
        Waiting { t, call }: { await t; call(); }
      }
    }
  }
}
```

`schedule` is the first statement, so a machine that suspends again inside `call()` lands back in
`pending` rather than in whatever target was in force where it was first called: drain captures what
it starts, and what it starts is simply further along the same queue. Its own `await` hands drain's
continuation to the target above it, and the target is back in force when drain is resumed.

`await` in both arms is what makes drain yield rather than monopolise, between each continuation and
the next, exactly as the work it is draining does. A queue rather than a `Vec` because the loop both
consumes from the front and grows at the back, and because a continuation is dropped as soon as it
has run.

`t` is a `TicketBase`, so one `await` serves every kind of ticket, a fake `Sys`'s included, and
answers nothing — which is all drain wants.

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

## A nested pause does not change the caller's type

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

## An `await` is a boundary because it is written

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

**Not yet.**

---

## `pop` answers an absence rather than trapping

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

## `pop` says the same thing at a nullable element type

```wac
i32 example(Vec<Node?> v) {
  Node?? got = v.pop();

  if (got is null)  { return 0; }     // the vec was empty
  if (got! is null) { return 1; }     // it held a null
  return 2;
}
```

**Not yet.**

