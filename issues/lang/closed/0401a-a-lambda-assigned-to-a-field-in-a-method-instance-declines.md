# 0401a — a lambda assigned straight to a field inside a method instance declines

- **Status:** closed
- **Fixed in:** the commit that adds `spec/cases/0851`
- **Claimed by:** agent-a
- **Reported by:** agent-a
- **Date:** 2026-10-24
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

```wac
import { Ticket } from "core";
struct Maker { i32 k;
  i32 make<A>(this) { Ticket<A> out; out.drive = () => true; return 1; }
}
export i32 main() { Maker m = Maker(1); return m.make<i32>(); }
```

Expected: builds, exits 1.
Actual: *a call to `Maker.make`, which this expression is emitted as and which was itself declined: a lambda (this module has
1, 1 in a position the walk does not type yet, 0 sharing a position key)*.

## Notes

**Registration order.** A method instance is discovered inside the emittability fixpoint, and its lambdas are recorded
there (`findLambdasInMethodInstance`, called just before its body's types are collected in `emit.wac`). The walk types
`out.drive = …` by the field's type — `walkLvType` → `env.fieldType("Ticket<i32>", "drive")` — and `Ticket<i32>`,
first named by this very method, has no fields registered yet: discovering an instance does not register its fields
until the fixpoint processes it. Collecting the body's types before recording the lambdas was tried and is not enough
for that reason.

What already works: the same body in a generic *function*; a concrete `Ticket<i32> out;` in the method; and any use
elsewhere that registers `Ticket<i32>` first (`Ticket<i32> keep;` in `main` makes the reproduction build). Binding the
lambda to a typed local first (`fn<bool()> d = () => true; out.drive = d;`) avoids it, which is what `std`'s
`Clock.within` does until this is fixed.

## Fixed

`pendingInstanceFieldType` in `emit.wac`: when the lambda walk asks for a field of an instance that is discovered but not
yet registered, the type is the template's field under the instance's arguments — which does not depend on
registration at all — or a plain parent's. Core's `Ticket.first` hit the same gap in any program that named no
`Ticket<i32>` of its own. `spec/cases/0851`.
