# 0272b — a `bool` compared against an integer *literal* is accepted, and the bool is used as a number

- **Status:** closed
- **Fixed in:** `packages/wacc/src/check.wac` — `boolMix`, beside `strMix` in the comparison rule.
  Guarded by `packages/wacc/test/wac/illtyped_test.wac` rows a35–a37.
- **Claimed by:** agent-b (2026-08-28)
- **Reported by:** agent-b
- **Date:** 2026-08-27
- **Kind:** bug
- **Symptom:** wrong answer — accepted by the checker, emitted, and evaluated as arithmetic on a `bool`

`bool` and `i32` cannot be compared, and wacc says so — unless the integer is a literal, in which case
it compiles and the `bool` is treated as a number.

## Reproduction

```wac
export i32 main() { bool b = true; i32 y = 0; return b > y ? 1 : 0; }
```

    error: operands have mismatched types          # correct

```wac
export i32 main() { i32 x = 1; return (x < 2) > 0 ? 1 : 0; }
```

    1 file(s), no diagnostics                      # accepted

and it runs, with the `bool` standing in for an integer:

    (x < 2) > 0     answers 1        # true > 0
    (x < 2) > 5     answers false    # true > 5

So `true` is being compared as `1`. Nothing in the language says a `bool` has a numeric value —
`spec/spec/types.md` gives it no conversion to an integer, and the variable form above is refused for
exactly that reason.

## The reference refuses it

```
error: type mismatch in '>': bool and i32
  --> boolcmp.wac:1:62
```

So this is a divergence as well as a gap, and the reference's message is the better one — it names
both types and the operator.

## Why the literal is the difference

The two operands go down different paths. Against a *variable* the checker compares two computed
types and they disagree. Against a *literal* the literal has no type of its own and takes one from
context — and the context it is offered is the comparison, which hands it the other operand's type
without first asking whether that type is one an integer literal may be. `bool` is not, and nothing
says so.

That shape is worth stating because it is not specific to `>`: any rule that types a literal from the
other operand has the same hole, and the fix should be a check on the *family* the other operand
belongs to rather than a special case for `bool` under `>`.

## How it was found

Writing `spec/cases/0238` for `design/lang/0011`, which needed a double comparison whose operands are
not spellable as types. `count < list.len() > 0` checked clean and I expected `bool > i32` — the
design case was rewritten to avoid depending on it, and this is the thing that made it suspicious.

## Notes

**Not urgent, and cheap.** No file here writes it: the corpus has no comparison whose left side is a
`bool`-valued expression, which is why nothing has caught it. What makes it worth filing rather than
noting is that it is a silent wrong answer rather than a missing diagnostic — the module builds and
computes something the language does not define.

**A guard belongs in `illtyped_test.wac`**, which is where the other "checker accepted it, emitter
was happy, engine ran it" families live, and which already carries the four `x < i32` type-name cases
that came from the same neighbourhood (`issues/lang/0235a`).

## Fixed, 2026-08-28 — and not where this page proposed

This said the fix *"should be a check on the family the other operand belongs to rather than a
special case for `bool` under `>`"*. The family part was right; the place was not.

**The rule already existed.** `check.wac`'s comparison arm reports *"these types cannot be
compared"* and already asks this exact shape one type along:

```wac
bool strMix = nl != typeNone() && nr != typeNone() && (nl == "string") != (nr == "string");
```

`bool` needed the same line, and `naturalTypeOf` is what makes the literal visible — it fills `1`
in as an integer, so the pair is `bool` against `i32` rather than `bool` against nothing. That arm
runs *before* the literal branch returns, which is why the literal escaped it.

Putting a general family check in the literal branch, as proposed above, would have been wrong
twice: `s > 1` is already caught by `strMix` and would have been reported twice, and
`acceptsLiteral` is not the predicate it looks like — it answers about a *declaration slot*, so it
says `f64` does not accept an integer literal, and `f64 x; x + 1` is legal.

**The hole was narrower than the title.** Measured across the operators, only the comparisons let a
`bool` through; `+`, `*` and `&` are already refused by the operand-kind rule, which wants numbers.
So this is `>`, `<`, `>=`, `<=`, `==` and `!=` and nothing else.

## A test was pinning the defect

`packages/wacc/test/wac/typeargsrule_test.wac` asserted that `count < list.len() > 0` compiles
clean — the program in *How it was found* above, verbatim. Its intent was that a comparison against
a call is not read as a type-argument list, which is a real thing to check; the program it chose to
check it with was ill-typed for an unrelated reason, and the assertion held only because of this
bug. It uses `spec/cases/0238`'s shape now — `g(count < list.len(), count > 0)`, both `<` and `>`
present and both operands typing — which is the program that case was *"rewritten to avoid
depending on it"* when this was first noticed. It asserts the refusal too, so a regression cannot
pass it by going quiet again.

Verified: three rows fail without the change, on both of `illtyped_test`'s properties — the checker
accepting it, and the checker and emitter both accepting it so a bad module is built.
`packages/wacc/test/wac` 79 of 79; no false alarm over the repository; the spec's acceptance corpora
unchanged.
