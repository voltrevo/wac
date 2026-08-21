# 0247a — `i32 n = 1 + "a";` drew two diagnostics, and 0245a is what made it

- **Status:** closed
- **Closed by:** agent-a, 2026-08-21 — same day it was introduced, by widening the sweep that
  introduced it
- **Fixed in:** `packages/wacc/src/check.wac`, with six rows in
  `packages/wacc/test/wac/binaryoperands_test.wac`
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** diagnostic
- **Symptom:** wrong answer — one fault, two diagnostics

## Reproduction

```wac
export i32 f() { i32 n = 1 + "a"; return n; }
```

Expected: one diagnostic. The reference gives one — *"type mismatch in '+': i32 and string"* — and so
did wacc until this morning.

Actual: two. The operand rule reports the mismatched literal families at the `+`, and then the
initialiser reports *expected i32, found string* as well.

## `0245a` did this, and its canary could not see it

`0245a` gave a string literal a type in `typeOfExpr`'s `Binary` arm, on the correct grounds that `"a"`
is a `string` wherever it goes while `1` is polymorphic. For `1 + "a"` that makes the *left* operand
contribute nothing and the *right* contribute `"string"`, so the arm answers `"string"` — where it used
to answer unknown because both operands were literals. Unknown was doing a job: it kept the slot rule
quiet about a fault the operand rule had already named. Which is the rule this arm states three
separate times in its own comments, for a rejected operand, for a `string` under a non-`+` operator,
and for a `bool` under an arithmetic one.

**The canary had fifteen rows and not this one.** It pinned `"a" + "b"` (two strings), `true + false`
(two bools), `t.a + t.b + t.c` (three named strings, the chain that must report once), `"a" + s`, and
nine legal programs. A *mixed* literal pair — one polymorphic side, one not — is the only shape where
the change gives exactly one operand a type, and it is the only shape that broke. Fifteen rows, and the
missing one was the case the change was specifically about.

## The fix

The rule already written three times, applied to the pair `0245a` newly typed:

```wac
if (lk != litNone() && rk != litNone() && lk != rk && lk != litNull() && rk != litNull()) {
  return typeNone();
}
```

Two literals of different families answer nothing, because the operand rule has spoken. `null` is
excluded for the reason it always is — `c ? 1 : null` is a shape the spec writes.

Counts after, all matching the reference at one: `1 + "a"`, `(1 + 1) + "a"`, `1 + true`, `true + "a"`,
`"a" + true`, and `x + (1 + 1)` still legal at zero.

## How it was found

Not by a test. By carrying `issues/lang/0244a`'s question — *which guards ask the narrow literal
test* — to the last two `litKindOf` sites in the `Binary` arm, and printing the count for each program
beside its compound twin. `(1 + 1) + "a"` was 1 and `1 + "a"` was 2, and a pair that disagrees is worth
looking at whichever direction it disagrees in. I was looking for another silence and found noise.

**What to take from it.** The sweep that introduces a regression is often the sweep that finds it, one
step later, and the step is *widening the table by one shape*. The fifteen-row canary was not careless
about counts — counts were the whole point of it — it was careless about which programs the change
could reach. Related: `issues/lang/0238a` for the invariant, `0245a` for the change.
