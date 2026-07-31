# 0042 — generic instantiations are keyed by the written name, so equivalent ones duplicate and different ones collide

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** wrong answer, and invalid wasm

An instantiation is identified by mangling the type *as written* — `Box<Point>` becomes
`Box$Point` — rather than by the resolved identity of the template and its arguments. A name is
only unique within its file, so this is wrong in both directions at once.

Found by being asked whether two equivalent instantiations can duplicate. They can, and looking
turned up two worse things.

## 1. Equivalent instantiations duplicate (wasteful)

```wac
// p.wac
export struct Point { i32 x; }
// a.wac
import { Point as P } from "./p.wac";
i32 fa() { Box<P> b = Box(mk()); return b.get().x; }
// main.wac
import { Point } from "./p.wac";
i32 f() { Box<Point> b = Box(mk()); return b.get().x + fa(); }
```

`Box<P>` and `Box<Point>` are the same type. Two structs are materialised:

```
materialised instantiations: Box$P, Box$Point
```

Both work and both answer correctly, so this is code size and compile time rather than
correctness — a monomorphising compiler duplicating bodies is the cost the design accepted, but
not twice for one type.

## 2. An aliased *template* name does not resolve at all (broken)

```wac
import { Box as B } from "./box.wac";
i32 f() { B<i32> b = B(1); return b.get(); }
```

`undefined function or struct 'B$i32'`.

The instantiation is materialised as `B$i32`, but the import rewriting keys on the template's
*declared* name, so it never adds an import item for `B$i32` and nothing resolves it. Aliasing a
generic is simply unusable.

## 3. Two same-named argument structs collide (wrong types)

```wac
// p1.wac
export struct Point { i32 x; }
// p2.wac
export struct Point { i32 a; i32 b; }      // a different struct, legally sharing the name
// a.wac   — uses p1's Point
import { Point, mk1 } from "./p1.wac";
i32 fa() { Box<Point> b = Box(mk1()); return b.get().x; }
// main.wac — uses p2's Point
import { Point, mk2 } from "./p2.wac";
i32 f() { Box<Point> b = Box(mk2()); return b.get().a; }
```

`struct 'Point' has no field 'a'`.

Both mangle to `Box$Point`, so **one** struct is materialised — from whichever file got there
first — and the other file's `Box<Point>` silently refers to it. This is a type confusion, not a
diagnostic: had the two `Point`s happened to have compatible layouts, it would have produced
wrong answers rather than an error.

`§wac-samename-struct-4jhq7wn` establishes that two modules may legitimately declare a struct with
one name, so this is not a case that can be legislated away.

## Cause and fix

`mangleType` uses `t.name`, the name as written. It should use the argument's **resolved identity**
— the `StructEntry.typeIndex` the resolver assigns — so `Box$#7` (or a stable per-entry key) rather
than `Box$Point`. Then an alias and its target produce one instantiation, and two same-named
structs produce two.

The obstacle is ordering: monomorphisation runs *before* the resolver builds scopes, so type
indices do not exist yet. Options, roughly in order of how much they cost:

- **Resolve just enough first.** Register struct declarations and process imports, then
  monomorphise, then the rest. Aliases and identities would both be known. This is probably the
  right answer and is a reordering rather than new machinery.
- **Key on (declaring file, declared name).** Cheaper, no reordering: resolve each argument's
  written name through the file scope's *import map* only, which is available from the AST. Fixes
  all three symptoms without needing type indices.
- **Reject the ambiguous cases.** Refuse an aliased generic and refuse a same-named argument. Cheap
  and safe, but `§wac-samename-struct-4jhq7wn` says same-named structs are legal, so this narrows
  the language to match an implementation detail.

Whoever takes it should note that the display names (`Vec$i32` → `Vec<i32>`) come from the same
mangling, so a keying change has to keep them readable — the point of that table is that no
diagnostic shows a name the author did not write.

**Sixth appearance of one confusion.** A name is unique only within its file: the same mistake has
now been fixed in `annotateType`, `emitCall`/`emitField`, `structIdxInFile`, bare function names
(123ac4c), and enum identity — and reintroduced here by me, in code written after all five. That
is a strong argument for making resolved identity the only key any table uses, rather than fixing
the seventh instance later.
