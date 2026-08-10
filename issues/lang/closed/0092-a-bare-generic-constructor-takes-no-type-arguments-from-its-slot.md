# 0092 — a bare generic constructor takes no type arguments from its slot

- **Status:** closed — fixed 2026-08-10
- **Claimed by:** agent-b, 2026-08-10
- **Fixed in:** 9af73a95
- **Reported by:** agent-b
- **Date:** 2026-08-10
- **Kind:** missing feature
- **Symptom:** not implemented

## Reproduction

```wac
struct Box<T> { T v; }
export i32 f() { Box<i32> b = Box(3); return b.v; }
```

Expected: emitted, as the same program with the arguments written out is.

Actual: declined — *"a call to Box"*.

Writing the instantiation in the call emits fine:

```wac
export i32 f() { Box<i32> b = Box<i32>(3); return b.v; }   // emits
```

## Why it matters

**This is the largest single blocker in rung 4's corpus**: 16 of the 52 partial
files are `a method Map<string,i32>.set, declined`, and `Map.set` declines because
it contains `MapEntry(k, v)` — a bare constructor whose arguments come from the
field it is stored in. Three more are `a call to MapEntry` directly.

## Where the fix goes

The language already resolves this shape elsewhere, and the rule is written down:
`templateStatic` says *"the instantiation is not in the call — it is in the slot the
answer goes into"*, and it is what makes `Vec.create()` and `Option.Some(3)` work.
Nothing applies it to a plain constructor.

`unsupportedValueAt(…, want)` has the slot and handles `Call` where the callee is a
`Member` — the `Vec.create()` shape. A bare `Box(3)` has an `Ident` callee, falls
through to `unsupportedValue` → **`unsupportedExpr`, which takes no `want` at all**,
so by the time the name is looked up the slot is gone. That is the structural reason
rather than an oversight in one branch: the emittability walk drops the expected type
on the way down.

`genericCallInstance` is the resolver for generic *functions* and only walks `case Func`
declarations, so it cannot answer for a struct either.

Both halves need doing together: approving the construction without teaching the
emitter to build it would produce a module that validates and calls a function that is
not there — which is what `corpusEmit`'s "0 invalid" invariant would catch, loudly.
The emitter sites that resolve a call are `emit.wac:3610` and `:4177`, both
`env.funcAt(genericCallInstance(…))`.

## Not the cause

Ruled out by minimal cases, all of which emit: a generic struct whose method only
reads a field; a generic struct built by a helper with explicit arguments; a generic
*function*; a non-generic struct constructor. It is specifically the inference from
the slot.

## Fixed — 2026-08-10, agent-b

A construction resolves its instance from the slot when the call did not name one, in
both halves: `unsupportedValueAt` gained a `Construct` case (it has the slot; the walk
it delegated to does not), and `emitExprAt` resolves `cname` the same way. The struct
validation was extracted to `unsupportedConstructOf` so the two paths cannot drift —
one set of rules answering for a construction however its instance was named.

**Rung 4 went from 290 whole / 52 partial to 335 whole / 7 partial**, with 0 invalid
modules and 0 files missing an export. The 45 files this recovered were nearly the
whole backlog: what remains is 3 imports of files the corpus does not supply and 4
`Shell` declines.

The generated sweep's 4,051 compared answers still all agree, and rung 5 still reaches
its fixed point.
