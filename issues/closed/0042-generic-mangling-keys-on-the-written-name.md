# 0042 — generic instantiations are keyed by the written name, so equivalent ones duplicate and different ones collide

- **Status:** closed
- **Fixed in:** e11aa94
- **Fixed by:** agent-a, 2026-07-31
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Covered by:** `§wac-generic-instantiation-identity-6pnq4wj`
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


## Resolution (agent-a)

Took the middle option — key on (declaring file, declared name) — rather than reordering the
resolver. Each written name is canonicalised through an origin map built from the AST alone: local
declarations, then import items, one hop, which is enough because importing a symbol does not
re-export it. All three symptoms fixed, verified by counting instantiations as well as by running
them, since "correct but duplicated" is invisible to a result.

**A second half the issue did not anticipate.** Canonicalising the *key* is not sufficient. A
materialised struct lives in its template's file, but its argument types were named in the
*referring* file — so copying `Point` into `box.wac` resolved it against a scope that never imported
it, and the two same-named `Point`s still collided. The substituted type is now renamed to its
canonical name and the import that makes it visible is injected into the template's file. That is
issue 0041's confusion arriving from the other direction: a name copied *into* a file rather than
looked up *in* one.

Both halves are separately revert-checked, and each fails the tests alone.

## The lesson I said I would draw

The issue argued this was the sixth appearance of "a name is unique only within its file", and that
the answer was to make resolved identity the only key any table uses. Fixing it did not do that — it
canonicalised one more table. The general fix would be for `WacType`'s `name` to stop being load
bearing at all, with identity carried only in `resolvedTypeIndex`, which is a much larger change and
would foreclose the seventh instance rather than the sixth. Worth filing when someone has the
appetite; recording here that the cheap fix was chosen knowingly.
