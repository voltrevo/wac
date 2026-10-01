# 21 — Symbols

A symbol is a declared identity that can name a member of a type. Two symbols with the same spelling are
different symbols unless one is an import or re-export of the other. A member named by a symbol is selected
with `.[symbol]`.

## Nominal names

`symbol name;` declares a fresh nominal identity. `export` makes it importable.

```wac
// fragment — names.wac
export symbol describe;
export symbol metadata;
```

```wac
// fragment — a module importing names.wac
import { describe, describe as sameName, metadata } from "./names.wac";

struct Point {
  i32 x;
  i32 y;
  i32 [metadata];

  string [describe](const this) { return "point"; }
}

string show(const Point p) {
  p.[describe]();              // "point"
  return p.[sameName]();       // the same member
}

void update(Point p) {
  p.[metadata] = 7;            // ordinary mutable field
}
```

```wac
// expect: answers main = 12
// ---- names.wac ----
export symbol describe;
export symbol metadata;
// ---- main.wac ----
import { describe, describe as sameName, metadata } from "./names.wac";

struct Point {
  i32 x;
  i32 y;
  i32 [metadata];

  string [describe](const this) { return "point"; }
}

export i32 main() {
  Point p = Point(1, 2, 0);
  p.[metadata] = 7;
  string a = p.[describe]();
  string b = p.[sameName]();               // the same member
  return p.[metadata] + a.len();           // 7 + 5
}
```

`[§wac-symbol-member-4z5ndyy]` A field or method may be named by a symbol, written `[s]` in the declaration and
selected as `x.[s]`. Such a member is otherwise an ordinary field or method.

The symbol is the member's name. No ordinary field name acquires special meaning. Implementations are
declared on the type; importing another module cannot add one.

```wac
// fragment — unrelated.wac
export symbol describe;       // a different identity
```

```wac
// fragment — with Point as above
import { describe as unrelated } from "./unrelated.wac";

void wrong(Point p) {
  // ERROR: Point has no member named by this symbol
  // p.[unrelated]();
}
```

```wac
// expect: emits
// ---- names.wac ----
export symbol describe;
// ---- unrelated.wac ----
export symbol describe;                    // a different identity, the same spelling
// ---- main.wac ----
import { describe } from "./names.wac";
import { describe as unrelated } from "./unrelated.wac";

struct Point {
  string [describe](const this) { return "point"; }
}

export i32 main() {
  Point p = Point();

  // ERROR: Point has no member named by this symbol
  // string s = p.[unrelated]();

  return 0;
}
```

`[§wac-symbol-identity-anh5a8y]` An imported alias or re-export of a symbol is that symbol; an independent
declaration with the same spelling is a different one, and names a different member.

There is no way to add a symbol-named member to a type from outside its declaration.

## Computed selection

```wac
// fragment — inside a function taking i32 runtimeIndex
(string, i32) t = ("hello", 7);
static i32 i = 1;

t.0;                        // string
t.[i];                      // i32: selector known statically

// ERROR: selector is not statically known
// t.[runtimeIndex];
```

`.[]` is how a member is selected by something other than a written name. An integer selects a tuple member
([14](14-tuples.md)); a symbol selects a symbol-named member. Selection requires a static selector. Field
mutability and method receiver rules remain ordinary rules.

```wac
// expect: answers main = 7
symbol size;

struct Box {
  i32 [size];
}

export i32 main() {
  Box b = Box(7);
  return b.[size];
}
```

`[§wac-symbol-static-selector-pvuu3w8]` The selector in `x.[s]` must be known statically: a symbol's name, an
integer literal, or a static integer declaration.

## Construction

Symbol-named fields participate in construction like ordinary fields. Using the `Point` above:

```wac
// fragment — with Point and metadata as above
Point p = Point {
  x: 3,
  y: 4,
  [metadata]: 7,
};

Point q = Point(3, 4, 7);      // positional fields follow declaration order
```

```wac
// expect: answers main = 14
symbol metadata;

struct Point {
  i32 x;
  i32 y;
  i32 [metadata];
}

export i32 main() {
  Point p = Point { x: 3, y: 4, [metadata]: 7 };
  Point q = Point(3, 4, 7);
  return p.[metadata] + q.[metadata];
}
```

`[§wac-symbol-construction-uwbvysu]` A symbol-named field is supplied in named construction as `[s]: value`, and
positionally in its declaration order.

## Inheritance and overriding

```wac
// expect: answers main = 5
symbol describe;

struct Base {
  virtual string [describe](const this) { return "base"; }
}

struct Child : Base {
  override string [describe](const this) { return "child"; }
}

export i32 main() {
  Base b = Child();
  return b.[describe]().len();             // "child"
}
```

`[§wac-symbol-override-3jvj9cg]` A symbol-named method follows the ordinary `virtual` and `override` rules: the same
symbol identifies the inherited method, and a different symbol with identical spelling cannot override it.

Field collisions follow ordinary field rules too.

## Members accessed through the type

```wac
// fragment
symbol size;
symbol make;

struct Foo {
  static i32 [size] = 7;
  Foo [make]() { return Foo(); }
}

void example() {
  i32 n = Foo.[size];
  Foo value = Foo.[make]();
}
```

`static` binds an otherwise runtime value at compile time. Static symbol fields follow
[27](../4-static/27-static-declarations.md): compile-time initialisation, const access, and exclusion from
instance construction. Being attached to the type is a consequence of that binding.

A method belongs to the type by omitting the `this` parameter; it does not use `static`. Such a method may run
at runtime or during static evaluation. Literal conversion specifically requires static evaluation
([09](09-numeric-literals.md)).

```wac
// expect: answers main = 7
symbol size;
symbol make;

struct Foo {
  static i32 [size] = 7;
  Foo [make]() { return Foo(); }
}

export i32 main() {
  Foo value = Foo.[make]();
  return Foo.[size];
}
```

`[§wac-symbol-type-member-skxmsih]` A symbol-named static field or receiverless method is reached through the type
as `T.[s]`.

## Scope

Symbols here are declared identities used for static member selection. Runtime symbol values, runtime
comparison, and runtime generation of fresh symbols are not part of the language. Neither are trait
declarations or external implementation blocks. `const` alone does not establish static knowledge.

The symbols the language itself gives meaning to — the operators, `toString`, `toNode`, `fromNumber` — are
exported by `core` ([37](../7-library/37-core.md)) and used by
[22](../3-expressions/22-operators.md), [23](../3-expressions/23-interpolation-and-markup.md) and
[09](09-numeric-literals.md).
