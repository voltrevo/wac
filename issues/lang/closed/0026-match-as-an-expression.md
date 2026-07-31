# 0026 — `match` is a statement, not an expression

- **Status:** closed
- **Fixed in:** 43ba1df
- **Fixed by:** agent-a, 2026-07-31
- **Reported by:** agent-a
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Covered by:** `§enum-match-expr-4wnq7bk`
- **Symptom:** not implemented

## Reproduction

```wac
enum Shape { Point, Circle(f64 radius) }

f64 area(Shape s) {
  f64 a = match (s) {          // not accepted
    case Point:     0.0,
    case Circle(r): 3.14159 * r * r,
  };
  return a;
}
```

Expected: eventually, some expression form.
Actual: `match` is a statement only. The workaround is a `return` in every arm, or a
mutable local assigned in each arm.

## Notes

Deferred deliberately when enums landed and recorded in enums.md under "What this is not,
in this draft". Filed now so it is tracked rather than only described.

The work is result-type unification across arms — the same problem the ternary already
solves for two branches (closest common ancestor, plus the `null` widening added in issue
0011), generalised to n. Reusing that logic rather than writing a second copy is the point
to get right; two places computing one type is how the i64-literal and ternary-variant bugs
happened.

Also needs a syntax decision. The statement form reuses `case X:` with statement bodies,
so an expression form needs a way to write "this arm's value" — an expression after the
colon and a comma separator, as sketched above, or `=>`. The sketch keeps one arm syntax;
`=>` reads better for a single expression. Worth deciding before implementing, not during.

Lower value than it looks: the statement form is what a tree walk needs, and every consumer
so far (`wacc`'s printer, `json`, `fmt`) wanted a `return` per arm anyway.


## Resolution (agent-a)

Syntax: `case P: value,` — the sketch in the notes rather than `=>`, because the arm header
then stays identical to the statement form and there is one arm syntax to learn. Which form
is parsed is decided by position, so nothing is ambiguous. A trailing comma is allowed, as
everywhere else.

The note said reusing the ternary's unification "is the point to get right". Two extractions
rather than two implementations:

- **`unifyBranches`** — the ternary's logic, now shared. This is why a `null` arm widens the
  result and an integer or float literal arm takes the expected type without either rule
  being written twice. The ternary had already had to learn both (0011 and 0001); a copy
  would have had to learn them again.
- **`checkMatchArms`** — the entire arm analysis, with a callback for what an arm holds.
  Variant resolution, positional bindings, `_`, the narrowing shadow, duplicate and
  unreachable-arm checks, exhaustiveness. The narrowing rule is subtle enough that two
  versions would drift.

The emitter keeps `emitMatch` and `emitMatchExpr` separate — a void block and a result block
differ at every step, and a merged version would be a parameter-driven fork throughout — but
they share `bindArm`, so an arm's bindings come into scope identically either way.

An expression match must be **total**, which is stricter than the statement form: there is no
falling off the end of an expression.

## The bug this nearly shipped with

`collectLocals` walked only statements. That was correct until now, because no expression
declared a local — and a match expression does. A payload binding in a match nested inside a
var initialiser therefore got no slot, read as nothing, and left the stack one short at
validation, with an error about `i32.mul` needing two arguments and nowhere near the cause.

Found by testing every position rather than the first one. The walk now visits every
expression position from every statement, and the comment there says why the calls exist,
because the reason is not obvious from reading it.

Same family as issue 0005: a new AST node needs every walk updated, and here the walk did not
exist yet.
