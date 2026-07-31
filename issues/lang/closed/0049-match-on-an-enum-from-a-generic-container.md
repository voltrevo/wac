# 0049 — `match` on an enum that came out of a generic container

- **Status:** closed
- **Fixed in:** this commit
- **Claimed by:** agent-a
- **Reported by:** agent-b (verbally, via the operator — filed here after the fact so the record exists)
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

Three files. `v.wac` declares an enum, `vec.wac` is a generic container, `main.wac` imports
both:

```wac
// v.wac
export enum V { Null, Bool(bool value) }

// vec.wac
export struct Vec<T> {
  T[] data; i32 n;
  Vec<T> create() { return Vec(T[](), 0); }
  void push(this, T v) { /* ... */ }
  T get(const this, i32 i) { return this.data[i]; }
}

// main.wac
import { V } from "./v.wac";
import { Vec } from "./vec.wac";
export i32 f() {
  Vec<V> xs = Vec.create();
  xs.push(V.Bool(true));
  return match (xs.get(0)) { case Bool(b): b ? 1 : 0, case Null: 0 };
}
```

Expected: `1`.
Actual:

```
error: 'V__v' is an enum, but it is not in scope in this file
  hint: import it: import { V } from "...";
```

`main.wac` *has* imported it. And `V__v` is a name nobody wrote.

## Cause

The eighth instance of one family: **a name is unique only within its file, and identity is the
type index.** `enumOfType` looked the subject's type name up in the current file's scope and
nowhere else.

`Vec<V>`'s element type is substituted into a copy that lives in `vec.wac`, so the argument type
is renamed to the canonical alias `V__v` — that is how it resolves *there*. `xs.get(0)` hands
that type back to `main.wac`, where `V__v` is not a name at all. The enum was sitting in
`enumByTypeIndex` under the subject's own `resolvedTypeIndex` the whole time: the diagnostic used
that map to decide *which* enum to name in its message, having failed to look it up by index for
the actual question.

## Fix

`enumOfType` consults the type index first and the name only as a fallback, and variant type
indices go into `enumByTypeIndex` as well as base ones — a subject narrowed to a variant by a
surrounding arm has to find the enum from the variant.

The alias also went into `genericDisplay`, so no message shows `V__v`. That map's contract is now
"every name the compiler invented, and what to show instead", which covers instantiations and
cross-file aliases alike.

## A rule went away with it

`spec/spec/enums.md` said the enum's name had to be in scope in the file that matches on it, and
there was a test asserting the *diagnostic* for when it was not. That rule is gone: an arm
resolves its variants through the enum the subject is, so nothing about a `match` needs the name.
It was an inconsistency rather than a decision — reading a field whose type you never imported
has always worked — and this bug is what it cost. The "not in scope" branch is deleted rather
than left unreachable, and the test now asserts the program compiles and runs.

## Numbering

Filed as 0047 and renumbered to 0049: agent-b pushed *their* 0047 — two instantiations of a
generic collapsing when a type argument is an enum — a few minutes before I pushed this, so per
`README.md` the later push moves. Same enum, same afternoon, two different bugs; theirs is the
one that produced invalid wasm and this one is the one that rejected a legal program.

## Also found, filed separately

`is Variant` and a declared variant type resolve a bare name through a global map rather than the
file's scope, so a file can name a variant it never imported. See issue 0048.
