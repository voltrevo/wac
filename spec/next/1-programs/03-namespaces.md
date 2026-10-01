# 03 — Namespaces

Namespaces group names; they are not runtime objects. A namespace is how a module gives its exports a
hierarchy, and how a package exposes a public structure without exposing its file layout.

## Two ways to expose a namespace

A namespace is backed by a module, or written inline:

```wac
// fragment — core's entry module: a module-backed namespace
export * as operators from "./operators.wac";
```

```wac
// fragment — an alternative core entry module: an inline namespace
export namespace operators {
  export symbol add;
  export symbol multiply;
}
```

These alternatives expose the same API shape. Inside an inline namespace, `export` marks public
members. A re-export preserves the original declaration's identity.

```wac
// expect: answers areaPlusFour = 7
// ---- shapes.wac ----
export struct Circle { i32 r; }
export i32 area(Circle c) { return 3 * c.r * c.r; }
// ---- lib.wac ----
export * as shapes from "./shapes.wac";
// ---- main.wac ----
import { shapes } from "./lib.wac";

export i32 areaPlusFour() {
  shapes.Circle c = shapes.Circle(1);
  return shapes.area(c) + 4;
}
```

`[§wac-namespace-module-ewetmdc]` `export * as name from "…"` exports the named module's exports as a
namespace called `name`.

```wac
// expect: answers areaPlusFour = 7
// ---- lib.wac ----
export namespace shapes {
  export struct Circle { i32 r; }
  export i32 area(Circle c) { return 3 * c.r * c.r; }
}
// ---- main.wac ----
import { shapes } from "./lib.wac";

export i32 areaPlusFour() {
  shapes.Circle c = shapes.Circle(1);
  return shapes.area(c) + 4;
}
```

`[§wac-namespace-inline-8r8emsb]` `namespace name { … }` declares a namespace inline. Inside it,
`export` marks the members visible through the namespace.

`[§wac-namespace-same-shape-646swt5]` A module-backed namespace and an inline one with the same
exports give their importers the same API: `main.wac` is identical in the two programs above.

A namespace without `export` is private to its module, like any other declaration:

```wac
// expect: answers viaHelpers = 7
namespace helpers {
  export i32 good() { return 7; }
}

export i32 viaHelpers() { return helpers.good(); }
```

`[§wac-namespace-private-ezix2ix]` A namespace declared without `export` is usable only in its own
module.

### `export` inside a namespace is its boundary

A member without `export` belongs to the namespace block alone. The members around it name it by its bare
name; the rest of the file cannot reach it, qualified or not:

```wac
// expect: answers viaHelpers = 7
namespace helpers {
  i32 base() { return 3; }                 // the block's own
  export i32 good() { return base() + 4; }
}

export i32 viaHelpers() {
  // ERROR: 'base' is not exported from namespace 'helpers'
  // return helpers.base();

  // ERROR: undefined name 'base'
  // return base();

  return helpers.good();
}
```

`[§wac-namespace-member-private-q5zj9wx]` A member of an inline namespace declared without `export` is visible
only inside the namespace's block, not to the rest of its module.

`export` on a member exposes it only as far as the namespace itself reaches. In a namespace that is not
exported, an exported member is visible to the rest of its module and no further:

```wac
// expect: refused
// ---- lib.wac ----
namespace helpers {                         // not exported; nothing in lib.wac uses it, so dropped
  export i32 good() { return 7; }
}
// ---- main.wac ----
import { helpers.good } from "./lib.wac";   // lib.wac does not export helpers
export i32 seven() { return good(); }
```

`[§wac-namespace-member-bounded-zk3yv92]` A member exported from a namespace that is not itself exported is
visible within its module only. No other module can import it, by the namespace or by a member path.

Visibility composes outward: a member is visible from outside a module only when every namespace around it,
and the member itself, is exported.

## Select the group or one member

```wac
// fragment — four ways to reach one symbol
import { operators } from "core";
import { operators.add } from "core";
import { operators.add as plus } from "core";
import * as core from "core";

// operators.add, add, plus and core.operators.add name the same symbol.
```

```wac
// expect: answers areas = 17
// ---- shapes.wac ----
export struct Circle { i32 r; }
export i32 area(Circle c) { return 3 * c.r * c.r; }
// ---- lib.wac ----
export * as shapes from "./shapes.wac";
// ---- main.wac ----
import { shapes.Circle } from "./lib.wac";
import { shapes.area as circleArea } from "./lib.wac";
import * as lib from "./lib.wac";

export i32 areas() {
  Circle c = Circle(2);                      // the member, bound by its own name
  lib.shapes.Circle d = c;                   // the same type, reached through the module
  return circleArea(d) + lib.shapes.area(Circle(0)) + 5;   // 12 + 0 + 5
}
```

`[§wac-namespace-import-member-gfyf3qj]` `import { ns.member }` binds the member under its own name,
and `import { ns.member as x }` binds it as `x`. Either is the same declaration as `ns.member`.

`[§wac-namespace-import-all-inza3ff]` `import * as name from "…"` binds the module's exports as a
namespace called `name`.

Selecting a member binds that member's name in the importing file, and it collides with other names
there by the ordinary rules ([01](01-names-and-identity.md)).

Methods are named through a namespace like anything else — here, an operator symbol:

```wac
// fragment — with operators imported from "core"; the method body is elided
struct Foo {
  Foo [operators.add](const this, const Foo rhs) { /* implementation */ }
}
```

Namespace qualification also selects exported types, functions, static declarations, and nested
namespaces:

```wac
// expect: answers qualified = 15
// ---- geometry.wac ----
export struct Point { i32 x; i32 y; }
export Point origin() { return Point(0, 0); }
export static i32 LIMIT = 10;
export namespace units {
  export static i32 SCALE = 5;
}
// ---- main.wac ----
import * as geometry from "./geometry.wac";

export i32 qualified() {
  geometry.Point p = geometry.origin();
  i32 limit = geometry.LIMIT;
  return p.x + limit + geometry.units.SCALE;
}
```

`[§wac-namespace-qualify-t685iki]` `ns.member` selects an exported type, function, static declaration
or nested namespace, in a type position or a value position as the member requires.

A namespace is not a value:

```wac
// expect: emits
// ---- geometry.wac ----
export i32 origin() { return 0; }
// ---- main.wac ----
import * as geometry from "./geometry.wac";

export void consume(i32 x) {}

export i32 viaNamespace() {
  // ERROR: a namespace is not a value
  // auto ns = geometry;

  // ERROR: a namespace is not a value
  // consume(geometry);

  return geometry.origin();
}
```

`[§wac-namespace-not-value-7jhtscc]` A namespace name used anywhere but before `.` is refused: it
cannot be stored, passed, returned or compared.

## A re-export preserves identity

```wac
// expect: answers radiusBothRoutes = 4
// ---- shapes.wac ----
export struct Circle { i32 r; }
// ---- lib.wac ----
export * as shapes from "./shapes.wac";
// ---- main.wac ----
import { Circle } from "./shapes.wac";
import { shapes } from "./lib.wac";

i32 radius(shapes.Circle c) { return c.r; }

export i32 radiusBothRoutes() { return radius(Circle(4)); }   // one Circle, two routes
```

`[§wac-namespace-reexport-identity-85athgr]` A declaration reached through a namespace is the same
declaration as when it is reached directly. Re-exporting creates no new type, function or symbol.

## A namespace is declared once

```wac
// expect: emits
export namespace geometry {
  export i32 origin() { return 0; }
}

// ERROR: 'geometry' is already declared
// export namespace geometry { export i32 unit() { return 1; } }
```

`[§wac-namespace-once-7ar5jqz]` A namespace cannot be reopened. A second declaration with the same
name is a collision ([01](01-names-and-identity.md)), so a namespace's members are all written in one
place — the inline block, or the module that backs it.

## Public names do not expose the file layout

```wac
// fragment — a consumer of core
import { operators.add } from "core";  // the supported public path

// No package-subpath resolution exists:
// import { add } from "core/operators.wac";
```

Packages, including core, may split their implementation into arbitrary relative files. Consumers use
the package entry point and exported namespaces ([02](02-modules-and-imports.md),
`§wac-no-subpath-wqatc72`).

```wac
// fragment — "geometry" names the package; shapes.Circle selects its public declaration
import { shapes.Circle } from "geometry";
```

[Packages](04-packages.md) specifies how a package names its entry module. Namespaces provide the
public hierarchy; reachability ([05](05-reachability.md)) and lazy loading avoid reading unrelated
implementation modules through the entry point.

Reaching `geometry.origin` does not itself retain `geometry.unusedHelper`. Namespace containers are
traversed during reachability, not retained wholesale.
