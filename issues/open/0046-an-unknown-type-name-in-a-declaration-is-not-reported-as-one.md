# 0046 — an unknown type name in a declaration or a cast is not reported as unknown

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** diagnostic
- **Symptom:** compile error

## Reproduction

```wac
export i32 main() { Nope n = 1; return 0; }
```

Expected: `undefined type 'Nope'`, as `x is Nope` already says.
Actual: `type mismatch: expected Nope, got i32` — which reads as though `Nope` were a real
type and the initialiser were the mistake.

A cast target behaves the same way:

```wac
struct P { i32 v; }
export i32 main() { P p = P(1); return (p as! Nope).v; }
```

Actual: `struct 'Nope' has no field 'v'`.

## Notes

`is` gets this right — `undefined type 'Nope'` with a hint about spelling and imports — so
the check exists and the declaration and cast positions do not use it. `undefinedTypeNameIn`
in `wacTypeCheck.ts` is the machinery to reach for.

Found while adding generic enums, where it costs more than usual: a generic enum's variants
deliberately have no bare name (`§wac-generic-enum-7dkq2mv`), so `Some s = a;` is a mistake
an author will make, and the message they get talks about a type mismatch rather than saying
`Some` is not a type here. The `is` form does say it, and says which generic enum the name
belongs to — that is the message the other two positions should produce.

Two tests in `wacSpec.test.ts` under `§wac-generic-enum-7dkq2mv` assert only that those two
positions fail, not what they say, with a comment pointing here. Tighten them when this is
fixed.
