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

## A nullable subject takes a `null` arm

```wac
f64? area(Shape? s) {
  return match (s) {
    Circle(r):  3.14159 * r * r,
    Square(sd): sd * sd,
    null:       null,
  };
}
```

```wac
f64? area(Shape? s) {
  return match (s) {
    Circle(r): 3.14159 * r * r,
    default:   null,              // Square and null
  };
}
```

A nullable subject is not covered until the arms name `null` or carry a `default`. Every other arm
sees a non-null subject.

**Not yet.**

---

## `matches` takes a match arm's pattern

```wac
bool missing(Result<u8[], Fault> res) {
  return Err(is NotFound) matches res;
}

bool configured(Result<Config, string> res) {
  return Ok(cfg) matches res && cfg.timeoutMs > 0;
}
```

The payload binds, `is` tests a variant inside it, and the result is an ordinary bool.

**Not yet.**

---

## `default` is arm syntax, not a pattern

```wac
bool anyShape(Shape s) {
  return default matches s;
}
```

```
error: unexpected token
  --> shapes.wac:2:10
   |
 2 |   return default matches s;
   |          ^ expected expression
```

**Not yet.**

---

## A `matches` name is scoped to its statement

```wac
f64? radius(Shape? s) {
  return Circle c matches s ? c.r : null;
}

i32 circles(Shape[] shapes, f64 min) {
  i32 n = 0;
  for (Shape s in shapes) {
    if (Circle c matches s && c.r > min) { n += 1; }
  }
  return n;
}
```

```wac
void example(Shape? s) {
  if (Circle c matches s) { c.r; }     // in scope
  else { return; }
  c.r;                                 // out of scope
}
```

Within the statement the name is readable in the right operand of `&&`, the then-arm of `?:`, the
block of an `if` or `while`, and the body and update of a `for`. It does not outlive the statement,
whether or not the match plainly succeeded.

**Not yet.**

---

## An unawaited call hands its continuation to the current target

```wac
struct Slot {
  i32 n = 0;

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

    while (Continuation c matches this.pending.pop()) {
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

**Not yet.**

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

**Not yet.**

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

**Not yet.**

---

## `coroutine` answers the machine and runs nothing

```wac
struct Slot {
  i32 n = 0;

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

## `pop` separates an empty vec from a null element

```wac
i32 example(Vec<Node?> v) {
  Node?? got = v.pop();

  if (got is null)  { return 0; }     // the vec was empty
  if (got! is null) { return 1; }     // it held a null
  return 2;
}
```

`pop` answers `T?`, so at `T = Node?` the bare `null` is the outer absence and a popped element
arrives as a present outer whatever it holds. Under flattening the two would arrive as one value,
and there is nothing the caller could write to tell them apart again.

**Not yet.**

---

## `?.` makes the member's type nullable only if it is not already

```wac
struct Addr   { string city; }
struct Person { Addr here;  Addr? home;  Addr?? prev; }

void example(Person? p) {
  auto a = p?.here;      // Addr?
  auto b = p?.home;      // Addr?     not Addr??
  auto c = p?.prev;      // Addr??    not Addr???
}
```

`?.` adds one absence, its own short circuit, and where the member is already nullable it merges into
the member's. The result is the member's type, made nullable only if it was not. The `?` type
constructor does not behave this way — `T??` is a distinct type — so a `T??` result comes only from a
`T??` member.

**Not yet.**

---

## `?.` and `??` need an operand that can be absent

```wac
void example(Person p, Person? q) {
  p?.home;              // error: `p` cannot be absent
  p.home ?? Addr();     // ok — `p.home` can
  q?.home;              // ok
}
```

A `?.` or `??` on a non-nullable operand has no case to handle: the short circuit and the default are
both unreachable. Refusing it means a reader who finds one knows the operand can be absent.

**Not yet.**

---

## `?.` stops at a `T??`

```wac
void example(Person? p) {
  p?.prev?.city;              // error: `Addr?` has no member `city`
  (p?.prev ?? null)?.city;    // string?
}
```

Stripping one `?` from an `Addr??` leaves an `Addr?`, which is not a struct and has no members. A
`T??` distinguishes two absences; collapsing them is what `?? null` does, and the chain requires it
to be written.

**Not yet.**

---

## `?? null` collapses a `T??`, and does nothing to a `T?`

```wac
void example(Person? p, Addr? one) {
  Addr?? two = p?.prev;

  two ?? null;      // Addr?  — absent and present-holding-null both arrive as null
  one ?? null;      // Addr?  — a tautology: this is `one`
}
```

The result type of `??` is the non-null form of the left operand joined with the type of the right.
For `Addr??` that is `Addr?`, which accepts the bare `null`, so the result is `Addr?`.

**Not yet.**

---

## `?.` is not an assignment target

```wac
void example(Person? p) {
  p?.home = Addr();     // error: `?.` is not an assignment target
}
```

A read has somewhere to put the absent case, because the result is nullable. A write has nowhere: the
right side would be evaluated and dropped, and the statement would succeed having done nothing.

**Not yet.**

---

## A packed type is an ordinary type

```wac
struct Pixel { u8 r; u8 g; u8 b; }

u8 brightest(Pixel p) {
  u8 best = p.r;
  if (p.g > best) { best = p.g; }
  if (p.b > best) { best = p.b; }
  return best;
}
```

```wac
void example() {
  u8?   maybe = null;
  u8?[] four  = u8?[4]();     // four nulls
}
```

`u8 i8 u16 i16` are ordinary types wherever a value can be: a local, a parameter, a field, a return,
and the answer of indexing a `u8[]`. The width is a fact about storage, so the nullable forms follow —
the value has somewhere to go.

**Not yet.**

---

## Packed arithmetic answers the packed type

```wac
void example() {
  u8 a = 200;
  u8 b = 100;
  u8 c = a + b;                     // 44 — wraps at 8 bits

  i32 wide = a as i32 + b as i32;   // 300
}
```

Nothing promotes. `i32` does not widen to `i64` under `+` either, and the `u32` a `u8` is held in is
representation rather than type.

**Not yet.**

---

## A packed type converts with `as`, in both directions

```wac
void example(i32 n, u32 m, u8[] xs) {
  u8 a = n;                // error: expected u8, got i32
  u8 b = n as u8;          // truncates
  i32 c = b;               // error: expected i32, got u8
  i32 d = b as i32;        // widens

  xs[0] = m;               // error: expected u8, got u32
  xs[0] = m as u8;         // truncates
  i32 e = xs[0];           // error: expected i32, got u8
  i32 f = xs[0] as i32;    // 255 for 0xFF — zero-extended, and an i8[] sign-extends
}
```

`spec/spec/types.md` has no implicit conversions between any types, and an ordinary type is one that
obeys that rule rather than a lenient one. An element is not a special case in either direction.

**Not yet.**

---

## A literal out of range for a packed type is refused

```wac
u8 x = 300;
```

```
error: literal out of range for its type
  --> pixel.wac:1:8
   |
 1 | u8 x = 300;
   |        ^
```

A literal takes the type expected of it when the value has a reading there. 300 has none in a `u8`.

**Not yet.**

---

## A constant condition warns unless it came from a type parameter

```wac
void example(Sys sys) {
  if (false) { sys.log("never"); }     // warning: condition is always false
  if (1 > 2) { sys.log("never"); }     // warning: condition is always false
}
```

```wac
i32 tag<T>() {
  if (typeref(T).isRef()) { return 0; }
  return 1;
}

tag<Node>();    // 0 — the second return is folded away
tag<i32>();     // 1 — the first is
```

Neither emits the branch it folded away. The second does not warn, because the condition is constant
only at an instantiation.

**Not yet.**

---

## A folded-away branch is still type-checked

```wac
i32 size<T>(T x) {
  if (typeref(T).isRef()) { return x.len(); }
  return 0;
}

size<string>("ab");    // 2
size<i32>(5);          // error: no method `len` on i32 — the branch is dead here, and checked
```

**Not yet.**

---

## Type logic is ordinary wac

```wac
typeref slot(typeref t) {
  return t.isRef() && !t.isNullable() ? t.pushNull() : t;
}

type Slot<T> = type(slot(typeref(T)));
```

`typeref` is a type and `slot` a function; neither is a second language. `typeref(T)` names a type,
`type(…)` binds the type a `typeref` names, and `pushNull` adds one level of nullability rather than
ensuring it — `?` does not flatten, so neither does the method standing for it.

**Not yet.**

---

## `type(…)` is the only expression a type position takes

```wac
struct Vec<T> {
  slot(typeref(T))[] data;        // error: expected a type
  type(slot(typeref(T)))[] data;  // ok
}
```

**Not yet.**

---

## `static_match` chooses an arm at compile time

```wac
i32 width<T>() {
  return static_match (T) {
    u32:     4,
    u64:     8,
    default: static_trap "width is defined for u32 and u64",
  };
}
```

`static_trap` is `never`, so it satisfies the arm like any other, and it fires only where that arm is
chosen.

**Not yet.**

---

## `static_if` drops the branch not taken

```wac
T get(const this, i32 i) {
  static_if (typeref(Slot<T>) == typeref(T)) {
    return this.data[i];
  } else {
    return this.data[i]!;        // not compiled where Slot<T> is T
  }
}
```

The dropped branch is checked at the definition like any generic body. Only the per-instantiation
pass skips it, so what a drop can hide is a type error that needed a `T` to see.

**Not yet.**

---

## A `static_` condition must be known statically

```wac
void example(Sys sys) {
  static_if (sys.now() > 0) { }    // error: condition is not known statically
}
```

**Not yet.**

---

## A popped slot is cleared where it can hold a reference

```wac
T fromSlot<T>(Slot<T> s) {
  static_if (typeref(Slot<T>) == typeref(T)) { return s; } else { return s!; }
}

T? pop(this) {
  if (this.n == 0) { return null; }
  this.n--;
  T out = fromSlot<T>(this.data[this.n]);
  static_if (typeref(T).isRef()) { this.data[this.n] = null; }
  return out;
}
```

```wac
Vec<Node>  a;    // Slot is Node?  — unwraps, and clears
Vec<Node?> b;    // Slot is Node?  — no unwrap, and clears
Vec<i32>   c;    // Slot is i32    — neither
```

The two conditions differ. A slot is unwrapped where `Slot<T>` is not `T`, and cleared wherever `T`
is a reference — which includes `Vec<Node?>`, where the slot type is already `T` and still holds
something worth dropping.

**Not yet.**

---

## Capacity needs no element

```wac
T zero<T>() {
  return static_match (T) {
    f32:  0.0,
    f64:  0.0,
    bool: false,
    default: 0,
  };
}

Vec<T> withCapacity(i32 capacity) {
  static_if (typeref(Slot<T>).isRef()) {
    return Vec(Slot<T>[capacity](), 0);
  } else {
    return Vec(Slot<T>[capacity](fill: zero<T>()), 0);
  }
}
```

The caller supplies nothing. `Slot<T>` is `T?` where `T` is a reference and defaults to null; where
it is not, a value is needed and none is observable, since every slot above `n` is unread before it
is written. `zero<T>()` is the value nobody reads — one literal will not do, because an integer
literal has no reading in an `f64` or a `bool`.

**Not yet.**

---

## A virtual method dispatches on the runtime type

```wac
struct Base {
  virtual i32 fire(const this) { return 0; }
}

struct Kid : Base {
  override i32 fire(const this) { return 40; }
}

void example() {
  Kid  k = Kid();
  Base b = k;

  k.fire();     // 40
  b.fire();     // 40
}
```

**Not yet.**

---

## A method that is not virtual cannot be overridden or shadowed

```wac
struct Base {
  i32 fire(const this) { return 0; }
}

struct Kid : Base {
  i32 fire(const this) { return 40; }     // and `override` here fails the same way
}
```

```
error: `Base.fire` is not virtual
  --> kid.wac:6:7
   |
 6 |   i32 fire(const this) { return 40; }
   |       ^
   = help: rename it, or mark `Base.fire` virtual
```

One object answering two ways depending on which static type reached it is what shadowing would
allow. `virtual` is the base granting the override; without it there is nothing to take.

**Not yet.**

---

## A default is an absence, not a value

```wac
void example() {
  i32    n;       // no default — unassigned until written
  Node?  p;       // null
  Node[] xs;      // empty
}
```

`T?` and `T[]` have a default because theirs means *nothing here*. Zero is a number someone might
have meant, so `i32` has none to fall back on.

**Not yet.**

---

## A field initialiser gives the field a default

```wac
struct Conn {
  i32 retries = 3;
  Socket sock = Socket.loopback();
}

Conn c;           // both run — Socket has no default of its own, Conn does
```

A field has a default where its type does or where it has an initialiser, and a struct has one where
every field does. The initialiser runs at each construction rather than once, and cannot reach the
world, since a struct body has no capability in scope to hand it.

**Not yet.**

---

## A declaration leaves the defaultless fields pending

```wac
struct Half {
  i32 retries = 3;
  Socket sock;
}

void example(Socket s) {
  Half h;
  h.sock = s;     // retries is already 3
}

void bad() {
  Half h;
  use(h);         // error: `h.sock` is never assigned
}
```

**Not yet.**

---

## Braces supply what has no default, parens supply everything

```wac
Half a = Half { sock: s };    // retries is 3
Half b = Half(3, s);          // ok
Half c = Half(s);             // error: positional construction writes every field
```

**Not yet.**

---

## A field initialiser cannot read another field

```wac
struct Bad {
  i32 a = 1;
  i32 b = this.a + 1;         // error: a field initialiser cannot read `this`
}
```

Independent expressions, so there is no order to know and no field that is half-built when another
is computed.

**Not yet.**

