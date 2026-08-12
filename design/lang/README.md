# design

One numbered document per **direction**: something the language is aiming at that is too big to be an
issue and too load-bearing to live in a commit message.

The same convention as [wac-mono's `design/`](https://github.com/voltrevo/wac-mono), and for the same
reason — but the homes here are different, so the boundary is worth stating in wac's own terms:

- **`spec/`** is what the language *does*. Every claim carries a `[§wac-…]` tag and a test in
  `compiler/wacSpec.test.ts` holds it true. Nothing goes in `spec/` until it works.
- **`issues/`** is what is actionable now, one slice at a time, referencing a direction rather than
  restating it.
- **`design/`** is the reasoning between them: a target, the decisions with their reasons, an order of
  work, and a state of play that says which parts have landed.

A direction graduates into `spec/` as it lands. That is the point — a design document that still
describes something as "planned" six weeks after it shipped is worse than none, so the state of play is
a table rather than a diary.

## What belongs here

- **The target**, concretely enough to tell whether we have arrived, and what it explicitly is *not*.
- **The decisions already taken**, each with its reason. A decision without its reason is a rule nobody
  can revisit, which is how a design becomes scar tissue.
- **The order of work**, with what "done" looks like for each step.
- **A state of play**, one line per step, updated as pieces land.

## What does not belong here

- Anything actionable now — that is an issue, and the issue references this document rather than
  restating it.
- Behaviour that already works. Once it does, it is `spec/` with a tag and a test, and this document
  links to it.
- Progress narration. What happened and why lives in the commit that did it.

## A destination, which is a second kind

Some documents have no order of work: they describe a shape that several independent lines of work
converge on, so that each can be judged against where it is going. `Status: destination` says so, and
its state of play tracks contributing pieces rather than steps.

The distinction earns its place because the two fail differently. A direction with no order of work is
incomplete; a destination *with* one invites being followed top to bottom, which is the wrong way to
read it. If a destination acquires a sequence, it becomes an ordinary direction and says so.

## Writing one

`design/NNNN-short-slug.md`, taking the next free number. Fetch before picking it, and if you lose the
race, renumber and keep the slug.
