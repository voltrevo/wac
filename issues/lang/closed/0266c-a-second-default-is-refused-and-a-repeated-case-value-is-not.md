# 0266c — a second `default:` is refused and a repeated `case` value is not

- **Status:** closed, 2026-08-26 — option 1, in both compilers
- **Fixed in:** 0176b57d
- **Claimed by:** agent-a, 2026-08-26 — taking option 1
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

## Claimed, with the corpus counted rather than predicted — agent-a, 2026-08-26

**Option 1.** The argument below is stronger than the one this issue makes for it, and the corpus
question it raises is now answered.

### Nothing here writes one, and that is a count now

This page said *"nothing in this repository writes one, or the rule would already be red somewhere"*,
which is a prediction. Scanned, tracking brace depth from each `switch (` so a nested switch's arms are
not read as the outer one's, with comments and string literals stripped first:

| where | files | `switch` sites | duplicate case values |
|---|---|---|---|
| every `.wac` in the tree | 1,431 | 30 | **0** |
| `spec/`, `compiler/`, `spec/cases/`, wacc's tests | 384 | 125 | **0** |

So refusing it breaks nothing. **And the same measurement is the argument against over-reading this
one:** 30 `switch` sites in 1,431 files is thin evidence, because `match` is the idiom here and
`switch` is rare. "No fallout in this repository" is what the numbers support; "nobody writes this" is
not.

### The rule cannot go where the `default` rule went

This is the part that decides the implementation, and it is not in the options above.

The duplicate-`default` check both compilers already have is in the **parser** —
`compiler/wacParse.ts:1316`, *"switch may have at most one 'default' clause"* — and it can be, because
`default` is a keyword and *have I seen one* is syntactic.

**A repeated case *value* is not syntactic.** `case 1:` and `case 0x1:` are the same value written two
ways, and a `u32` scrutinee makes `case -1:` and `case 4294967295:` the same 32 bits — which the spec
explicitly blesses at `[§wac-switch-u32-r5nk8wf]`. A token-comparing check passes all three of those
pairs and looks like it works, which is the worst way for this to be wrong: a rule that catches the
obvious spelling and misses the confusing one is worse than no rule, because it is now trusted.

So it belongs in the checker, where the constant value is known. Which is also where `match`'s
`errDuplicateCase` lives (`check.wac:9135`, code 59) — so the three neighbours are not merely
*consistent*, they are one rule split by what has to be evaluated to decide it.

**The test has to carry those pairs**, not just `case 1: case 1:`, or it passes against the wrong
implementation.

### Scope

`packages/wacc/README.md`: *"The spec is the contract; the reference is a guide… where the two disagree
the spec decides, and the reference has been the one in the wrong before"* (`issues/lang/0085`). So
rung 3 does not block wacc from refusing what the reference accepts — but a spec example carrying
`// error:` is held to being an error **against the reference** by `compiler/wacSpec.test.ts`. Writing
the rule down properly therefore moves both, and not for parity: because the spec is the contract and
the reference is tested against it.

### The rule is partial, and `issues/lang/0269a` is why

Found while looking for how a case value becomes a constant: **it does not have to be one.** Both
compilers accept `case k:` where `k` is a parameter, and it works — `compiler/wacEmitFunc.ts`'s
`emitSwitch` is an if-else chain and says *"br_table optimization can come later"*, so the case
expression is emitted and compared at run time.

That bounds this rule. A duplicate check can only compare values it can evaluate, so what goes in is:

> two case values that are **both compile-time constants** and equal, in the same `switch`, are an
> error at the second one.

`case k: … case k:` stays accepted, and that is not an oversight to fix here — it is `0269a`'s
decision. If that issue takes option 1 and requires a constant, this rule becomes total with no
further change.

Worth saying plainly because the partial version is the kind of thing that later reads as a bug: the
header of the check, the spec clause and the test all say **constant**, so nobody has to rediscover
why `case k:` twice is quiet.

## Done — agent-a, 2026-08-26

**Refused in both**, reported at the second arm. `spec/spec/control.md` `[§wac-switch-dupcase-7hq2nkv]`
is the rule; `packages/wacc/test/wac/illtyped_test.wac` is the test, beside `0239a`'s duplicate-`else`
and duplicate-binding cases, which are the same rule one construct along.

| program | wacc | reference |
|---|---|---|
| `case 1: … case 1:` | refused | refused |
| `case 1: … case 0x1:` | refused | refused |
| `case 4294967295:` twice, `u32` | refused | refused |
| `case 4294967295: … case 0xFFFFFFFF:` | refused | refused |
| `case 4294967295: … case -1:`, `u32` | refused | refused |
| `case -1: … case 1:` | accepted | accepted |
| `case 1: … case 2:` | accepted | accepted |
| `case k:` for a parameter | accepted | accepted |

### A code of its own, not `errDuplicateCase`

Reusing 59 was the plan and it was wrong the moment it ran: it reported *"duplicate case for the same
variant"* at `case 1: … case 1:`, a sentence about a construct the program does not contain. The
precedent was already in the same file — `errDuplicateElse`'s doc comment says *"A code of its own
rather than `errDuplicateCase`, whose message names a variant"*, decided by `0239a`. So
`errDuplicateCaseValue`, code 207, *"two cases of this switch have the same value"*.

### What the canary found, which was not what it was looking for

The checker compared `v & 0xFFFFFFFF` and then wrapped to two's complement, with a comment saying the
mask alone would leave `-1` and `4294967295` 2^32 apart. Removing the wrap broke no test — so it looked
untested, and the missing row was found and added: `case 4294967295:` beside `case -1:` under a `u32`
scrutinee, which both compilers refuse and which is a real duplicate, measured (a `u32` holding
`4294967295` matches `case -1:`; one holding `1` does not).

**Then the canary still passed.** The wrap was not untested, it was *redundant*: `-1 & 0xFFFFFFFF` is
already `4294967295`, so the mask canonicalises on its own and the wrap is a bijection on the result —
which cannot change an equality. The comment justifying it was reasoning nobody had run. It is gone;
`switchCaseValue` is one line.

The row stayed, for the other reason: it is a duplicate somebody could plausibly write, and the only
case in the test where the two arms disagree about sign.

### Left open on purpose

`case k:` — a non-constant case value — is accepted, so two arms equal only at run time are not
refused. That is `issues/lang/0269a`, filed while working this: both compilers accept a parameter as a
case value and it works, while the spec justifies the 32-bit restriction *by* `br_table`, which cannot
dispatch on a value it does not know. If that issue requires a constant, this rule becomes total with
no change here.
