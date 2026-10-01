# 01 — Names and identity

A name belongs to the file that writes it. The thing it names has one identity everywhere.

Every rule in this chapter follows from those two sentences. A file resolves each name it writes
against what that file declares and imports — never against a program-wide table of spellings — so
two files may use one spelling for two things, and one thing may have a different spelling in every
file that names it.

Things that have identity: functions, structs, enums and their variants, static declarations,
symbols ([21](../2-types/21-symbols.md)), namespaces ([03](03-namespaces.md)), modules
([02](02-modules-and-imports.md)), and generic instantiations ([19](../2-types/19-generics.md)).
Allocations have identity too, which is what `is` compares; that is
[12](../2-types/12-structs.md)'s subject.

## A name is resolved in the file that writes it

```wac
// expect: answers bothHelpers = 111222
// ---- a.wac ----
i32 helper() { return 111; }
export i32 fromA() { return helper(); }
// ---- b.wac ----
i32 helper() { return 222; }
export i32 fromB() { return helper(); }
// ---- main.wac ----
import { fromA } from "./a.wac";
import { fromB } from "./b.wac";

export i32 bothHelpers() { return fromA() * 1000 + fromB(); }
```

`[§wac-private-same-name-69wbdid]` Two files may each declare a private name with the same spelling.
They are two declarations, and each file's uses of the name reach its own.

```wac
// expect: answers threeComputes(5) = 31
// ---- utils_a.wac ----
export i32 compute(i32 x) { return x + 1; }
// ---- utils_b.wac ----
export i32 compute(i32 x) { return x * 2; }
// ---- main.wac ----
import { compute as computeA } from "./utils_a.wac";
import { compute as computeB } from "./utils_b.wac";

i32 compute(i32 x) { return x * 3; }

export i32 threeComputes(i32 x) {
  return computeA(x) + computeB(x) + compute(x);   // for 5: 6 + 10 + 15
}
```

`[§wac-rename-imp-w4fn9k2]` Two imported functions of the same name are distinct once renamed:
`computeA(5)` is 6 and `computeB(5)` is 10.

`[§wac-imp-coexist-p8km2v6]` A name declared in one file does not collide with the same name in a
file it merely imports from: `main.wac`'s own `compute` coexists with both.

A function value is a use like any other, and reaches the function the writing file means:

```wac
// expect: answers twoHelpers = 12
// ---- a.wac ----
i32 helper() { return 10; }
export fn<i32()> pickA() {
  fn<i32()> f = helper;           // a.wac's helper
  return f;
}
// ---- main.wac ----
import { pickA } from "./a.wac";

i32 helper() { return 2; }

export i32 twoHelpers() {
  fn<i32()> f = pickA();
  fn<i32()> g = helper;           // main.wac's helper
  return f() + g();               // 10 + 2
}
```

`[§wac-funcref-scope-9qh2vtm]` A function taken as a value refers to the one named in the file that
takes it, whatever else in the program shares its name.

## One spelling, two things

Structs are no different. Two files may each declare a `Box`, and each keeps its own fields and
methods:

```wac
// expect: answers fieldOrders = 103
// ---- a.wac ----
export struct Box { i32 x; i32 y; }
// ---- b.wac ----
export struct Box { i32 y; i32 x; }      // the same name, the other field order
// ---- main.wac ----
import { Box as BoxA } from "./a.wac";
import { Box as BoxB } from "./b.wac";

export i32 fieldOrders() {
  BoxA a = BoxA(1, 2);                   // a.x = 1, a.y = 2
  BoxB b = BoxB(3, 4);                   // b.y = 3, b.x = 4
  return a.x * 100 + b.y;
}
```

`[§wac-samename-struct-k7fn3wq]` Same-named structs in different files are different types: each
keeps its own field layout and methods.

The case that matters in practice is the one where the reader sees only one of them, because the
other arrives through a function:

```wac
// expect: answers boxes = 15
// ---- a.wac ----
export struct Box { i32 v; }
export Box makeA() { return Box(1); }
// ---- b.wac ----
export struct Box { i32 x; i32 y; }
export i32 sumB() {
  Box b = Box(2, 3);
  return b.x + b.y;
}
// ---- main.wac ----
import { Box, makeA } from "./a.wac";
import { sumB } from "./b.wac";

export i32 boxes() {
  Box a = makeA();                       // a.wac's Box; main.wac never names b.wac's
  return a.v * 10 + sumB();
}
```

`[§wac-samename-struct-4jhq7wn]` Two same-named types stay apart however they are reached, including
when a file names one and the other arrives transitively — and when one of them is a struct and the
other an enum.

Nothing about this depends on file names being unique:

```wac
// expect: answers pairs = 12
// ---- left/util.wac ----
export struct Pair { i32 a; i32 b; }
export i32 left() {
  Pair p = Pair(1, 2);
  return p.a + p.b;                      // 3
}
// ---- right/util.wac ----
export struct Pair { i32 b; i32 a; }
export i32 right() {
  Pair p = Pair(4, 5);                   // b = 4, a = 5
  return p.a + p.b;                      // 9
}
// ---- main.wac ----
import { left } from "./left/util.wac";
import { right } from "./right/util.wac";

export i32 pairs() { return left() + right(); }
```

`[§wac-samename-stem-3xr7ktn]` Two files with the same name in different directories declare
different things. The identity of a declaration is the file it is written in, not any name derived
from it.

## Two spellings, one thing

The converse: an alias is a new name, not a new thing.

```wac
// expect: answers viaAlias = 7
// ---- lib.wac ----
export struct Box {
  i32 v;
  i32 get(const this) { return this.v; }
}
// ---- main.wac ----
import { Box as BoxA } from "./lib.wac";

export i32 viaAlias() {
  BoxA b = BoxA(7);
  fn<i32(BoxA)> f = BoxA.get;            // BoxA is lib.wac's Box, so the signature matches
  return f(b);
}
```

```wac
// expect: answers aliasSum = 3
// ---- p.wac ----
export struct Point { i32 x; i32 y; }
// ---- main.wac ----
import { Point, Point as P } from "./p.wac";

P widen(Point p) { return p; }           // one type, two names

export i32 aliasSum() {
  Point a = Point(1, 2);
  P b = widen(a);
  return b.x + b.y;
}
```

`[§wac-alias-same-type-j3wq8kf]` Two type names are the same type exactly when they resolve to the
same declaration. An alias and the name it renames are interchangeable in every type position.

The same holds for generic instantiations — `Box<P>` and `Box<Point>` above would be one
instantiation (`§wac-generic-instantiation-identity-6pnq4wj`, in
[19](../2-types/19-generics.md)) — and for symbols, where an imported alias names the same member and
an independent declaration with the same spelling does not ([21](../2-types/21-symbols.md)).

## A scope holds each name once

Within one scope, two declarations may not share a name, whatever they are:

```wac
// expect: emits
export struct Point { i32 x; }
export i32 area() { return 1; }

// ERROR: duplicate function 'area'
// export i32 area() { return 2; }

// ERROR: duplicate struct 'Point'
// export struct Point { i32 y; }

// ERROR: 'Point' is already declared as a struct
// export i32 Point() { return 1; }
```

`[§wac-dup-func-ohfg5bi]` Two functions with the same name are refused.

`[§wac-dup-struct-spu3kml]` Two structs with the same name are refused.

`[§wac-dup-kind-9h0mrly]` A function and a struct with the same name are refused.

```wac
// expect: emits
export static i32 LIMIT = 10;
export enum Shape { Circle(f64 r), Square(f64 side) }
export symbol describe;
export namespace geometry {
  export i32 origin() { return 0; }
}

// ERROR: 'LIMIT' is already declared
// export i32 LIMIT() { return 1; }

// ERROR: 'Shape' is already declared
// export struct Shape { i32 x; }

// ERROR: 'describe' is already declared
// export static i32 describe = 1;

// ERROR: 'geometry' is already declared
// export namespace geometry { export i32 other() { return 1; } }
```

`[§wac-dup-any-kind-ctguh44]` Any two declarations at the top level of one file are refused if they
share a name, whatever their kinds. In particular a namespace cannot be declared twice to add members
to it ([03](03-namespaces.md)).

Inside a struct, fields and methods share one scope, and a function's parameters share another:

```wac
// expect: emits
export struct Holder {
  i32 v;
  i32 get(const this) { return this.v; }

  // ERROR: duplicate field 'v'
  // i32 v;

  // ERROR: duplicate method 'get'
  // i32 get(const this) { return 1; }

  // ERROR: 'v' is already declared as a field
  // i32 v(const this) { return 0; }

  // ERROR: duplicate parameter 'a'
  // i32 pair(const this, i32 a, i32 a) { return a; }
}

// ERROR: duplicate parameter 'a'
// export i32 twice(i32 a, i32 a) { return a; }
```

`[§wac-dup-field-oa60dpa]` Two fields with the same name are refused.

`[§wac-dup-method-4jv9jst]` Two methods with the same name are refused.

`[§wac-dup-field-method-dnwlmiz]` A field and a method with the same name are refused.

`[§wac-dup-param-4tnq8vx]` Two parameters with the same name are refused, in a function and in a
method alike.

## An import declares a name in the importing file

An imported name occupies the importing file's top-level scope like any declaration, so it collides
like one — and `as` is how a collision is resolved:

```wac
// expect: answers collisions = 13
// ---- a.wac ----
export i32 foo() { return 1; }
export struct Point { i32 x; }
// ---- b.wac ----
export i32 foo() { return 2; }
export struct Point { i32 x; i32 y; }
// ---- main.wac ----
import { foo, Point } from "./a.wac";
import { foo as fooB, Point as PointB } from "./b.wac";

// ERROR: 'foo' is already imported
// import { foo } from "./b.wac";

// ERROR: 'foo' is already imported
// export i32 foo() { return 3; }

export i32 collisions() {
  Point p = Point(10);
  PointB q = PointB(1, 2);
  return p.x + q.y + fooB() - foo();     // 10 + 2 + 2 - 1
}
```

`[§wac-dup-import-local-4fadlvg]` An import and a local declaration with the same name are refused.

`[§wac-dup-import-vqn4100]` Two imports with the same name are refused.

`[§wac-rename-pohglv4]` Renaming one import with `as` resolves the collision.

`[§wac-rename-type-h0a08xz]` The same is true of types.

Importing one member of a namespace binds the member's own name — `import { operators.add }` binds
`add` — and that name collides by the same rules ([03](03-namespaces.md)).

## Scopes nest, and an inner name may shadow an outer one

```wac
// expect: answers outer = 1
export i32 outer() {
  i32 x = 1;
  {
    i32 x = 2;                           // a separate variable
    x = 3;                               // the inner one
  }
  return x;                              // 1
}
```

`[§wac-shadow-8u8qh2j]` A block may declare a name its enclosing scope already has. The inner binding
is a separate variable, and the outer one is untouched.

```wac
// expect: answers shadowParam(7) = 7
// expect: answers loopShadow = 99
export i32 shadowParam(i32 x) {
  { i32 x = 99; }
  return x;                              // the parameter
}

export i32 loopShadow() {
  i32 i = 99;
  for (i32 i = 0; i < 10; i++) { }
  return i;                              // the outer i
}
```

`[§wac-shadow-param-7apc0wt]` A local may shadow a parameter; the parameter is unchanged once the
shadowing block ends.

`[§wac-shadow-loop-vwe8gfz]` A `for` initialiser may shadow a local of the enclosing scope, which is
unchanged after the loop.

Shadowing works because the inner name expires:

```wac
// expect: emits
export void expired() {
  { i32 q = 1; }
  for (i32 i = 0; i < 3; i++) { }

  // ERROR: undefined name 'q'
  // i32 r = q;

  // ERROR: undefined name 'i'
  // i32 s = i;
}
```

`[§wac-block-scope-k3zqm41]` A name declared inside a block, or by a `for` initialiser, is not in
scope after that statement ends.

A local or parameter shadows a top-level name in the same way — including a function, when the local
is itself something that can be called:

```wac
// expect: answers pumpCount = 2
export i32 write(u8[] bytes) { return 99; }

i32 pump(fn<i32(u8[])> write) {
  return write([1, 2]);                  // the parameter, not the function above
}

i32 count(u8[] bytes) { return bytes.len(); }

export i32 pumpCount() { return pump(count); }
```

`[§wac-param-shadows-func-5nkq2wp]` A bare name in call position resolves to a local or parameter of
function type before any top-level function.

A local that cannot be called does not hide a function from a call:

```wac
// expect: answers resolution(100) = 6
i32 twice(i32 x) { return x * 2; }

export i32 resolution(i32 twice) {
  return twice(3);                       // the function: the parameter is an i32
}
```

`[§wac-call-skips-noncallable-local-shut2xc]` In call position, a local or parameter whose type is not a
function type is passed over, and the name resolves to the function.

## A type name must be in scope where it is written

Every type name a file writes must be declared or imported by that file. A type that reaches a file
only as the result of a call has no name there:

```wac
// expect: answers matchWithoutImport = 1
// ---- k.wac ----
export enum K { A(i32 n), B }
export K mk() { return K.A(1); }
// ---- main.wac ----
import { mk } from "./k.wac";            // K is not imported

export i32 matchWithoutImport() {
  // ERROR: undefined type 'K'
  // K k = mk();

  // ERROR: undefined type 'A'
  // if (mk() is A) { return 1; }

  return match (mk()) {                  // a match needs no import
    A(n): n,
    B:    0,
  };
}
```

`[§wac-type-name-scope-8vqk3mn]` Writing a type, enum or variant name that the file neither declares
nor imports is refused at the place it is written. The fix is the import — `import { K, A } from
"./k.wac"` — and a variant imports like any other name.

A `match` arm needs no import because it resolves its variants through the type of the value being
matched, not through the file's scope ([25](../3-expressions/25-control-flow.md)).

## Keywords are not names

```wac
// expect: answers go(4) = 4
// ERROR: 'match' is a keyword and cannot be a parameter name
// export i32 echo(i32 match) { return match; }

// ERROR: 'match' is a keyword and cannot be a name
// export static i32 match = 1;

// ERROR: 'match' is a keyword and cannot be a struct name
// export struct match { i32 x; }

export i32 go(i32 @"match") { return @"match"; }    // a verbatim name, below
```

`[§wac-keyword-name-8wnq4kp]` A keyword in a name position is refused, and the diagnostic names the
keyword and points at it.

That wording is part of the rule. A keyword where a name was expected is easy to read as some other
syntax error, reported somewhere else; the error has to be about the name. [Appendix
A](../appendices/A-grammar.md) lists the keywords, and the words that are keywords only in one
position.

## Verbatim names

`@"…"` writes a name verbatim. It may hold anything, including a keyword, a hyphen or a space:

```wac
// expect: answers double(5) = 10
// expect: answers pick(1, 3) = 4
export i32 double(i32 @"n") {                   // may warn: `@"n"` is just `n`
  return n * 2;
}

export i32 pick(i32 @"for", i32 @"data-size") {
  return @"for" + @"data-size";
}
```

`[§wac-verbatim-name-jzwznre]` `@"…"` is a name whose spelling is the quoted text, which may be any
text, including a keyword.

`[§wac-verbatim-same-name-axnpc5w]` A verbatim name whose text is an ordinary name is that name:
`@"n"` and `n` are one binding. An implementation may warn that the quoting is unnecessary.

A verbatim name is how a markup attribute reaches a parameter that a keyword or a hyphen would
otherwise forbid ([23](../3-expressions/23-interpolation-and-markup.md)), and how a test names itself
with a sentence ([47](../8-tooling/47-testing.md)):

```wac
// fragment — a test file
export void @"test: an empty read returns End"() {
  // …
}
```

## `_` binds nothing

`_` may be written wherever a name is bound — a local, a parameter, a pattern — and may be written
more than once, because it names nothing. Reading it is an error:

```wac
// expect: answers first(1, 2, 3) = 1
// expect: answers discards = 1
i32 sideEffect() { return 3; }

export i32 first(i32 a, i32 _, i32 _) { return a; }

export i32 discards() {
  i32 _ = sideEffect();                  // call it, discard the answer
  i32 _ = sideEffect();                  // again: no collision, nothing is named

  // ERROR: `_` cannot be read
  // return _;

  return first(1, 2, 3);
}
```

`[§wac-underscore-repeats-3bce8w9]` `_` may be bound any number of times in one scope, and binds
nothing.

`[§wac-underscore-unreadable-jqvkb32]` Reading `_` is refused.

Discarding a value is a decision, and `_` puts it where the value would otherwise have gone. Because
`_` can never be read, it cannot be mistaken for a name that can — which keeps it unambiguous in a
pattern, where a bare word could otherwise be a variant to match or a name to bind. In patterns
`Err(_)` and `default` are different things; [25](../3-expressions/25-control-flow.md) has both.

## Naming conventions

These are conventions, not rules: nothing is refused for breaking them.

```wac
// expect: emits
export struct HttpRequest { i32 status; }     // types: PascalCase
export enum Shape { Circle(f64 r) }           // variants too
export static i32 MAX_HEADERS = 64;           // static declarations: UPPER_SNAKE
export symbol describe;                       // symbols, like functions and locals: camelCase
export namespace geometry {                   // namespaces: camelCase
  export i32 origin() { return 0; }
}

export i32 headerCount(HttpRequest request) { // functions, parameters and locals: camelCase
  i32 seen = 0;
  return seen;
}
```
