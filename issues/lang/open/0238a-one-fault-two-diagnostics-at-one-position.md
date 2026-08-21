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

## Correction: 24 of those were not duplicates, and the instrument measured the wrong thing

Everything above about the corpus is wrong, and the mistake is instructive: I checked the reference for
the *hand-made* cases and then generalised its answer to the corpus ones without asking.

    export string f() { i32 x = -1; return x as i32; }

    wacc       1:42  return type does not match the function's
               1:42  this cast is between one type and itself
    reference  1:42  cast from 'i32' to 'i32' is redundant
               1:42  return: expected string, found i32

**The reference reports two as well, at the same position.** And it is right to: the cast is redundant
whatever the function returns, and the return type is wrong whatever the cast does. Two independent
faults that happen to share a position — not a fault and its consequence, which is what I wrote. All 24
corpus hits are of that shape.

So *"no two diagnostics at one position"* is not an invariant. The reference violates it, deliberately,
and a checker that suppressed the second would be hiding a real fault to satisfy a rule nobody stated.
The `check.wac` comment I quoted is about **one fault** reported twice, and co-location is not evidence
of that.

### What the real invariant is, and the instrument that measures it

`issues/lang/0237a` was a **count** disagreement: two diagnostics where the reference gives one, for one
fault. That is the measurable thing, and the parse phase already has it — `parse_errors.test.ts`
compares *"by count and position, not by message"*. The typecheck phase had no equivalent, which is why
`0237a` had to be found by reading output.

So the counter counts the right thing now: programs where **we report more diagnostics than the
reference does**. It flags `0237a`'s shape and leaves the cast cases alone, because there the two agree
at two.

Still printed rather than asserted, for the reason the first version should have been: the number is
whatever it is, and a threshold that starts red is a threshold nobody can land.

### What the real population looks like

Measured, wacc against the reference, one program each:

| program | wacc | reference |
| --- | --- | --- |
| `export i32 f(string s) { return ~s; }` | 2 | 1 |
| `export i32 f(bool b) { return -b; }` | 2 | 1 |
| `export i32 f(string s) { return -s; }` | 2 | 1 |
| `export i32 f(string s) { return s % 2; }` | 2 | 1 |
| `export bool f(string s) { return !s; }` | **1** | 1 |
| `export string f(string s) { return ~s; }` | **1** | — |

The last two rows name the mechanism. `!s` agrees because `!s`'s result is a `bool` and the function
returns `bool`, so no slot check fires; and moving `~s` into a `string` function drops wacc to one
diagnostic. So **a refused unary expression keeps its operand's type**, and the slot check then compares
that type and complains again. One fault, reported once by the rule that caught it and once by the rule
downstream of it.

That is `issues/lang/0170a`'s principle from the other side. Item 2 there stopped `typeOfE` answering for
a binary whose operands disagree, because *"returning an answer for an expression that has none is the
mechanism that defeats every downstream guard"*. Here the same answer does not defeat a guard — it
**wakes** one that has nothing to say.

Two shapes, then:

- **a fault and its consequence**: a unary the operand rule refused, still carrying a type for the slot
  check to disagree with (`~s`, `-s`, `-b`);
- **two operand rules for one operand**: `s % 2` draws `this operator does not take an operand of that
  kind` *and* `operands have mismatched types`, which is the overlap this file's comment says was fixed
  once already.

The first has an obvious repair — a refused expression has no type — and it is the same one-line
principle as item 2, in `checkExpr`'s unary arm rather than `typeOfE`'s binary one. Not done here
because it changes what a population of programs reports and wants its own measurement, which the
counter now provides.

### And the count comparison is a lead, not a law either

The rewritten counter reports **19 of 1,189**. Reading them shows it has the same problem in the other
direction, so this is the second framing I have had to weaken:

    export i32 f() { i32 x = 1; u32 y = 1; return x != y; }

    wacc       1:49  operands have mismatched types
               1:49  return type does not match the function's
    reference  1:49  type mismatch in '!=': i32 and u32

Here **wacc is arguably right and the reference stops early.** `x != y` would be a `bool` even with the
operands fixed, and returning a `bool` from an `i32` function is a second, independent fault. The
reference's `checkBinaryOp` answers `null` for the mismatched comparison, so it has no type to check the
slot with and never gets there. wacc reports both faults.

Contrast `~s` in an `i32` function, where the second diagnostic rests on a type wacc **invented** for an
expression it had just refused — the operand's own type. Fix the operand and there is no second fault;
fix the operands of `x != y` and there still is.

So the distinguishing question is not "how many" and not "at what position". It is *does the extra
diagnostic rest on a type the checker made up for something it refused* — which is `issues/lang/0170a`'s
question, and is not a thing a count can answer.

**What the counter is, then:** a queue of 19 programs where the two compilers disagree about how much is
wrong, each worth one look. Some are ours to fix, some are the reference stopping early, and the
sorting is by hand. That is worth having — nothing else here looks in this direction at all — and it is
not the invariant I twice claimed it was.

### The lesson

Two framings, both too strong, and each was falsified by reading the very examples the instrument had
just handed me — which took one command each time. First *"no two diagnostics at one position"*, refuted
by the reference doing exactly that for two independent faults. Then *"never more than the reference"*,
refuted by the reference stopping early where wacc is right.

The rule I keep re-learning: **an oracle answers the case you gave it.** *"The reference
reports one"* was true of `~s` and `s % 2` and false of every cast in the corpus, and I had no business
carrying it across without a second run — least of all into an issue whose whole point was that
something had gone unmeasured.

## The unary shape is fixed, and the corpus could not see it

`typeOfExpr`'s unary arm answered the **operand's** type:

```wac
case Unary(op, operand): {
  if (tokenKind(c, op) == kBang()) { return "bool"; }
  return typeOfExpr(c, operand);
}
```

So `~s` was a `string`, and the slot rule then disagreed with the `i32` return type — a second
diagnostic resting on a type invented for an expression the operand rule had already refused. It answers
unknown for a rejected operand now, and unknown is silence.

The two conditions were already spelled out at the reporting site, so they are **factored rather than
mirrored** — one `unaryAccepts` predicate that both the reporting site and `typeOfExpr` read. Mirroring
is what `issues/lang/0236a` got wrong four hours earlier, and the site's own comment already wanted this:
*"the question is now asked of one predicate instead of being spelled out per rule"*. All three unary
operators go through it now, so no row of it is dead.

Measured:

| program | before | after |
| --- | --- | --- |
| `export i32 f(string s) { return ~s; }` | 2 | **1** |
| `export i32 f(bool b) { return -b; }` | 2 | **1** |
| `export i32 f(string s) { return -s; }` | 2 | **1** |
| `export bool f(string s) { return !s; }` | 1 | 1 |
| `export string f(string s) { return ~s; }` | 1 | 1 |

**And the corpus moved not at all: still 19.** The mutation sweep contains no unary in a mismatched
slot, so the counter this issue landed cannot hold this fix — which is why the test asserts an *exact
count* rather than `diags > 0`, the shape every other row in `illtyped_test.wac` uses and which was true
before the fix and after it. Canaried by disabling the guard: the three rows fail with `got 2, want 1`
and the matching-slot control keeps passing.

### What is left

`s % 2` in an `i32` function is still 2 — `this operator does not take an operand of that kind` *and*
`operands have mismatched types`, two operand rules for one operand. That is the second shape named
above and it is a different repair: not a type this checker invented, but two rules with overlapping
conditions, which is the thing `check.wac`'s own comment says was untangled once already.

The corpus's 19 are the initialiser and comparison shapes — `string x = 1; u32 y = 1; return x / y;`
and its neighbours — and sorting which of those are ours needs the question this issue names, one program
at a time.

## The overlap shape is fixed too, and the recall number caught the first attempt

Two rules were keyed on the same thing — a string beside a non-string in an arithmetic operator. The
operand rule (*"a string is a number for exactly one operator"*) and the mismatch rule both fired, so
`s % 2` drew two for one fault. The mismatch is suppressed where the operand rule spoke.

**"Where it spoke" is narrower than "not `+`", and getting that wrong made a program compile.** The
operand rule reads `typeOfExpr`, which is empty for a string *literal*, so it never fires for
`n * "a"` — and the mismatch rule, reading `naturalTypeOf`, is the only thing that catches it. A first
attempt keyed the suppression on the operator alone:

| | before | first attempt | now |
| --- | --- | --- | --- |
| `s % 2` | 2 | 1 | 1 |
| `s * 2` | 2 | 1 | 1 |
| `s & 1` | 2 | 1 | 1 |
| `n * "a"` | 1 | **0** | 1 |
| `s + 1` | 1 | 1 | 1 |
| `s + "b"` | 0 | 0 | 0 |

**The mutation sweep's recall is what caught it**, dropping 1185 → 1183 with a new missed family — `2
missed of 4  type mismatch in '…': i32 and string` — while its count-disagreement number moved 19 → 15
and called the same change an improvement. Two instruments pointing opposite ways is what made the
regression visible; either alone would have read as progress.

There were two paths to guard, and they need different conditions. The literal branch needs "the operand
rule actually spoke", for the reason above. The non-literal branch runs only when neither side is a
literal, so `typeOfExpr` has answered for both and the operator alone is enough. Guarding only one of
them left `string x = 1; u32 y = 1; return x / y;` at three, which is the corpus example this issue
opened with.

Final: **19 → 15** count disagreements, recall **1185 (100%)**, no new missed families. Pinned by exact
counts in `illtyped_test.wac`, canaried with the too-broad condition, which fails on the `n * "a"` row.

## What the remaining 15 are, so far

Of the four the counter printed when it stood at 19, **three are fixed** by the overlap change above and
one is not ours:

- `string x = 1; u32 y = 1; return x / y;` and its `u64` twin — the operand rule and the mismatch rule
  both speaking. Now 2, matching the reference.
- `M { b: true, n: 7, s: "ab" }` with a `string`-typed field given `7` — was 3, now **2**, and the
  reference's two are the same two: the field mismatch, and `'*' requires numeric type, got string`
  further along. Fixed by the same change.
- `i32 x = 1; u32 y = 1; return x != y;` — **not ours.** wacc reports the mismatched comparison *and*
  the return-type mismatch; the reference reports the first and stops, because its `checkBinaryOp`
  answers null for the comparison and never reaches the slot. `x != y` is a `bool` even with the
  operands fixed, so returning it from an `i32` function is a second, independent fault. Reporting both
  is defensible and arguably better.

So the 15 need sorting one at a time by the question this issue names — *does the extra diagnostic rest
on a type the checker invented for something it refused* — and at least one of them is a case where the
answer is no and the reference is the one being terse. The counter is a queue, and this is what working
through it looks like.
