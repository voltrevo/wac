# 0272b — a `bool` compared against an integer *literal* is accepted, and the bool is used as a number

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
