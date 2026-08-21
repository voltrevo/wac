# 0238a — one fault, two diagnostics at one position, and nothing counts them

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** diagnostic
- **Symptom:** wrong answer — a list that says how many things are wrong, wrongly

## The invariant is written down and enforced nowhere

`check.wac` states it while explaining a fix that has already been made once:

> `report` already refuses the same code twice at one position for the reason that applies to two
> different codes just as well: **a list that says it twice disagrees about how many things are
> wrong.**

`report` dedupes a repeat of the *same* code at a position. Two *different* codes at one position is
the case that comment says is equally wrong, and nothing checks it.

## Measured: every multi-diagnostic program in the sample

53 ill-typed programs — the ones written while walking the reference's rule tables. **46 report at least
one diagnostic, 4 report more than one, and all 4 of those put both at the same position.** The
reference reports one for each of the four.

So in this sample "wacc said two things" and "wacc said one thing twice" are the same set. That is not a
law: `b.map<i32>((i32 x) => x + 1)` reports three at three *different* positions, and is outside the
sample because it came from a different day's work. But it means the duplicate case is not a corner —
it is what reporting more than once currently looks like.

Two distinct shapes:

**An operand fault and its own consequence.**

```wac
export i32 f(string s) { return ~s; }
```

    wacc       1:33  return type does not match the function's
               1:33  this operator does not take an operand of that kind
    reference  1:33  '~' requires i32 or i64, got string

The return type disagrees *because* the operand is wrong. One fault, reported as its cause and its
effect, at one position.

**Two operand rules for one operand.**

```wac
export i32 f(string s) { return s % 2; }
```

    wacc       1:35  this operator does not take an operand of that kind
               1:35  operands have mismatched types
    reference  1:35  '%' requires numeric type, got string

`-b` on a bool is the same shape as the first, and `~s` appears twice in the sample.

## Why nothing caught it

`mutateCheck.test.ts` is the differential that should own this. It asserts *"every position we report on
a rejected program is one the reference reports"* — a **subset** relation, which a duplicate satisfies
twice over. It prints recall per rule and never compares counts.

`parse_errors.test.ts` does compare counts, and says so — *"Compared by count and position, not by
message"* — but only for parse errors. The typecheck phase has no equivalent.

So the shape is invisible by construction, in exactly the way `issues/lang/0237a`'s pair was: that one
was found by hand, reading the output of a program I happened to run twice.

## The instrument

One counter in `mutateCheck.test.ts`, over the same 4,594 mutants it already walks:

```ts
if (new Set(mine).size !== mine.length) { duplicated++; … }
```

### Landed, and the corpus says 24 of 1,189

    rung 3 mutation sweep: 1189 broken programs, 1185 reported (100%), 0 contradictions
    24 program(s) reported two diagnostics at one position:
      1:42 1:42 in: export string f() { i32 x = -1; return x as i32; }
      1:39 1:39 in: export bool f() { i64 x = 1; return x as@ f64; }
      1:39 1:39 in: export bool f() { u64 x = 1; return x as f64; }
      1:41 1:41 in: export bool f() { f64 x = 1.5; return x as! f64; }

**2%, and every example is one shape**: a cast the checker has something to say about, in a function
whose return type the cast's result does not match. Both rules fire, both at the cast. That is the same
shape as `~s` in an `i32` function above — a fault reported alongside the consequence it caused — which
makes it the shape to fix first, and probably the whole of the 24.

The fix is a question about precedence rather than about either rule: when an expression has already
been reported at a position, the *slot* rule that only disagrees because of it has nothing to add.
`report` refuses a repeat of one code at a position for exactly that reason; what is missing is the same
judgement across two codes, which is what this issue asks for and what the counter now measures.

**Verified to see the class before being landed**, through the same API it will use: `dumpTypeErrors`
on `~s` in an `i32` function answers two entries at `1:33` and on `s % 2` two at `1:35`, while `6 & 3`
answers none. An instrument that cannot see a case it is being added for is the failure mode this
repository keeps finding, so it is worth the two minutes.

Printed rather than asserted, because the number is not zero and a threshold that starts red is a
threshold nobody can land. The queue-not-a-gate treatment that file already gives recall is the right
model: print the count and the worst examples, fix them as they are reached, and assert zero when it is
zero.

## Why it matters

A reader counts diagnostics to decide how much is wrong. Two lines for one fault says the program has
two problems, and the second line sends them to look for a second cause that does not exist — which is
the same cost as a message that misdescribes (`issues/lang/0237a`) and the reason the comment quoted
above exists.

It is also a differential disagreement in a direction nothing measures: wacc says more than the
reference here, and every check we have is built to catch it saying *less*.
