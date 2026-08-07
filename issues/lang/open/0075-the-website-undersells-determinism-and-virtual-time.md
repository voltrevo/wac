# 0075 — the website undersells determinism and virtual time

- **Status:** open
- **Blocked on:** an operator decision, not an implementation
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-07
- **Kind:** missing feature
- **Symptom:** not implemented

Not a compiler issue. It is filed here because the site lives in this repo and because the blocker
is a decision — `README.md` says that is what an issue is for — and the decision is the operator's,
since it is about what the project claims in public.

## What is on the site now

One paragraph, three quarters of the way down `/roadmap`, inside *A host with no JavaScript in it*.
It says a run should be reproducible, that advancing the clock when nothing is runnable turns
transitions that take hours into milliseconds, and that a scheduler-owned clock is not a mocked
`now()`.

That paragraph is accurate and it is in the wrong place at the wrong size. It reads as the third
reason for a runtime that does not exist yet, which buries two things:

- **it is a claim about testing**, and testing is where this project's evidence lives. The site
  already argues from 652 differential scripts, 2,233 published vectors, a C tor bootstrapping
  through our relay. Determinism is the same argument one level up — it is about being able to
  *reproduce* the run that found something.
- **the reason it is possible here is structural.** wac programs have no ambient authority, so a
  program's every interaction with the world is a capability it was handed. There is no clock to
  read behind the runtime's back, no socket it did not give you, no thread it did not start. Most
  systems that want deterministic replay have to fight for that property; this one has it by
  construction and has not said so anywhere.

## What to decide

**How much weight it gets, and where.** Roughly, in increasing order of commitment:

1. leave it in the roadmap paragraph, and improve only the wording;
2. promote it to its own section on `/roadmap`, beside the four directions rather than inside one;
3. make it an argument on `/built`, next to the capability world — "no ambient authority" and
   "a run you can replay" are the same fact stated twice, and the second is the one a reader
   without a security interest will care about;
4. a page of its own, with the closed-world/open-world distinction from `design/0001`'s D13
   drawn out properly.

**What may be claimed today, and in what tense.** Nothing of D12 or D13 is built. The honest
present-tense claims are narrower and worth stating precisely rather than blurring into the plan:

- the platform's queue, child lifecycle and bridge protocol are pure transition functions with
  every interleaving walked in `packages/platform/test/*_model.test.ts`;
- `packages/fs` gives a session a filesystem that is not the host's, so a test's world is already
  partly its own;
- and the two bugs that motivate the whole thing are real and findable: a zero-length write that
  ended a stream *only when a reader happened to be parked*, and a corpus that hangs about once in
  fifty runs *and only on an idle machine*.

**Whether the accuracy argument leads.** The strongest concrete point is not speed. The onion
rotation vectors use an eight-minute time period because a test network shrinks the voting interval
to make rotation observable at all — so `timePeriodLength(testingNetwork: true, …)` is the branch
under test and the production branch has never met a live network. Virtual time removes the reason
to shrink the interval. That is a correctness win, and it is the kind of specific that this site's
other sections are built on.

## Notes

The source material is wac-mono's [`design/0001`](https://github.com/voltrevo/wac-mono/blob/master/design/0001-a-self-contained-system.md),
decisions **D12** (a fully deterministic execution mode, and how much of it is reachable before the
native runtime) and **D13** (virtual time: the clock is a scheduling decision, not a measurement),
plus the D13 section of wac-mono issue 0087. Both are agent-b's, D13 prompted by the operator.

Whoever writes this should read D12's boundary carefully before claiming anything about the
JavaScript hosts: what can be owned there today is *partial*, and the document is precise about
which half. Overstating that would be the exact failure this issue exists to avoid — the site
recently said "nothing in the dependency chain is constant-time" when the measurement said
something better and narrower, and that cost more credibility than the sentence bought.
