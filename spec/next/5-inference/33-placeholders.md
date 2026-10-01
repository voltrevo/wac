# 33 — Placeholders: `auto` and bare `union`

A placeholder stands where a type would be written and is inferred. `auto` uses [widening](32-widening.md);
bare `union` collects alternatives. Infer candidates from eligible origins, then check all uses. Do not solve for
a type that makes every use succeed.

## Different collection operations and scopes

```wac
// fragment — inside a function, with makeRect, makeCircle and a Vec in scope
auto a = cond ? makeRect() : makeCircle(); // Shape
union b = cond ? makeRect() : makeCircle(); // union<Rect, Circle>

auto n = 7; // ERROR: no numeric default; later statements cannot rescue it.

Vec<union> values;
values.push(1 as i32);
values.push("hello"); // One Vec<union<i32, string>> throughout execution.
```

`auto` uses variadic widening. Local `auto` uses its initializer/constructor and relevant generic instantiation,
not sibling statements. Return `auto` gathers return expressions. Bare `union` gathers origins throughout its
enclosing scope, including nested blocks and the generic instantiation receiving the placeholder. It collects
alternatives and normalises them; it does not use ordinary widening to reject incompatible alternatives. Neither
placeholder changes type at runtime.

```wac
// expect: answers main = 2
struct Shape { i32 x; }
struct Rect : Shape { i32 w; }
struct Circle : Shape { i32 r; }

export i32 main() {
  bool cond = true;
  auto a = cond ? Rect(1, 2) : Circle(1, 3);    // Shape
  union b = cond ? Rect(1, 2) : Circle(1, 3);   // union<Rect, Circle>

  // ERROR: unresolved numeric type — later statements cannot rescue it
  // auto n = 7;

  return match (b) {
    Rect:   a.x + 1,
    Circle: 0,
  };
}
```

`[§wac-auto-local-59gczx4]` An `auto` local's type is the widening of its initialiser, and nothing else: later
statements contribute nothing.

`[§wac-union-placeholder-3fu73k3]` A bare `union` gathers every value that flows into it in its scope — nested blocks
included — and its type is the normalised union of their types, fixed for the whole scope.

All methods of an instantiation participate, not just called methods. Existing two-pass generic checking applies;
only selected static branches contribute at instantiation. Runtime branch elimination does not filter
contributions.

```wac
// fragment
void example(bool cond) {
  union value = 1 as i32;
  if (cond) {
    value = "hello"; // Nested blocks contribute to the same placeholder.
  }
  // value has union<i32, string> throughout this scope, not a changing type.
}
```

```wac
// expect: answers main = 1
export i32 main() {
  bool cond = true;
  union value = 1 as i32;
  if (cond) {
    value = "hello";                       // contributes to the same placeholder
  }
  return match (value) {
    i32:    0,
    string: 1,
  };
}
```

```wac
// fragment
struct Seed<T> {
  void accept(T value) {}
  void supply() { Seed.accept("hello"); }
}

void example() {
  Seed<auto> seed; // T = string even though supply is never called.
}
```

```wac
// fragment
struct Sink<T> { void accept(T value) {} }

void example() {
  Sink<auto> sink; // No origins here: candidate T = never.
  sink.accept(1 as i32); // ERROR: sibling call cannot infer T for auto.
  // Sink<union> would collect this argument and resolve T to union<i32>.
}
```

`[§wac-placeholder-all-methods-9p9sr4j]` A placeholder type argument receives contributions from every method of its
instantiation, called or not.

## Origins contribute; consumers impose checks

```wac
// fragment
union value = makeRect();
takeShape(value); // Checks the candidate union<Rect>; does not contribute Shape.

void example(union value) {
  takeRect(value);
  takeShape(value);
} // No origins: union<never>. Callers do not expand this signature.
```

An actual argument supplied to a placeholder is an origin:

```wac
// fragment
struct Sink<T> { void accept(T value) {} }

void example() {
  Sink<union> sink;
  sink.accept(1 as i32);
  sink.accept("hello"); // T = union<i32, string>, despite the empty method body.
}
```

`[§wac-placeholder-origins-nfdtwjs]` What flows into a placeholder — an initialiser, an assigned value, an argument it
receives — contributes to it. What a placeholder's value flows into only checks it.

Function inputs reverse the direction of value flow:

```wac
// fragment
fn<void(union)> f = takeI32;
f("hello");
// Infer union<string> from the actual argument.
// ERROR: takeI32 cannot implement that concrete signature.

fn<union()> g = makeI32; // Producing i32 contributes i32.

void visitInts(fn<void(i32)> callback) { /* ... */ }
fn<void(fn<void(union)>)> visit = visitInts;
// The callback can receive i32: an origin for the inner placeholder.
```

Signatures describe possible flow; bodies need not actually perform the action. A function receiving mutable
`Cell<i32>` may write `i32` into the supplied cell, so that write capability is an origin for `Cell<union>`.
Ordinary consumers of a value do not contribute merely by accepting it. Invariant storage positions require
compatibility in both directions; const does not grant new variance.

```wac
// fragment
struct Cell<T> { T value; }
void replace(Cell<i32> cell) {} // Allowed to write i32, even with an empty body.

void example() {
  Cell<union> cell = Cell<union>(1 as i32);
  replace(cell); // The signature supplies an i32 origin through writable storage.
}
```

The two explicitly written unions in this example are separate placeholders; both resolve to `union<i32>`. The
initializer already supplies `i32` so no uninitialised storage is needed to illustrate the signature's additional
contribution.

User-defined generics must be considered through their fields and methods, not by blindly equating corresponding
type arguments in whole-object assignments. A phantom parameter has no origins merely because it appears in the
spelling. Candidate inference does not invent conversions between concrete instantiations.

```wac
// fragment
struct Phantom<T> {}

void example() {
  Phantom<union> unused; // T has no origins: union<never>.
}
```

## Placeholder identity and defaults

```wac
// fragment
struct Pair<T> { T first; T second; }
Pair<union> p = Pair<union>(1 as i32, "hello");
// Within each Pair instantiation, one placeholder is shared by both fields.
// Both fields have union<i32, string>.
```

Two separately written placeholders are independent. Substitution preserves identity; each use of a generic
default creates a fresh placeholder at that use. `Result<T, E = union>` therefore makes `Result<T>` mean
`Result<T, union>` in that position. `Result` has no special inference rule.

```wac
// fragment
struct Separate<A, B> { A first; B second; }

void example() {
  Separate<union, union> p = Separate<union, union>(1 as i32, "hello");
  // A = union<i32>; B = union<string>. The slots are independent.
}
```

```wac
// fragment
struct Sink<Tag, T = union> { void accept(T value) {} }

void example() {
  Sink<i32> numbers;
  Sink<i32> words;
  numbers.accept(1 as i32); // numbers: Sink<i32, union<i32>>
  words.accept("hello");   // words: Sink<i32, union<string>>
}
```

Here both uses supply `Tag = i32` and omit `T`. Each omission creates its own placeholder; the default is not
shared by all `Sink` declarations.

`[§wac-placeholder-identity-gvfvw8c]` One written placeholder is one placeholder wherever substitution carries it;
two written placeholders, and each use of a defaulted parameter, are independent.

```wac
// fragment
union choose(bool cond) {
  if (cond) { return 1 as i32; }
  return "hello";
} // One concrete result: union<i32, string>.

void caller() {
  union value = choose(true);
  value = false; // Only the local union adds bool; choose's signature is unchanged.
}
```

A `union` in a function's parameter or return position resolves in that function (and per explicit generic
instantiation). It does not create implicit generic instantiations based on callers. No origins yields
`union<never>`.

`[§wac-placeholder-signature-d8s4rah]` A placeholder in a function's signature is resolved within that function, once.
Callers do not contribute to it.

## Nested placeholders

```wac
// fragment
auto[] a = [makeRect(), makeCircle()]; // Shape[]
union[] b = [makeRect(), makeCircle()]; // union<Rect, Circle>[]
union<auto> c = cond ? makeRect() : makeCircle(); // union<Shape>
```

`union<auto>` infers one ordinary `auto` candidate, then wraps and normalises it. It does not become a scope-wide
bare-union collector. `Pair<auto>` sees its initializer/constructor and instantiation, including every method,
but no direct contributions from sibling statements.

Indirect dependencies are allowed: if a sibling statement contributes to a bare union `A`, and an eligible
instantiation dependency supplies `A` to auto `B`, `B` sees `A`'s resulting contribution. This does not broaden
`B`'s direct inference scope.

```wac
// fragment
struct Flow<A, B> {
  void acceptA(A value) {}
  void acceptB(B value) {}
  void forward(A value) { Flow.acceptB(value); }
  void seed() { Flow.acceptB(makeRect()); }
}

void example() {
  Flow<union, auto> flow;
  flow.acceptA(makeRect());
  flow.acceptA(makeCircle());
  // A collects union<Rect, Circle> from sibling calls.
  // B sees A through forward, plus Rect through seed.
  // B = widen(union<Rect, Circle>, Rect) = union<Rect, Circle>.
}
```

`B` receives no direct contribution from sibling calls. It depends on `A` through an instantiated method, and
therefore sees `A`'s collected type. All methods are checked against the resulting candidates.

## Route before collecting

Concrete alternatives absorb inputs they already accept. Remaining contributions may enter a uniquely matching
unresolved alternative:

```wac
// fragment
union<string, auto> x = cond ? "hello" : makeI32();
// string accepts the first alternative; auto receives i32.
```

Reject when a contribution could enter multiple unresolved alternatives. Do not try allocations, broadcast to all
alternatives, or rely on compilation order.

```wac
// fragment
struct Box<T> { T value; }

void example() {
  union<Box<auto>, Box<union>> x = Box<i32>(7);
  // ERROR: ambiguous routing of the i32 contribution.
}
```

When alternatives are concrete, use the most-specific-compatible rule in [32](32-widening.md). Numeric literal
spelling and range do not resolve ambiguity.

`[§wac-placeholder-routing-jtuvxya]` A contribution enters a concrete alternative that accepts it; otherwise the unique
unresolved alternative it could enter. One that could enter more than one is refused.

## Infer, then check

Every initializer, assignment, call and instantiated method is checked against the resulting concrete candidates.
Scope-wide collection is not a guarantee that all operations on the collected type succeed. Neither a callable's
destinations nor a failed check trigger another candidate search.

```wac
// fragment
fn<void(union)> f = takeI32;
f(7); // ERROR: literal supplies no concrete origin; no i32 inferred from takeI32.
// f(7 as i32) would supply that origin.
```

`[§wac-placeholder-then-check-d3dqday]` Placeholders are resolved from their contributions first, and then every use is
checked against the result. A failed check does not revise a placeholder.

Recursive dependencies and empty `auto` candidates are defined in [34](34-recursive-inference.md). Union-only
cycles and recursive type formation are defined in [18](../2-types/18-unions.md).
