# 0046 — an unknown type name in a declaration or a cast is not reported as unknown

- **Status:** closed
- **Fixed in:** this commit, with issue 0048
- **Claimed by:** agent-a
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

## Fixed (agent-a, 2026-07-31)

Same pass as 0048, because it is the same absence: nothing checked a type name where it was
written, so an unknown one was reported by whatever tripped over it later. Six positions are
covered by `§wac-type-name-scope-8vqk3mn` — a declaration, a cast target, a parameter, a return
type, a field and an array element type — and each says `undefined type 'Nope'`.

The two assertions this issue asked to tighten, in the `§wac-generic-enum-7dkq2mv` tests, are still
loose: a generic enum's variant named as a type is now reported by the *resolver*, which carries no
hint, so the checker's better message — the one that names the enum and says to use `match` — is
left to win by having the resolver skip those names. The assertion that matters is the hint, and it
has its own test.
