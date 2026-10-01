# 27 — Static declarations

`static` requires compile-time evaluation of the initialiser and gives the binding const semantics, including
deep-const access. `const` alone does not require compile-time evaluation ([17](../2-types/17-const.md)).

A static declaration may stand at module scope, in a function, or in a struct. In each place it is evaluated
once — per enclosing generic instantiation — and the value is shared by every use.

## Module scope

```wac
// fragment
static i32 SIZE = square(8); // 64

i32 square(i32 x) { return x * x; }
```

Module-level variables require `static`. Mutable module state is unavailable
([02](../1-programs/02-modules-and-imports.md)).

```wac
// expect: answers twoBlocks = 128
// expect: answers squareOfEight = 64
static i32 BLOCK = 64;
static i32 TWO_BLOCKS = BLOCK * 2;         // a static may read another
static i32 SIZE = square(8);               // and call a function

i32 square(i32 x) { return x * x; }

// ERROR: a module-level variable must be static
// i32 counter = 0;

export i32 twoBlocks() { return TWO_BLOCKS; }
export i32 squareOfEight() { return SIZE; }
```

`[§wac-modconst-h3kq8wn]` A static declaration is its value wherever it is read: `BLOCK` reads as `64` and
`TWO_BLOCKS` as `128`.

`[§wac-static-call-66kaqx5]` A static initialiser may call functions; the call runs at compile time
([28](28-static-evaluation.md)).

```wac
// expect: answers limit = 100
// ---- limits.wac ----
static i32 PRIVATE = 1;
export static i32 LIMIT = 100 * PRIVATE;
// ---- main.wac ----
import { LIMIT } from "./limits.wac";

// ERROR: limits.wac does not export 'PRIVATE'
// import { PRIVATE } from "./limits.wac";

export i32 limit() { return LIMIT; }
```

`[§wac-modconst-import-p7fm2wj]` An exported static declaration can be imported by name; one that is not
exported cannot.

## Function scope and ordering

```wac
// fragment
i32 example(i32 input) {
  static i32 TWO = ONE + ONE; // 2; forward reference is allowed.
  static i32 ONE = 1;

  const i32 copy = input; // Immutable runtime value.
  return TWO + copy;
}
```

```wac
// fragment
void invalid(i32 input) {
  static i32 bad = input; // ERROR: requires a runtime value.

  i32 two = one + one;   // ERROR: ordinary local before declaration.
  i32 one = 1;
}
```

Static declarations are available throughout their enclosing scope. Their dependency order determines
evaluation order; ordinary locals retain statement ordering. Placing a static declaration in a function does
not make its initialisation depend on runtime execution reaching that statement.

```wac
// expect: answers example(5) = 7
export i32 example(i32 input) {
  static i32 TWO = ONE + ONE;              // a forward reference within the scope
  static i32 ONE = 1;

  const i32 copy = input;                  // an immutable runtime value

  // ERROR: a static initialiser cannot read the runtime value 'input'
  // static i32 bad = input;

  // ERROR: 'one' is used before it is declared
  // i32 two = one + one;
  // i32 one = 1;

  return TWO + copy;
}
```

`[§wac-static-local-mpg3rw7]` A static declaration in a function is visible throughout its enclosing block,
before and after its declaration, and is evaluated by dependency order rather than when execution reaches
it.

`[§wac-static-no-runtime-4yksuu4]` A static initialiser may not read a runtime value: a parameter, an ordinary local,
or anything computed from one.

## Struct scope

```wac
// fragment
struct Foo {
  static i32 x = calculateX();
  i32 y;
}

i32 calculateX() { return 8; }

void example() {
  static i32 offset = Foo.x + 1;
  Foo a = Foo(7); // Only y is an instance field.

  // ERROR: Foo.x = 9;
}
```

`static` binds the field value at compile time rather than per runtime instance. As a consequence, `Foo.x`
belongs to the type and does not participate in instance construction. Type attachment is not a separate
meaning of `static`.

```wac
// expect: answers offsetPlusY = 16
struct Foo {
  static i32 x = calculateX();
  i32 y;
}

i32 calculateX() { return 8; }

export i32 offsetPlusY() {
  static i32 offset = Foo.x + 1;           // 9
  Foo a = Foo(7);                          // only y is an instance field

  // ERROR: a static field is const
  // Foo.x = 9;

  return offset + a.y;
}
```

`[§wac-static-field-we2jbmc]` A static field is read as `T.name`, is not an instance field, and takes no part in
construction.

A static field may be named by a symbol: `static i32 [size] = 7;`, read as `Foo.[size]`
([21](../2-types/21-symbols.md)). A method belongs to the type by omitting its receiver, not by being marked
`static` ([12](../2-types/12-structs.md)).

## Static values are const, deeply

```wac
// expect: answers second = 2
static i32[] T = [1, 2];

export i32 second() {
  // ERROR: cannot write through a const reference
  // T[0] = 9;

  // ERROR: cannot write through a const reference
  // T[1] += 1;

  return T[1];                             // reading is fine
}
```

`[§wac-modconst-array-const-w2mk9fj]` Element writes, compound assignment and `++` through a static array are
refused.

## Allocation identity and generic instantiation

```wac
// fragment
struct Box { i32 value; }

const Box shared() {
  static Box value = Box(1);
  return value;
}

void example() {
  const Box a = shared();
  const Box b = shared();
  // a is b: true; calls share the same static value.
}
```

Each static declaration is evaluated once per enclosing generic instantiation, not once per runtime call or
instance. Static locals in generic functions and static fields in generic structs follow the same rule.

```wac
// fragment
struct Cache<T> {
  static Box marker = Box(1);
}

struct Box { i32 value; }

// Cache<i32>.marker is Cache<i32>.marker: true
// Cache<i32>.marker is Cache<string>.marker: false
```

```wac
// fragment
static Box A = build();
static Box B = build();
static Box C = A;

struct Box { i32 value; }
Box build() { return Box(1); }

// A is B: false
// A is C: true
```

Materialising static values preserves observable allocation identity and aliasing. Evaluation caching must not
merge distinct allocations.

```wac
// expect: answers oneValueForEveryCall = true
// expect: answers onePerInstantiation = true
// expect: answers allocationsStayDistinct = true
struct Box { i32 value; }

struct Cache<T> {
  static Box marker = Box(1);
}

static Box A = build();
static Box B = build();
static Box C = A;

Box build() { return Box(1); }

const Box shared() {
  static Box value = Box(1);
  return value;
}

export bool oneValueForEveryCall() { return shared() is shared(); }

export bool onePerInstantiation() {
  return Cache<i32>.marker is Cache<i32>.marker && Cache<i32>.marker is not Cache<string>.marker;
}

export bool allocationsStayDistinct() { return A is not B && A is C; }
```

`[§wac-modconst-ref-9jvq2mt]` A static declaration of reference type is one value, built once: every read of
it, from any call, is the same object.

`[§wac-static-per-instantiation-79mu9di]` A static declaration in a generic is one value per instantiation of its
enclosing generic.

`[§wac-static-identity-preserved-iiebbsr]` Distinct allocations made by static initialisers stay distinct, and a
static initialised from another static is that same object.

`[§wac-modconst-array-t8kn4wq]` A static array is one array built once and shared by every use, not rebuilt
where it is read — which is the reason to declare a lookup table static rather than return a fresh one from a
function.

## Shared rules

All three declaration locations use ordinary static evaluation ([28](28-static-evaluation.md)) and the same
dependency and cycle rules ([29](29-static-dependencies.md)). Locals can supply static selectors:

```wac
// fragment
void example() {
  (string, i32) tuple = ("hello", 7);
  static i32 i = 1;
  tuple.[i]; // i32
}
```

A static declaration that nothing retained reaches is not evaluated ([05](../1-programs/05-reachability.md)).
One that is retained must evaluate: a trap, a cycle, or an unfinished evaluation is an error.
