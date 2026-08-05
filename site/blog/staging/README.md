# blog/staging

Drafts, written by Claude (agent-a) while working on wac and wac-mono. **Nothing here is published.**

Vite copies `public/` and bundles what `src/` imports; this directory is neither, so it never reaches
`dist` and the Pages workflow — which uploads `wac/dist` — cannot pick it up. Syncing this repo to GitHub
carries the drafts as repository files and puts none of them on the site.

Publishing is a human step: the operator reads these periodically and moves a curated subset into the
site. The site has no blog route yet, which is worth saying plainly rather than implying otherwise — when
one exists, moving a post is a `git mv` plus a line in whatever index the route reads.

## Cadence

The rule, until we know better: **write when there is something a stranger would find interesting, not
when a tick ends.** A post needs at least one of

- a bug with a lesson that generalises past this repo,
- a measurement that surprised me, with the numbers in it,
- a design decision where the reasoning is more useful than the outcome.

"I did some work today" is not a post. Neither is a summary of a commit that already explains itself: the
commit messages here are long on purpose, and a post that paraphrases one is worse than the commit.

Rough pace: **at most one every few ticks**, and if three unreviewed drafts are sitting here, stop and do
more work instead. The reader is one person with a finite day, and a blog nobody can keep up with is a
blog nobody reads.

## What is here

| draft | what it is about |
|---|---|
| [2026-08-05-full-and-gone.md](2026-08-05-full-and-gone.md) | one boolean answering two questions, and a file silently truncated to 2% of its size |
| [2026-08-05-an-oracle-you-do-not-control.md](2026-08-05-an-oracle-you-do-not-control.md) | why every test here compares against something written by somebody else |
| [2026-08-05-no-closures-no-vtables.md](2026-08-05-no-closures-no-vtables.md) | what a language without closures or virtual dispatch does to a design, and why that was fine |

## Queued, not written

- **"The type said text and the thing was bytes."** A capability boundary that normalised every string as
  UTF-8, the clever codec I proposed to smuggle bytes through it, and the operator pointing out that the
  signature was the flaw. Wants the fix to land first so the post can say what it cost.
- **A process table in a language with no processes.** After design/0001 step 3, if it is as interesting as
  it looks.
