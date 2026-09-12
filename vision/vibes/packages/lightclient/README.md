# lightclient — one function rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/lightclient`: 1,698 lines. **One function** — `validateUpdate`, the
spec's `validate_light_client_update` — and it was picked the same way
[`@/packages/wac`](../wac/) was: by sorting every mid-file doc comment in the un-rewritten packages
by length. This one is 253 words defending a function that returns `bool`.

---

## An unobservable check is unobservable because the answer is a `bool`

The shipped doc names its own weakest point, which few do:

> ## Three of these checks cannot be observed from outside
>
> Deleting any one of them changes no verdict on any input, and `test/sync_wac.test.ts` says so
> rather than pretending otherwise — each is subsumed by a later cryptographic check … But **an
> unobservable check is exactly the kind that rots unnoticed**, so it is named here as one.

The three are `attested_slot >= finalized_slot`, the signature-period window, and
`MIN_SYNC_COMMITTEE_PARTICIPANTS`. Each is subsumed: an update failing one also fails a branch or the
signature below, so both spellings answer `false`.

**They are indistinguishable because the answer is a `bool`.** With `Result<void, UpdateFault>`, an
update with the slots out of order answers `Err(SlotOrder(…))`; the same update with that check
deleted answers `Err(BadFinalityBranch)`. Different answers, so the check is observable.

Being exact about what that buys, because the difference is the claim:

- It does **not** make the vendored vectors kill the mutant. Those updates are valid; none reaches
  the check, and `Ok` versus `Ok` is still no difference.
- It makes the distinguishing test **writable**. Today a hand-built update with the slots reversed
  is rejected either way and no assertion can separate the two builds — so the test cannot be
  written, not merely has not been. With a reason it is one `Err(is SlotOrder)`.

So the type does not test the check; it stops the check from being untestable. Smaller than *the
type fixes it*, larger than *the type prints better* — and this package makes the case better than
any other here, because it did the work of finding out and wrote the answer down.

**The package already uses the other two techniques**, which is what makes this a gap rather than an
oversight. Two checks the vectors also cannot see — `>= 2/3` and `>= 1/3`, where *"a safety threshold
of `max/2` and of zero behave identically"* — were pulled into `hasSupermajority`, *"a named function
with its own boundary test at 21 and 22 of 32"*. That is right for a **threshold**: extract and test
directly. It is not available for a **rejection**, whose whole observable effect is the verdict —
which is the thing a `bool` flattens.

## What could not be written

**The rewrite silently removes a property and leaves no trace.** The shipped doc keeps the three
subsumed checks for two reasons that survive here — a few hundred nanoseconds against a pairing, and
not wanting this function's correctness to depend on `packages/bls` refusing an empty key list. What
does not survive is the *third* sentence, that they are unobservable, because they no longer are. A
rewrite that improves a property quietly leaves the next reader unable to tell it was ever in doubt,
which is the same failure mode as the stale *"wac has no closures"* comments — one tense out.

**The collapse moved down a level, and then it stopped — which this entry said it might not.** It
used to read *"the argument for going further is the same argument and does not obviously
terminate"*. [`@/packages/ssz`](../ssz/) was written afterwards, and
[`src/branch.wac`](src/branch.wac) is the composition: `provesFinality` and `provesCommittee` now
answer `Result<void, ProofFault>` and it terminates there, because below `verify` is a loop of
`sha256` and a comparison and **a hash does not refuse**.

So the rule is checkable rather than aesthetic: **a fault union ends where the next thing down cannot
fail in more than one way** — and it could not be found from this package alone, which is an argument
for rewriting a stack rather than one package of it. `verifies` still answers `bool` and by that rule
should not: `packages/bls` distinguishes an empty key list, a point off the curve, and a pairing that
disagreed.

**And the five faults it now carries change meaning by who supplied the argument.** `ssz`'s README
calls four of its five *"the caller having made a mistake"* — true for a program building a proof out
of a structure it holds, and false here, where the branch arrives from a stranger. `SurplusNotZero`
is then not a mistake but an attack, a prover attaching an unrelated subtree below the field it is
proving. `Result<T, E>` says what can go wrong and nothing says whose fault it is.

**`try` cannot map, so the two call sites are four lines each.** `ProofFault` is not in
`UpdateFault`'s set — deliberately, because promoting it would lose *which* branch failed, so
`BadFinalityBranch` carries it instead. Wrapping is a third behaviour the flattening question has no
position on: nesting preserves the grouping, flattening removes the duplicate, and wrapping preserves
the call site. It is the only one the language supports and the only one that costs a `match`.

**Nothing says the slot relations are a chain.** `SlotOrder` carries all four numbers because a
caller wants them, and the type still cannot say `current >= signature > attested >= finalized`. The
alternative is three members, which says *which comparison* and loses *what the numbers were*. It
wants both: a rejection here is a claim about an ordering, and an ordering is a relation over a tuple
this language cannot name — [../../QUESTIONS.md](../../QUESTIONS.md)'s first entry, from a fourth
direction.
