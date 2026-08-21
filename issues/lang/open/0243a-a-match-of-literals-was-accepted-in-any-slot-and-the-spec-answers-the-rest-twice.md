# 0243a — a `match` of literals went in any slot, and the spec answers the remainder twice

- **Status:** open — the silent half is fixed; what is left is a decision the spec makes twice and
  differently
- **Fixed so far:** `litFamily` in `packages/wacc/src/check.wac` gained the `MatchExpr` arm, with five
  rows in `packages/wacc/test/wac/illtyped_test.wac` and five in
  `packages/wacc/test/wac/matcharms_test.wac`
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** decision
- **Symptom:** was invalid wasm — a build with the exported function missing and exit 0; now a question
  about which spec sentence governs

## Reproduction

```wac
enum E { A, B }
export i32 f(E e) { string s = match (e) { case A: 1, else: 2 }; return s.len(); }
```

Expected: refused. `spec/spec/enums.md` `[§enum-match-expr-4wnq7bk]` says the arms unify *"exactly as a
ternary's two branches are (see control.md), and by the same code"* — and the identical program written
with `?:` **was** refused:

    string s = b ? 1 : 2;                        → initialiser does not match the declared type
    string s = match (e) { case A: 1, else: 2 }; → no diagnostics

Actual: accepted by the checker *and* the emitter, so a build wrote a module with no `f` in it and
exited 0.

Every family, not just this one. All five were silent:

| program | slot | ternary form | match form |
|---|---|---|---|
| `1`, `2` | `string` | refused | accepted |
| `1`, `2` | `bool` | refused | accepted |
| `"x"`, `"y"` | `i32` | refused | accepted |
| `true`, `false` | `i32` | refused | accepted |
| `1`, `2` | `f64` | refused | accepted |

The last row is worth its own line: `f64 d = 1;` is refused on its own — an integer literal does not
adapt to a float type in wac — so the match was accepting something neither the bare literal nor the
ternary would.

## Why nothing caught it

`typeOfExpr`'s `MatchExpr` arm answers `typeNone()` for an all-literal match **on purpose**, and its
comment says why: the arms take the type expected of the whole expression, so the match has no type of
its own, and *"a literal cannot be asked what it is here"*. That is right. But unknown is silence
unless the *literal* path picks the expression up, and `litFamily` — the function that exists exactly
to answer "what family of literal is this compound expression made of" — had an arm for `Binary`, an
arm for `Ternary`, and none for `MatchExpr`.

So this is `0242a`'s shape one layer over: not a missing rule, a rule that could not see its input.
Both were found the same afternoon by the same method — enumerate the constructs a dispatch names,
and ask what the `else` swallows.

The `Ternary` arm carries a warning that applies here and was checked rather than assumed: making a
node a literal *leaf* means callers that take the literal path stop walking inside it, and doing that
to a ternary once cost `i32 n = p is null ? 1 : 0;` its warning and cost the reach sweep
`Ternary-cond` (`issues/lang/0145`). Measured after this change, all seven still fire on an
all-literal match — undefined subject, non-total, duplicate case, two `else` arms (the one that
*trapped the compiler* before `0239a`), an unknown variant, a non-enum subject, and the `is null`
warning inside an arm.

## The decision: mixed integer and float arms, where the spec says two things

Left exactly as it was — `litNone()`, so nothing checks it — because the answer is not this arm's to
pick:

```wac
f64 d = match (e) { case A: 1, else: 2.5 };   // accepted, by silence
f64 d = b ? 1 : 2.5;                          // refused: "the two branches have unrelated types"
i32 n = match (e) { case A: 1, else: 2.5 };   // accepted, by silence — and should not be
```

* **`spec/spec/enums.md:513`** — *"an integer or float literal arm takes the type expected of the whole
  expression"*. Under this, the first is legal (both arms are `f64`), the second should also be legal,
  and the third is an error.
* **`spec/spec/control.md:256`** — *"A float literal in a ternary still types as `f64` regardless of
  context, so `f32 x = cond ? 1.5 : 2.5;` is a type error and needs an explicit cast. That is a
  separate gap in literal typing, not in the ternary."* Under this, a float literal does not adapt, so
  the second is correctly refused and the first should be too.

They cannot both hold for a construct `enums.md` says is *the same code* as the other. wacc currently
implements `control.md` for the ternary and neither for the match.

**Recommendation: make `enums.md` the rule and fix the ternary to match**, i.e. an integer or float
literal branch takes the slot's type in both constructs, and `f64 d = b ? 1 : 2.5;` becomes legal.
Reasons: it is the more specific sentence and the newer one; `control.md` calls its own behaviour *"a
separate gap in literal typing"* rather than a design, which reads as a description of what the
reference does; and it makes the third program above an error, which no reading defends. The cost is
that the reference then refuses two programs wacc accepts, which is already true here (`0243a`'s
`f64`/`2.5` row) and is what rung 3's known-divergence list is for.

The alternative — make `control.md` the rule and refuse literal adaptation in both — is cheaper by one
edit and makes `spec/spec/enums.md:513` wrong, so it needs that sentence changed rather than left.

## Notes

The five rows are in `illtyped_test` because they are expression-level, and the five accepting
counterparts are in `matcharms_test`'s `test_the_ordinary_matches_are_accepted` because the way to get
this fix wrong is to refuse those. After it: `corpuscheck` green over the whole repository,
`typecheck` rung 3 with 0 false alarms and 0 contradicted, `specsingle` 371 silent with 0 false alarms,
`specmulti` 42 silent with 0 false alarms.
