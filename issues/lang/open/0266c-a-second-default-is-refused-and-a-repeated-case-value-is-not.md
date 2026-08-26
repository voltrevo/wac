# 0266c — a second `default:` is refused and a repeated `case` value is not

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-25
- **Kind:** decision — should a repeated case value be an error
- **Symptom:** unreachable code accepted silently

## Measured

Both compilers refuse two `default:` arms, and say why:

    export i32 f(i32 n) { switch (n) { default: { return 1; } default: { return 2; } } return 0; }
    error: switch may have at most one 'default' clause        (reference, at the second `default`)
    error: a switch cannot have two defaults                   (wacc, same column)

Neither refuses two identical `case` values:

    export i32 f(i32 n) { switch (n) { case 1: { return 1; } case 1: { return 2; } } return 0; }
    reference: accepts, `f(1)` answers 1
    wacc:      accepts, `f(1)` answers 1

They agree, so no differential can see this and none of the rungs is wrong. The first arm wins in both,
which is the sane choice if the program is accepted at all.

## Why it is worth a decision rather than a shrug

The two clauses are the same statement making the same mistake. A second `default:` is unreachable
code, and it is refused with a message that names the rule; a second `case 1:` is unreachable code for
exactly the same reason, and it is accepted. Whatever the right answer is, it is hard to argue the
answer differs between them.

The wac side already owns the vocabulary: `errDuplicateCase` exists in `check.wac` and is reported for
a *variant cased twice in a `match`* — `case A: … case A:` — which is the same fault one construct
along, and refused there. So a `switch` is the odd one out among three neighbours rather than one of
two.

`spec/spec/control.md` does not settle it: the `switch` grammar shows a single `default` and says
nothing about repeated case values.

## The options

1. **Refuse it**, reusing the `match` rule's shape: report at the second `case`, naming the value. This
   is consistent with the two neighbours and cannot break a correct program — a repeated case value is
   dead by construction. It *can* break a program someone wrote by accident and is relying on, which is
   the argument for checking the corpus first; nothing in this repository writes one, or the rule
   would already be red somewhere.
2. **State that it is allowed and first wins**, as a spec clause with a case. Cheaper, and it makes the
   current behaviour a decision instead of an omission. It leaves the asymmetry with `default:` and
   `match` standing, which then wants a sentence explaining why.
3. **Leave it undecided**, which is where it is, and where the next person to notice spends the same
   half hour deciding whether it is a bug.

Only 1 needs the reference to move as well, and only if parity of *refusals* matters here — it accepts
this today, so wacc refusing it would be a divergence in the safe direction, of the kind
`packages/wacc/README.md` already records elsewhere.

## How it was found

Walking the diagnostic codes for ones no generated program reaches, and writing a minimal program for
each. This one turned up as *silence from both sides*, which is the category that walk is worst at
noticing — a code that is never reported looks identical to a code whose rule is simply never broken.
