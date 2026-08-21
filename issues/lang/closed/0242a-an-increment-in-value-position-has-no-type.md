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

Then green with the arm. And then the first version of the arm broke two spec cases, which is the part
of this worth reading.

## The first fix was wrong, and the grid that said otherwise was measuring the old compiler

`typeOfLvalue` answers `u8` for `a[0]` where `a` is a `u8[]`. So the arm typed `a[0]++` as a `u8`, and
`spec/cases/0106` and `0108` — both of them *about* increment-as-a-value on a packed element, from
`issues/lang/0084` — started failing with *expected i32, found u8*:

```wac
// expect: answers f = 255000
u8[] a = u8[1](fill: 255);
i32 v = a[0]++;
```

The rule was already written down **one arm away**: `case Index` widens a packed element read to `i32`,
with a comment saying *"`i32` exactly, not 'some integer'"* and citing `0170a`. `a[0]++` is a read, so
it widens the same way, and the corrected arm says `isPackedName(it) ? "i32" : it`. Nothing else needed
changing — the case files' own `why:` lines state the value: *"a packed element holds what a
store-and-read leaves — 255, not -1"*, which is an `i32`.

**A dead clause woke when the predicate widened.** The packed-position guard could never fire on
`a[0]++` while the expression had no type at all; giving it one made that guard live, and it was right
about `u8` and wrong about the program.

**And the check that should have caught it before the gate did not, because it ran the wrong
compiler.** The ten-legal-program grid — the spec's own `i32 old = x++; i32 nu = ++x;`, `i64`, `u32`, a
struct field, a `u8[]` element, `a[i++]`, `g(x++)`, the statement form, a `for` update — was run with
`wac check`, and **`wac check` runs the seed**, not the working tree. The seed at that moment was the
compiler from *before* the edit, so the grid faithfully reported that the old code had no false
refusals, which was true and answered nothing. `wac test` on a file importing `../../src/api.wac`
compiles the working tree and is the only probe that sees an unseeded change; that is what
`illtyped_test` and `cases_test` do, and `cases_test` is what found this.

One refusal in that ten is real and pre-existing either way: `u8 n = b[0]++;`, because a `u8` local is
illegal whatever is on the right — `spec/spec/types.md` allows packed types as array elements only, and
`u8 n = b[0];` gets the same message.

Canaried the right way round in the end: with the widening removed, `cases_test` fails on exactly
`0106` and `0108`; with it, they pass. `corpuscheck_test`, `typecheck_test` (rung 3: 0 false alarms, 0
contradicted), `checkalone_test`, `codes_test`, `illtyped_test` and `matcharms_test` are green.
