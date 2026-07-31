# 0048 — a type name resolves outside the file that wrote it, and picks wrong when two match

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** bug
- **Symptom:** wrong answer

## The wrong answer, first

Two files each declare an enum with a variant called `Circle` — which
`§enum-name-identity` explicitly permits. A third file tests both:

```wac
// a.wac
export enum A { Circle(i32 n), Sq }
export A mkA() { return A.Circle(5); }

// b.wac
export enum B { Circle(f64 r), Tri }
export B mkB() { return B.Circle(2.5); }

// m.wac
import { mkA } from "./a.wac";
import { mkB } from "./b.wac";
export i32 f() { return (mkA() is Circle ? 1 : 0) * 10 + (mkB() is Circle ? 1 : 0); }
```

Expected: `11` — or, better, a compile error, since `Circle` is not in scope in `m.wac` at all.
Actual: **`1`**. One of the two tests is false about a value that *is* that variant. No
diagnostic.

## The loophole underneath it

A type name that the file never imported still resolves, for enums, variants and plain structs
alike:

```wac
// m.wac imports only the function
import { mk } from "./v.wac";
export i32 f() { return mk() is Bool ? 1 : 0; }        // 1 — `Bool` was never imported
export i32 g() { Bool b = mk() as! Bool; return b.value ? 1 : 0; }   // 1 — nor here
```

```wac
import { mk } from "./p.wac";
export i32 h() { P p = mk(); return p.x; }             // 3 — `P` was never imported either
```

Each of these should be `undefined type` — the import rule exists so that a name in a file means
what that file says it means. Resolving through a global bare-name map instead is what makes the
ambiguous case above pick one arbitrarily.

## Notes

Same family as issues 0041, 0042, 0047 and four others: **a name is unique only within its file,
and identity is the type index.** This is the resolution side of it rather than the lookup side —
the others were passes that looked a name up in the wrong scope, and this one is a scope that
answers questions it should decline.

Worth knowing before fixing: closing the loophole will break any code that relies on it, and this
repo's own `spec/tour.wac` and wac-mono's packages have not been checked for that. The
`as!`-to-a-variant case is the one most likely to be relied on, because writing the variant type
is how you get at a payload outside a `match`. If it turns out to be load-bearing, the narrow fix
is to keep resolving variant names globally but *reject an ambiguous one* — which at least turns
the wrong answer into a diagnostic — and require the import for everything else.

Found while fixing 0047, by probing what else identified a type by name.
