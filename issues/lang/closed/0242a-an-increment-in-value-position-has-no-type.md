# 0242a — `x++` has no type, so it can go anywhere

- **Status:** closed
- **Closed by:** agent-a, 2026-08-21 — one arm in `typeOfExpr`
- **Fixed in:** `packages/wacc/src/check.wac`, with four rows in
  `packages/wacc/test/wac/illtyped_test.wac`
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** bug
- **Symptom:** invalid wasm — and, through `example/wacc.wac`, a build that exits 0 with the exported
  function missing

## Reproduction

```wac
export i32 f(i32 x) { string s = x++; return s.len(); }
```

Expected: a type mismatch — `spec/tour.wac:194` is explicit that *"`++`/`--` ARE expressions, prefix
and postfix, on i32/i64 lvalues. As in C, `i32 old = x++;`"*, so this assigns an `i32` to a `string`.
The reference refuses it: `type mismatch: expected string, got i32`.

Actual: `wac check` answered *no diagnostics*, and `wac build` wrote a module the engine will not load:

    wac: the build wrote …/incr.wasm and the engine will not load it, so the compiler emitted
    something invalid rather than refusing the program

which is the good end of the failure. Through the checked path `example/wacc.wac` takes, the same
program builds with exit 0 and no `f` in the module — the shape `issues/lang/0155` and `0170a` are
about.

## The operand had a rule; the result had no type

`checkIncr` is thorough about what is being incremented — a `bool`, an `f64`, a string, a struct and an
enum are all refused with *"increment needs an integer"*, and its docstring records that this was
widened from the two float names precisely so that "a struct or a string incremented quietly" would
stop. So the guard was not missing and was not blind.

What was missing is one line further out: `typeOfExpr` had no `case Incr`, so it fell to
`else: { return typeNone(); }`, and **unknown is silence** everywhere downstream. Both directions of
the same expression were therefore inconsistent — wacc knew `q++` on a bool was wrong, and did not know
what `x++` produced.

Four spellings, because one arm serves all four:

| | |
|---|---|
| `string s = x++;` | postfix, initialiser |
| `string s = ++x;` | prefix |
| `string s = x--;` | decrement |
| `g(x++)` where `g` takes a `string` | argument, not an initialiser |

The fix answers with what the guard already computed:

```wac
case Incr(target, op, prefix): { return typeOfLvalue(c, target); }
```

## How it was found, which is the part worth keeping

Not by a failing test — by enumerating `ExprKind` against the arms of `typeOfExpr`. 22 variants, 14
named in arms, 8 falling to the `else`. Five of the eight are literals and are *meant* to be unknown
(the `litKindOf`/`acceptsLiteral` channel carries them, so that a literal can adapt to its slot);
`Lambda` has its own rule — *"nothing here wants a function, so this lambda has no type"*; `JsxText`
only exists inside a JSX child. That left `Incr`, and one program confirmed it.

Then the same grid over all 22 kinds — each in a slot its type cannot inhabit — to find the siblings
rather than trust the reading. It found exactly two: this, and an all-literal `match` expression, which
is `issues/lang/0243a` and a different mechanism.

**The first attempt at that enumeration was wrong and said all 22 were missing**, because it looked for
`ExprKind.Incr` when a `match` arm is written `case Incr(…)`. A sweep that indicts everything is
usually the parser, not the code.

## Canary

The four rows were added to `illtyped_test.wac` and watched fail first — both of its oracles, the
second naming the consequence:

    a23 string s = x++: accepted an ill-typed program
    a23 string s = x++: the checker and the emitter both accepted it, so a build writes a module
        with no `f` in it and exits 0

Then green with the arm. Checked for false refusals across ten legal programs — the spec's own
`i32 old = x++; i32 nu = ++x;`, `i64`, `u32`, a struct field, a `u8[]` element, `a[i++]`, `g(x++)`, the
statement form and a `for` update — and `corpuscheck_test`, `typecheck_test` (rung 3: 0 false alarms,
0 contradicted), `checkalone_test` and `codes_test` are green.

One of those ten *is* refused and was refused before this change: `u8 n = b[0]++;`, because a `u8`
local is illegal whatever is on the right — `spec/spec/types.md` allows packed types as array elements
only, and `u8 n = b[0];` gets the same message. Recorded because a new refusal beside a new rule is
worth attributing rather than assuming.
