# 02 — Modules and imports

A file is a module. It holds declarations, and `export` decides which of them other modules may
name. An import names a module with a quoted specifier and binds some of its exports in the
importing file.

## A module holds declarations

```wac
// expect: answers main = 64
static i32 SIZE = square(8);

i32 square(i32 x) { return x * x; }

struct Point { i32 x; i32 y; }
enum Shape { Circle(f64 r), Square(f64 side) }
symbol describe;
type Pair = (i32, i32);
namespace geometry {
  export i32 origin() { return 0; }
}

// ERROR: a module-level variable must be static
// i32 counter = 0;

export i32 main() { return SIZE; }
```

`[§wac-module-declarations-only-6ac43nm]` The top level of a module holds only declarations:
functions, structs, enums, type declarations, static declarations, symbols and namespaces. There is
no module-level statement, and no module-level variable that is not `static`.

So nothing runs because a module was loaded, and there is no mutable module state. A static
declaration's value is computed at compile time ([27](../4-static/27-static-declarations.md)); it is
not initialisation that happens on import.

## `export` decides what other modules may name

```wac
// expect: answers main = 15
// ---- lib.wac ----
export i32 visible(i32 x) { return hidden(x) + 1; }
i32 hidden(i32 x) { return x * 2; }

export static i32 LIMIT = 4;
export struct Point { i32 x; i32 y; }
export enum Edge { Top, Bottom }
// ---- main.wac ----
import { visible, LIMIT, Point, Edge } from "./lib.wac";

// ERROR: lib.wac does not export 'hidden'
// import { hidden } from "./lib.wac";

export i32 main() {
  Point p = Point(1, 2);
  Edge e = Edge.Top;
  return visible(LIMIT) + p.x + p.y + 3;     // 9 + 1 + 2 + 3
}
```

`[§wac-export-importable-dn79iqg]` A declaration marked `export` can be imported by another module,
whatever kind of declaration it is. One without `export` is private to its module, and importing it
is refused.

`[§wac-struct-export-m3kq8wp]` An `export struct` can be imported from another file; a struct
without `export` cannot.

`export` is about modules naming each other. Which functions a compiled *program* exposes to its host
is a different question, answered by its entry module ([07](07-programs.md)).

## Importing names

```wac
// expect: answers main = 230
// ---- shared.wac ----
export i32 base() { return 100; }
// ---- left.wac ----
import { base } from "./shared.wac";
export i32 left() { return base() + 10; }
// ---- right.wac ----
import { base } from "./shared.wac";
export i32 right() { return base() + 20; }
// ---- main.wac ----
import { left } from "./left.wac";
import { right } from "./right.wac";

export i32 main() { return left() + right(); }
```

`[§wac-diamond-79emza1]` Two modules may import the same module, and a third may import both:
`main()` answers 230.

Importing a struct brings everything that belongs to it — its constructors, fields and methods — and
importing an enum brings its variants' construction through the enum's name:

```wac
// expect: answers main = 25.0
// ---- geometry.wac ----
export struct Point {
  f64 x;
  f64 y;
  f64 distanceSq(const this, const Point other) {
    f64 dx = this.x - other.x;
    f64 dy = this.y - other.y;
    return dx * dx + dy * dy;
  }
}
// ---- main.wac ----
import { Point } from "./geometry.wac";

export f64 main() {
  Point a = Point(0.0, 0.0);
  return a.distanceSq(Point(3.0, 4.0));
}
```

`[§wac-import-type-ev21tgx]` Importing a struct makes its constructors, methods and fields usable.

An import is for the importing file alone. It does not make the name available to anyone who imports
*that* file:

```wac
// expect: answers main = 42
// ---- a.wac ----
export i32 foo() { return 42; }
// ---- b.wac ----
import { foo } from "./a.wac";
export i32 viaB() { return foo(); }
// ---- main.wac ----
import { viaB } from "./b.wac";

// ERROR: b.wac does not export 'foo'
// import { foo } from "./b.wac";

export i32 main() { return viaB(); }
```

`[§wac-no-reexport-f7kn4wq]` Importing a name from a module that imports it, rather than declaring
and exporting it, is refused.

Re-exporting is explicit, and takes the form of a namespace ([03](03-namespaces.md)).

Modules may import each other in a cycle:

```wac
// expect: answers main = 5
// ---- ping.wac ----
import { pong } from "./pong.wac";
export i32 ping(i32 n) {
  if (n == 0) { return 0; }
  return pong(n - 1) + 1;
}
// ---- pong.wac ----
import { ping } from "./ping.wac";
export i32 pong(i32 n) {
  if (n == 0) { return 0; }
  return ping(n - 1) + 1;
}
// ---- main.wac ----
import { ping } from "./ping.wac";
export i32 main() { return ping(5); }
```

`[§wac-circular-m7jx3p4]` Circular imports are allowed: `ping(5)` answers 5.

There is nothing for a cycle to get wrong. A module runs nothing when it is loaded, and static values
are computed in the order their computations demand, not the order modules are read
([29](../4-static/29-static-dependencies.md)).

## Specifiers

A specifier is always a quoted string, and it is one of three things:

```wac
// expect: answers main = 7
// ---- wac.json5 ----
{}
// ---- src/num.wac ----
export i32 three() { return 3; }
// ---- src/deep/four.wac ----
import { three } from "../num.wac";          // relative to this file
export i32 four() { return three() + 1; }
// ---- main.wac ----
import { three } from "./src/num.wac";       // relative to this file
import { four } from "@/src/deep/four.wac";  // from the project root
import { operators } from "core";            // a package

export i32 main() { return three() + four(); }
```

| Specifier | Names |
|---|---|
| `"./x.wac"`, `"../x.wac"` | a file, relative to the importing file |
| `"@/src/x.wac"` | a file, relative to the root of the importing file's project |
| `"core"`, `"geometry"` | a package: its whole name, nothing appended |

`[§wac-specifier-kinds-sgmw8y4]` A specifier is relative (`./`, `../`), rooted at the project
(`@/`), or the complete name of a package. A specifier that is none of these is refused, and the
diagnostic names the specifier.

`sub/lib.wac` is therefore not a path: it names no package and it does not start with `./`, so it is
refused rather than looked for next to the importing file. A path that is usually absent and
occasionally present is the worse failure.

```wac
// expect: emits
// ERROR: a specifier is a quoted string — write from "core"
// import { operators } from core;

export i32 main() { return 0; }
```

`[§wac-core-unquoted-3nqk7vd]` Every specifier is quoted, `core` included. A bare word after `from`
is refused.

### `@/` is the importing file's project

`@/` is the root of the **project containing the importing file**: the nearest directory at or above
it that holds a `wac.json5`. Not the directory the compiler was started in, and not the entry's
project — a program may span two projects, and each file's `@/` means its own:

```wac
// expect: answers main = 21
// ---- wac.json5 ----
{}
// ---- src/fmt.wac ----
export i32 width() { return 20; }
// ---- tools/report.wac ----
import { width } from "@/src/fmt.wac";
export i32 report() { return width(); }
// ---- vendored/wac.json5 ----
{}
// ---- vendored/src/fmt.wac ----
export i32 width() { return 1; }
// ---- vendored/tools/extra.wac ----
import { width } from "@/src/fmt.wac";       // vendored's own root, not the entry's
export i32 extra() { return width(); }
// ---- main.wac ----
import { report } from "./tools/report.wac";
import { extra } from "./vendored/tools/extra.wac";

export i32 main() { return report() + extra(); }
```

The same header works in every file of a project, wherever the file is.

```wac
// expect: refused
// ---- main.wac ----
import { parse } from "@/src/parse.wac";     // no wac.json5 at or above this file
export i32 main() { return parse(); }
```

`[§wac-import-project-4hq7mnv]` `@/` resolves against the nearest `wac.json5` at or above the
importing file. With none, it is refused — not treated as relative to some other directory.

A project that uses only relative imports needs no manifest. An empty `wac.json5` is a valid one: its
presence is all `@/` asks about.

### A package is named whole

A package is imported by its complete name, which is either a key in the project's manifest
([04](04-packages.md), [46](../8-tooling/46-manifest-and-lock.md)) or one of the two packages that
ship with the toolchain, `core` and `std`. Its public names come from its one entry module. There is
no way to name a file inside it:

```wac
// expect: emits
import { operators } from "core";            // the package
import { operators.add } from "core";        // one member of a namespace it exports

// ERROR: "core/operators.wac" names no package — import from "core"
// import { add } from "core/operators.wac";

export i32 main() { return 0; }
```

`[§wac-no-subpath-wqatc72]` A package specifier names the package and nothing else. Appending a path
to it is refused; the package's public structure is expressed by its exports and namespaces
([03](03-namespaces.md)).

A package may split its implementation across as many files as it likes. Which of them a program
reads depends on what it uses ([05](05-reachability.md)), not on what the entry module mentions.

## One module, however it is reached

A module's identity is its file. Two specifiers that reach the same file reach the same module, and
everything in it is the same thing to both:

```wac
// expect: answers main = 9
// ---- lib.wac ----
export struct Token { i32 kind; }
// ---- parse/make.wac ----
import { Token } from "../lib.wac";
export Token make() { return Token(9); }
// ---- main.wac ----
import { Token } from "./lib.wac";
import { make } from "./parse/make.wac";

export i32 main() {
  Token t = make();                          // one Token, reached two ways
  return t.kind;
}
```

`[§wac-module-one-identity-mmpdhtg]` Two specifiers that resolve to the same file name the same
module, and its declarations are the same declarations through either.

For a package, the file is the one in the package at the version the lock records: two names for the
same package at the same version are one module, and two versions are two
([46](../8-tooling/46-manifest-and-lock.md)).

The same holds for the built-in packages, which is why their types can cross between files that never
mention each other:

```wac
// expect: answers main = 3
// ---- producer.wac ----
import { Read } from "core";
export Read three() { return Read.Data([7, 7, 7]); }
// ---- consumer.wac ----
import { Read } from "core";
export i32 total(fn<Read()> source) {
  return match (source()) {
    Data(bytes):  bytes.len(),
    End:          0,
    Failed(why):  -1,
  };
}
// ---- main.wac ----
import { three } from "./producer.wac";
import { total } from "./consumer.wac";

export i32 main() { return total(three); }
```

`[§wac-core-one-key-5jm2qhx]` However `core` is reached, it is one module, so `Read` obtained in one
file is the same type as `Read` obtained in another.

`[§wac-core-one-type-8fjm2wq]` `main()` answers 3: two files that never mention each other name the
same `Read`, and a function value carries it between them.

Types are nominal, so this is not a nicety. Two copies of `Read` would be two types with nothing to
convert between them.

## The built-in packages

`core` and `std` ship with the toolchain. Nothing on disk answers for them, a project cannot replace
them, and their version is the toolchain's:

```wac
// expect: answers main = 1
// ---- core/lib.wac ----
export i32 answer() { return 99; }           // an ordinary directory of this project
// ---- main.wac ----
import { Read } from "core";                 // still the built-in package

export i32 main() {
  Read r = Read.End;
  return match (r) {
    End:     1,
    default: 0,
  };
}
```

`[§wac-core-reserved-hs459yd]` `core` names the built-in package whatever the project contains. A
directory named `core` is an ordinary directory, reached only by a path.

`[§wac-std-reserved-5kt8nqw]` `std` is reserved in the same way, and a built-in package never appears
in `wac.lock`.

`core` holds what needs nothing from the host: the types the language itself refers to, and the
ordinary data structures a program should not have to find a package for
([37](../7-library/37-core.md)). `std` holds what is nothing but host — the capabilities a program is
handed ([44](../7-library/44-std.md)).

## When an imported file is read

An import is a route to a module, not an instruction to read it. A file is read when something
retained needs a declaration in it ([05](05-reachability.md)), and checking a whole project reads
everything ([06](06-checking-a-project.md)).

## Open

- **Re-exporting one name.** A module can re-export another module as a namespace
  ([03](03-namespaces.md)). Whether it can re-export a single imported declaration under its own
  name — the role `export { foo } from "./a.wac"` plays elsewhere — is not decided.
- **Relative imports across a package boundary.** Whether a file in one package may import a file in
  another by a relative path is not decided ([04](04-packages.md)).
