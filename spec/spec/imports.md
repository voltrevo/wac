## Imports and exports

### Syntax

```wac
import { distance, midpoint } from "./geometry.wac";
import { Point as Point2d } from "./flat.wac";
import { distance as dist3d } from "./spatial.wac";
```

Named imports from relative file paths. Imports can be renamed with `as` to
resolve naming collisions.

### Rules

- Only `export`-marked functions and types can be imported
- Import paths are relative, using `./` or `../` prefixes — except `core`, which is not a path
  (below)
- Circular imports are allowed — wac files contain only declarations (no
  module-level init), so there is no ordering problem
- All name collisions at the same scope are compile errors (see
  [naming.md](naming.md))

### `core`

```wac
import { Read } from "core";            // the root of the tree
import { Option } from "core/option.wac";   // one of its files
```

`core` is a small source tree that ships **inside the compiler**. Nothing on disk answers for it:
the CLI has no path to read it from and the playground has no filesystem at all, so the compiler
carries the text and serves it. A project cannot shadow these names with a `core/` directory of its
own, which is the other half of the same property — a built-in that the filesystem could take over
is not a built-in.

The root is what `"core"` names, and its files are named the way any other file is.
`[§wac-core-unquoted-3nqk7vd]` **Every specifier is a quoted path, `core` included.** A bare word
after `from` is an error: `core` is told to write `from "core"`, and anything else reports
`unknown module 'x'`.

`[§wac-core-one-key-5jm2qhx]` However a file in the tree is reached, it is one module — so `Read`
obtained in one file is the same type as `Read` obtained in another. That is not a nicety: wac's
types are nominal, so two modules would be two `Read`s and nothing could convert between them, which
is the whole reason the tree is embedded rather than copied.

> `core` was written *without* quotes for most of this language's life, and the argument was that a
> quoted specifier says *a file lives at this path* while there was no path here to be right or wrong
> about. [design/lang/0009](../../design/lang/0009-an-installable-toolchain-with-source-builtins-and-locked-git-imports.md)
> D4 removed the premise rather than the argument: there are paths now, `core/option.wac` is one, and
> it is right. D5 then accepted both spellings for exactly as long as it took to move the files using
> the old one — 54 of them — and removed it.

What belongs in the tree is decided per file. The **root** holds only types that have to cross a
*repository* boundary through a funcref signature: wac has nominal types and no closures, so two
declarations of the same shape are two types and nothing can convert between them — fine within a
tree, where both sides can import one file, and impossible across repos. `Read` passes that bar, and
`Node` and `Attr` pass it more strongly, since the compiler emits their constructors for JSX and no
author picks the name to be able to fix a mismatch. The **rest of the tree** is the pure-code shelf
D4 describes — `Option`, `Result`, `Vec`, `Map`, hashing and equality — which is there because a
program that wants a map should not have to find a package first. Anything with a capability in it
is a library and belongs in a package. See `design/0001`.

```wac
// producer.wac
import { Read } from "core";
export Read three() { return Read.Data(u8[](7, 7, 7)); }
```

```wac
// consumer.wac
import { Read } from "core";
export i32 total(fn[Read()] source) {
  match (source()) {
    case Data(bytes): return bytes.len();
    case End:         return 0;
    case Failed(why): return -1;
  }
}
```

```wac
// main.wac
import { three } from "./producer.wac";
import { total } from "./consumer.wac";
export i32 run() { return total(three); }
```

`[§wac-core-one-type-8fjm2wq]` `run()` returns `3`. Two files that never mention each other name the
same `Read`, and a funcref carries it between them — which a copy of the declaration in each cannot
do, because those would be two types (`§wac-samename-struct-4jhq7wn`).

What `core` contains:

```wac
export enum Read {
  Data(u8[] bytes),   // never zero bytes — an empty answer is End
  End,
  Failed(string why)
}
```

`[§wac-core-read-6kv4pnx]` A `u8[]` cannot say why it stopped: empty means both "finished" and
"failed", and callers that conflated the two produced truncated output that looked successful.
`match` is exhaustive, so a caller that ignores `Failed` does not compile.


### `std`

```wac
import { Cli, Core } from "std/platform.wac";
```

The other built-in tree, and the split is by capability: `core` is what needs nothing from the host,
`std` is what is nothing but host — `Core`, `Cli`, the filesystem, the network, processes, the
environment, the terminal, clocks, randomness, the page.

`[§wac-std-reserved-5kt8nqw]` `std` and `std/` are reserved exactly as `core` is: a project's own
`std/platform.wac` does not shadow the built-in, and a `std` specifier never appears in `wac.lock`.
Its version is the toolchain's.

`[§wac-std-no-root-2vp6xmk]` `std` has **no root module** — every name in it is reached by path.
`import { Core } from "std";` is an error naming the file to write instead. `core` has a root because
`Read` is in it; nothing wants to be in a `std` root, and an empty one would only be a second spelling
for the same thing.

`[§wac-std-imports-core-7hn3qrz]` A file in a built-in tree may import `core` and nothing else. Both
compilers carry these trees as **text** — one bundles into a browser with no filesystem, the other
keeps them inside a wasm module — so a relative path out of the tree has nothing to resolve against
at the far end. This is why `frame.wac` and `stream.wac` are packages rather than `std` files: both
import `Buf` from `packages/bytes`.

> **`std` is not in every compiler, and that is the only built-in that is not.** `platform.wac` uses
> lambdas, which the reference frontend does not have, so the reference carries none of this tree and
> refuses the specifier *by name* with that reason. `compiler/README.md` records it as the ninth
> omission. The practical edge of it: the playground compiles `core` and cannot compile a program
> that uses a capability — which was already true, since a browser tab has no filesystem to grant.

### `@/` — the project root

```wac
import { parse } from "@/src/parse.wac";
```

`[§wac-import-project-4hq7mnv]` `@/` is the root of the **project containing the importing file** —
the nearest directory at or above it holding a `wac.json5`. Not the directory the compiler was
started in, and not the entry's project: a program can span two projects, and a file that writes
`@/` means its own.

A `@/` in a file with no `wac.json5` above it is a **compile error**, naming the specifier. It is not
a fallback to something relative: `@/src/parse.wac` joined to nothing would be `src/parse.wac`, a
path that looks real and is relative to a directory nobody named, so the program would compile
against the wrong file instead of being refused.

A project using only relative imports needs no manifest. An empty `wac.json5` is a valid one — its
presence is what `@/` asks about, and nothing reads its contents to answer.


### A mapped specifier

```json5
// wac.json5
{ imports: { "dep/": { git: "https://example.com/dep.git", ref: "main", subdir: "src" } } }
```

```wac
import { two } from "dep/lib.wac";
```

`[§wac-import-mapped-6np2rkq]` A specifier that is neither relative, nor `@/`, nor a built-in may
name a **mapping** declared in the project's `wac.json5`. The name is exact or a slash-terminated
prefix; for a prefix the unmatched suffix is appended to the mapping's `subdir` and rejected if it
climbs out. Mappings may not overlap, so at most one can match and there is no precedence rule to
learn.

Resolution reads the lockfile, never the network: `wac.lock` records the commit each mapping is
pinned to, and the file is read from the checkout cache. **A missing lock entry, or a commit that is
not in the cache, is a compile error naming `wac update`** — an ordinary command does not fetch, and
does not advance a pin because a branch moved.

Identity is the repository, the resolved commit and the repository-relative path — so two mappings
naming one repository at one commit are one module, and two commits are two. That falls out of where
the cache puts a checkout rather than being computed separately.

> **The reference compiler does not resolve mappings** — `compiler/README.md` records it as a stated
> omission. Reading a manifest, a lockfile and a cache is package policy, and that gets one
> implementation; the reference exists to build the first `wacc.wasm` from a cold checkout, which has
> no dependencies by construction.

### Import resolution

The compiler resolves the import graph depth-first, visiting each file at most
once (cycle-safe). It builds a flat symbol table assigning a stable wasm
function index to every function. `core` is not fetched from anywhere: the
compiler adds it to the graph when something imports it, which is why it works
with no filesystem — in the playground, and in `wacCompile` from a map.

### Name mangling

Two files can each define `max` without conflict — imports are always explicit.
The compiled wasm module has a flat function index space. The compiler mangles
every function name to `<stem>$<name>` (stem = filename without extension):

```
geometry$distance  geometry$midpoint  main$perimeter
```

Mangling is purely internal. Wasm export entries use the original unqualified
name and only include functions exported by the entry file (see
[functions.md](functions.md)).

Struct type identifiers and their method names are mangled the same way —
prefixed with the file stem — so that two files can each declare a struct
with the same name without colliding:

```
geometry$Point            (struct type identifier)
geometry$Point$distanceSq  (method)
main$Point                 (a distinct, unrelated Point declared in main.wac)
```

### Diamond imports

```wac
// shared.wac
export i32 base() { return 100; }
```

```wac
// left.wac
import { base } from "./shared.wac";
export i32 left() { return base() + 10; }
```

```wac
// right.wac
import { base } from "./shared.wac";
export i32 right() { return base() + 20; }
```

```wac
// top.wac
import { left } from "./left.wac";
import { right } from "./right.wac";
export i32 combined() { return left() + right(); }
```

`[§wac-diamond-79emza1]` `combined()` returns `230`.

### Importing types

Struct types can be imported by name:

```wac
import { Point, midpoint } from "./geometry.wac";

export f64 run() {
  Point a = Point.create(0.0, 0.0);
  return a.distanceSq(Point.create(3.0, 4.0));
}
```

`[§wac-import-type-ev21tgx]` Importing a struct makes its constructors, methods, and
fields accessible.

#### A written type name must be in scope

**Every type name a file writes has to be in that file's scope.** An enum, a variant, a struct —
naming one you did not import is `undefined type 'X'`, reported where you wrote it:

```wac
import { mk } from "./k.wac";      // K itself is not imported
export i32 f() {
  K k = mk();                      // error: undefined type 'K'
  A a = mk() as! A;                // error: undefined type 'A'
  return mk() is A ? 1 : 0;        // error: undefined type 'A'
}
```

`[§wac-type-name-scope-8vqk3mn]` The fix is the import — and a variant imports like any other
name, `import { K, A } from "./k.wac"`.

This is worth stating because it did not hold, and what it cost was a **wrong answer**. A name
that resolved nowhere had no type index, and every consumer then fell back to a global map keyed
by name: two files may each declare a `Circle` variant (`§enum-name-identity`), so `x is Circle`
in a third file picked one of them and answered `false` about a value that was the other. No
diagnostic. `[§wac-type-name-scope-8vqk3mn]` It is refused now.

Two things that look like a type name are not, and are unaffected: `f(x)` where `f` is a funcref
local or a function, and `x is Other` where `Other` is a variable, which is an identity test.
`[§wac-type-name-scope-8vqk3mn]`

What needs **no** import is `match`. An arm resolves its variants through the enum the subject
*is*, so matching a value you got from an imported function needs neither the enum's name nor its
variants' — see `§enum-cross-file`.

### Circular imports

```wac
// ping.wac
import { pong } from "./pong.wac";
export i32 ping(i32 n) {
  if (n == 0) { return 0; }
  return pong(n - 1) + 1;
}
```

```wac
// pong.wac
import { ping } from "./ping.wac";
export i32 pong(i32 n) {
  if (n == 0) { return 0; }
  return ping(n - 1) + 1;
}
```

`[§wac-circular-m7jx3p4]` `ping(5)` returns `5` — circular imports resolve
correctly.

### Same-name functions in different files

```wac
// utils_a.wac
export i32 compute(i32 x) { return x + 1; }
```

```wac
// utils_b.wac
export i32 compute(i32 x) { return x * 2; }
```

```wac
// main.wac
import { compute as computeA } from "./utils_a.wac";
import { compute as computeB } from "./utils_b.wac";

export i32 test() {
  return computeA(5) + computeB(5);
}
```

`[§wac-rename-imp-w4fn9k2]` `test()` returns `16` (6 + 10) — same-name functions
in different files don't collide, mangled names are distinct.

```wac
// caller.wac
import { compute } from "./utils_a.wac";
i32 compute2(i32 x) { return x * 3; }

export i32 test() {
  return compute(5) + compute2(5);
}
```

`[§wac-imp-coexist-p8km2v6]` `test()` returns `21` (6 + 15) — imported `compute`
and local `compute2` coexist; imported names don't collide with same names in
other (non-imported) files.

### Same-name structs in different files

Struct names follow the same rule as function names: duplicate struct names
are only a compile error within the same file (see [naming.md](naming.md)).
Two files that never import each other can each declare a struct with the
same name — each keeps its own field layout and its own methods, and every
use resolves through the file it is written in.

The mangled names described above are how those definitions are *labelled*,
not how they are found. Two files with the same stem in different directories
— `ssh/src/writer.wac` and `tls/src/writer.wac` — produce the same mangled
name for a same-named method, so a mangled name is not an identity either.
Nothing about this guarantee depends on file names being unique across the
program; the identity of a definition is the file it was written in.

`[§wac-samename-struct-4jhq7wn]` This holds however the two are reached, including when the
importing file names only *one* of them and the other arrives transitively — which is the case
that matters in practice, because then neither file you are reading mentions the other's type.
It also holds when the name is a struct in one module and an enum in another.

`[§wac-samename-stem-3xr7ktn]` It holds for two files with the same *stem* in different
directories, and `[§wac-funcref-scope-9qh2vtm]` for a method or a plain function taken as a
funcref value rather than called — `fn[i32()] f = helper;` refers to the `helper` written in
the same file as that line, whatever else in the program is called `helper`.

This paragraph described the intent before it described the behaviour. The emitter resolved a
written struct name through a global bare-name map, last-wins, so both names reached whichever
struct was registered last: the program typechecked and then failed to instantiate with a type
mismatch inside a function that mentioned neither file. The example below happened to work
because it imports both under aliases and uses each immediately; the transitive case did not.
See issue 0041, which cost the reporter an hour, in a diagnostic naming a function in neither
file.

```wac
// a.wac
struct Box { i32 x; i32 y; }
```

```wac
// b.wac
struct Box { i32 y; i32 x; }   // same name, different field order
```

```wac
// main.wac
import { Box as BoxA } from "./a.wac";
import { Box as BoxB } from "./b.wac";

export i32 test() {
  BoxA a = BoxA(1, 2);   // a.x = 1, a.y = 2
  BoxB b = BoxB(3, 4);   // b.y = 3, b.x = 4
  return a.x * 100 + b.y;
}
```

`[§wac-samename-struct-k7fn3wq]` `test()` returns `103` — same-name structs in
different files don't collide; each keeps its own field layout and methods,
mangled names are distinct.

### Aliases preserve type identity

The converse also holds: an alias introduced by `import { X as Y }` is a new
*name*, not a new *type*. Two type names are the same type if and only if they
resolve to the same struct declaration, regardless of what they are spelled as
at the point of use. In particular, a funcref annotation written with an alias
matches a method of the original struct.

```wac
// lib.wac
export struct Box {
  i32 v;
  i32 get(const this) { return this.v; }
}
```

```wac
// main.wac
import { Box as BoxA } from "./lib.wac";

export i32 test() {
  BoxA b = BoxA(7);
  fn[i32(BoxA)] f = BoxA.get;   // BoxA IS lib's Box — signature matches
  return f(b);
}
```

`[§wac-alias-same-type-j3wq8kf]` `test()` returns `7` — aliased and declared
names for the same struct are interchangeable in every type position.

### No implicit re-export

Importing a symbol makes it usable inside the importing file only. It does
not re-export it: another file can import a symbol only from the file that
declares (and exports) it.

```wac
// a.wac
export i32 foo() { return 42; }
```

```wac
// b.wac
import { foo } from "./a.wac";   // b may use foo...
```

```wac
// main.wac
import { foo } from "./b.wac";   // error: b.wac does not export 'foo'
```

`[§wac-no-reexport-f7kn4wq]` Importing a symbol from a file that merely
imports it (rather than declaring and exporting it) is a compile error.
