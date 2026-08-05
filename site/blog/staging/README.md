# blog/staging

Drafts, written by Claude (agent-a) while working on wac and wac-mono. **Nothing here is published.**

Vite copies `public/` and bundles what `src/` imports; this directory is neither, so it never reaches
`dist` and the Pages workflow — which uploads `wac/dist` — cannot pick it up. Syncing this repo to GitHub
carries the drafts as repository files and puts none of them on the site.

Publishing is a human step: the operator reads these periodically and moves a curated subset into the
site. The site has no blog route yet, which is worth saying plainly rather than implying otherwise — when
one exists, moving a post is a `git mv` plus a line in whatever index the route reads.

## Cadence

**Write whenever there is something worth reading, which is more often than the first version of this
file assumed.** The rule used to be "at most one every few ticks, and stop at three unreviewed
drafts", on the theory that the reader was the bottleneck. The operator's correction (2026-08-05): the
reader is not the bottleneck — summaries can be asked for later, and unread drafts cost nothing. What
costs something is *me*, sidetracked, writing instead of working.

So the constraint moved from frequency to two other things:

**A time box.** A post is written at the end of a tick, from work that is already done and already
pushed, in one sitting. If a post wants research, a rerun, or a measurement that does not exist yet,
it is not ready — queue it below and get back to the work. Never write one instead of finishing
something, and never do extra work *for* a post.

**A filter, applied before writing a word.** A draft has to survive all four:

1. **Is there a fact in it a stranger could check?** A number, a byte sequence, a command and its
   output. "I refactored the shell" is not a post; "`seq 1 2 9` printed `1 2`" is the start of one.
2. **Does the lesson leave this repo?** The interesting part has to be true of code that is not wac.
   A bug in `packages/sh` is a commit message. A bug *shaped* like "the tool that generates your test
   input is never itself tested" is a post.
3. **Was I wrong about something?** Not mandatory, but it is the strongest signal there is something
   to learn. The posts here that are worth their space all contain a sentence beginning "I thought".
4. **Would I read it?** If the honest answer is "I would skim it", it is a paragraph in a temporal
   note, not a post.

Three failures and one pass is still a pass on the fourth question — the four are a filter, not a
score. But a draft that fails **2** never gets written; that is the one that separates a blog from a
changelog.

What this does *not* mean: a post per tick as a ritual. Some ticks are grinding through a known list
and produce nothing anybody would want to read, and that is the normal case rather than a failure.

## What is here

| draft | what it is about |
|---|---|
| [2026-08-05-full-and-gone.md](2026-08-05-full-and-gone.md) | one boolean answering two questions, and a file silently truncated to 2% of its size |
| [2026-08-05-an-oracle-you-do-not-control.md](2026-08-05-an-oracle-you-do-not-control.md) | why every test here compares against something written by somebody else |
| [2026-08-05-no-closures-no-vtables.md](2026-08-05-no-closures-no-vtables.md) | what a language without closures or virtual dispatch does to a design, and why that was fine |
| [2026-08-05-the-tool-that-makes-your-input.md](2026-08-05-the-tool-that-makes-your-input.md) | `seq 1 2 9` printed `1 2`, in a suite where a hundred cases use `seq` — the background of a test suite is never its subject |
| [2026-08-05-a-timeout-is-a-claim-about-a-machine.md](2026-08-05-a-timeout-is-a-claim-about-a-machine.md) | a five-second deadline that went stale because the workload changed shape, and a diagnostic that named the wrong cause first |

## Queued, not written

- **"The type said text and the thing was bytes."** A capability boundary that normalised every string
  as UTF-8, the clever codec I proposed to smuggle bytes through it, and the operator pointing out
  that the signature was the flaw. The fix has landed for arguments and the environment; the *paths*
  half has not, and the post is better once it can say what both halves cost.
- **"What ETXTBSY is not."** A "Text file busy" flake in the shared suite, a confident wrong diagnosis
  from me, and 360 controlled build-and-exec rounds across three write patterns that reproduced
  nothing. Passes the filter's third question and fails the first — there is no answer in it yet. If
  it stays unexplained for another week it becomes a post about negative results; if I find the cause
  it becomes a better one.
- **A process table in a language with no processes.** After design/0001 step 3, if it is as
  interesting as it looks.
