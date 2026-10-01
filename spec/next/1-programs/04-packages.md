# 04 — Packages

A package is a directory with a manifest, imported by name. The consumer selects the package; the
package selects its entry module.

## The consumer selects the package; the package selects its entry module

```wac
// expect: answers circleArea = 12
// ---- wac.json5 ----
{
  imports: {
    geometry: {
      git: "https://example.com/libraries",
      ref: "v1.2.0",
      subdir: "./packages/geometry",
    },
  },
}
// ---- <geometry>/packages/geometry/wac.json5 ----
{
  exports: "./src/lib.wac",
  imports: {
    // Geometry's own dependencies, if any.
  },
}
// ---- <geometry>/packages/geometry/src/lib.wac ----
export * as shapes from "./shapes.wac";
export * as transforms from "./transforms.wac";
// ---- <geometry>/packages/geometry/src/shapes.wac ----
export struct Circle { i32 r; }
export i32 area(Circle c) { return 3 * c.r * c.r; }
// ---- <geometry>/packages/geometry/src/transforms.wac ----
export i32 scale(i32 x, i32 by) { return x * by; }   // nothing reaches it: dropped
// ---- main.wac ----
import { shapes.Circle, shapes.area } from "geometry";

export i32 circleArea() { return area(Circle(2)); }
```

`subdir` selects the package directory inside the dependency checkout. If omitted, the package
directory is the repository root. The selected directory's own `wac.json5` supplies `exports`,
relative to that directory. The consumer does not name the package's source entry file.

`[§wac-package-subdir-p3gfzri]` A manifest entry's `subdir` selects the package's directory within
the checkout, and is the checkout's root when omitted.

`[§wac-package-exports-qwtdfg5]` The package directory's own `wac.json5` names its entry module in
`exports`, relative to that directory. Importing the package imports that module.

`exports` identifies the module imported by consumers; it does not select an executable function or
replace explicit source entry points passed to the compiler. `exports` accepts a single module path,
not a map of package subpaths. That module exposes the public API through its exported declarations
and namespaces ([03](03-namespaces.md)).

```wac
// expect: refused
// ---- wac.json5 ----
{ imports: { geometry: { git: "https://example.com/geometry", ref: "v1" } } }
// ---- <geometry>/wac.json5 ----
{ exports: { ".": "./src/lib.wac", "./shapes": "./src/shapes.wac" } }   // a map is not accepted
// ---- <geometry>/src/lib.wac ----
export i32 two() { return 2; }
// ---- main.wac ----
import { two } from "geometry";
export i32 viaGeometry() { return two(); }
```

`[§wac-package-exports-single-c3mtr3y]` `exports` is one module path. Any other value is refused when
the package is imported.

The repository, the ref and the lock entry that pins it are the manifest's and the lock's business
([46](../8-tooling/46-manifest-and-lock.md)).

## Exact package names, with no subpath operation

```wac
// fragment — given the manifest above
import { shapes.Circle } from "geometry"; // package lookup, then exported-name lookup
```

Each `imports` key matches the complete package name. Trailing-slash mapping keys are invalid. There
are no prefix mappings, unmatched suffixes, or rules appending a suffix to `subdir`. Given the
mapping above, `"geometry/shapes.wac"` does not resolve through `"geometry"`
(`§wac-no-subpath-wqatc72`, in [02](02-modules-and-imports.md)).

```wac
// expect: refused
// ---- wac.json5 ----
{ imports: { "geometry/": { git: "https://example.com/geometry", ref: "v1" } } }
// ---- main.wac ----
export i32 zero() { return 0; }
```

`[§wac-package-key-exact-rme93fh]` A manifest `imports` key is a complete package name. A key ending
in `/` is refused.

This removes package-subpath resolution from the language model; it is not a visibility prohibition
layered over an otherwise supported subpath mechanism.

```wac
// fragment — inside the geometry package
import { Circle } from "./shapes.wac";
```

Relative file imports continue to organise implementation files.

## Entry points must be explicit when a package is imported

```json5
{ exports: "./src/lib.wac" } // sufficient entry-point declaration
```

```json5
{} // valid project manifest; no importable package entry point declared
```

A project compiled through explicit source entry points can omit `exports`. Resolving an import of a
package requires its manifest and `exports`; a missing entry is an error when that package is needed.
There is no implicit `index.wac` or other filename fallback.

```wac
// expect: refused
// ---- wac.json5 ----
{ imports: { geometry: { git: "https://example.com/geometry", ref: "v1" } } }
// ---- <geometry>/wac.json5 ----
{}
// ---- <geometry>/index.wac ----
export i32 two() { return 2; }           // not found by any convention
// ---- <geometry>/src/lib.wac ----
export i32 three() { return 3; }         // nor this: dropped
// ---- main.wac ----
import { two } from "geometry";
export i32 viaGeometry() { return two(); }
```

`[§wac-package-no-fallback-thup5ns]` Importing a package whose manifest has no `exports` is refused.
No file name is tried in its place.

An import dropped by reachability need not load or validate the target package
([05](05-reachability.md)):

```wac
// expect: answers zero = 0
// ---- wac.json5 ----
{ imports: { geometry: { git: "https://example.com/geometry", ref: "v1" } } }
// ---- <geometry>/wac.json5 ----
{}
// ---- main.wac ----
import { two } from "geometry";
i32 unused() { return two(); }           // dropped, so geometry is never resolved
export i32 zero() { return 0; }
```

`[§wac-package-lazy-j3nmf2p]` A package is resolved only when a retained declaration needs a name from
it. An unreachable import of a package with no `exports` is not an error.

## Entry-point conventions and explicit relative paths

```json5
// Conventional library entry, explicitly declared:
{ exports: "./src/lib.wac" }
```

`./src/lib.wac` is a convention for a package's import entry; another explicitly declared path is
valid. There is no automatic filename lookup.

`./src/main.wac` is a separate convention for a program source file passed explicitly to the
compiler ([07](07-programs.md)). It is not declared as the package's import entry in `wac.json5`
merely because it is a program. A program-only project can omit `exports`.

Filesystem paths in `wac.json5` must be explicitly relative: use `./path/to/file`, not
`path/to/file`. This applies to `exports` and directory paths such as `subdir`. The prefix does not
change their base directories: `exports` is relative to the package manifest, while `subdir` is
relative to the dependency checkout.

```json5
{ exports: "src/lib.wac" } // ERROR: use "./src/lib.wac".
```

```json5
{
  imports: {
    geometry: {
      git: "https://example.com/libraries",
      ref: "v1.2.0",
      subdir: "packages/geometry", // ERROR: use "./packages/geometry".
    },
  },
}
```

`[§wac-manifest-dot-slash-p59q7q3]` A path in `wac.json5` — `exports`, `subdir` — must begin with
`./`. One without it is refused.

## One public entry does not force every implementation file to load

```wac
// fragment — the package entry module
export * as shapes from "./shapes.wac";
export * as transforms from "./transforms.wac";
```

When the consumer reaches only `shapes.Circle`, it does not thereby reach `transforms`. Unless another
retained declaration needs it, `transforms.wac` need not be read. Namespace selection, reachability
and lazy loading provide selective access through the single public entry. The first example of
this chapter compiles even if `transforms.wac` is missing:

```wac
// expect: answers circleArea = 12
// ---- wac.json5 ----
{ imports: { geometry: { git: "https://example.com/geometry", ref: "v1" } } }
// ---- <geometry>/wac.json5 ----
{ exports: "./src/lib.wac" }
// ---- <geometry>/src/lib.wac ----
export * as shapes from "./shapes.wac";
export * as transforms from "./transforms.wac";    // this file does not exist
// ---- <geometry>/src/shapes.wac ----
export struct Circle { i32 r; }
export i32 area(Circle c) { return 3 * c.r * c.r; }
// ---- main.wac ----
import { shapes.Circle, shapes.area } from "geometry";
export i32 circleArea() { return area(Circle(2)); }
```

`[§wac-package-selective-un8citz]` Reaching one namespace of a package's entry module does not read
the modules behind its other namespaces.

## A package's identity

A package module is identified by the repository, the commit the lock pins, and the path within it.
Two manifest entries naming one repository at one commit reach one module; two commits are two
([46](../8-tooling/46-manifest-and-lock.md)).

```wac
// expect: answers oneCircle = 5
// ---- wac.json5 ----
{
  imports: {
    shapes: { git: "https://example.com/geometry", ref: "v1", subdir: "./shapes" },
    draw:   { git: "https://example.com/drawing",  ref: "v4" },
  },
}
// ---- <shapes>/shapes/wac.json5 ----
{ exports: "./lib.wac" }
// ---- <shapes>/shapes/lib.wac ----
export struct Circle { i32 r; }
// ---- <draw>/wac.json5 ----
{
  exports: "./lib.wac",
  // the same repository and ref as the consumer's `shapes`
  imports: { geo: { git: "https://example.com/geometry", ref: "v1", subdir: "./shapes" } },
}
// ---- <draw>/lib.wac ----
import { Circle } from "geo";
export i32 radius(Circle c) { return c.r; }
// ---- main.wac ----
import { Circle } from "shapes";
import { radius } from "draw";
export i32 oneCircle() { return radius(Circle(5)); }   // one Circle
```

`[§wac-package-identity-uskz3mi]` Two manifests that resolve to the same repository, commit and path
reach the same module, under whatever names they import it by.

A package's files cannot be reached by a relative path from outside it, nor can its files reach out of it
by one ([02](02-modules-and-imports.md)): a package is entered through its name and its `exports` alone.
