# The repositories merged — what to do with your checkout

On 2026-08-09 `wac` and `wac-mono` became one repository, called `wac`. Both histories are here
and rewritten so that `git log --follow` and `git blame` cross the move: 385 commits from the
language side and 1,303 from the packages side, none discarded.

**Your old checkout cannot fetch this.** The histories were rewritten, so there is no common
ancestor and no fetch, pull or rebase will bridge it. Delete your workspace clone and take a fresh
one:

    rm -rf ~/<agent>/workspaces/wac ~/<agent>/workspaces/wac-mono
    git clone ~/bare-repos/wac.git ~/<agent>/workspaces/wac

`~/bare-repos/wac-mono.git` is gone. The pre-merge state of both is kept three ways, so nothing is
lost — but nothing you do in any of them reaches anybody:

- `~/bare-repos/archive/wac-pre-merge.git` and `~/bare-repos/archive/wac-mono-pre-merge.git`;
- `~/bare-repos/wac-archive.git`, with the two histories as the branches `wac-master` and
  `wac-mono-master` and a `master` that explains what the repository is for;
- the same, on GitHub as `voltrevo/wac-archive`.

There is also a copy of this note outside any repository, at
`~/notes/living/wac/repo-merge-and-layout-agent-c.md` — a note inside a repository you cannot clone
is no use to you.

Everything was pushed before the merge, and the two heads that went into it were `af7c309`
(language) and `c3c7267` (packages). If you had work that was not pushed, it is in your old
workspace directory and not in this history; the way to recover it is to copy the files across by
hand rather than to try to merge the branches.

Re-cloning also loses your git identity, which was per-repository config rather than global — the
first commit after re-cloning fails with "Author identity unknown". Set it again:

    git config user.name "Claude (agent-<x>)"
    git config user.email "<the address the old checkout used>"

## Where your files went

| was | is |
| --- | --- |
| `wac/atoms/wac/` | `compiler/` |
| `wac/src/`, `public/`, `index.html`, `blog/`, vite, npm | `site/` |
| `wac/tools/site.test.ts`, `syncDemos.ts`, `syncMap.ts`, `siteDeadline.ts` | `site/tools/` |
| `wac/tools/fuzz.ts`, `fuzzBoundary.ts` | `tools/` |
| `wac/issues/`, `wac/design/` | `issues/lang/`, `design/lang/` |
| `wac-mono/issues/`, `wac-mono/design/` | `issues/system/`, `design/system/` |
| `wac-mono/README.md` | `packages/README.md` |
| everything else in `wac-mono` | unchanged |

`issues` and `design` are split by category rather than by which repo they came from: both numbered
from 0001 and **79 numbers collide**, so one sequence would have meant renumbering, which breaks
every reference in code comments and every reference in commit messages — and commit messages
cannot be fixed. "wac 0076" is `issues/lang/`; "wac-mono 0103" is `issues/system/`. File new ones in
whichever tree they belong to, continuing that sequence.

## What changed besides paths

**The compiler pin is gone** — `wac-version.json`, `tools/wacPin.ts` and `harness/wacVersion.ts`.
Its job was checking that a *sibling* checkout was new enough, and it located that checkout by
looking for `/atoms/wac/` in a path. In one repository the compiler is whatever is in the tree, so
the check had nothing left to do; it would have kept running and silently passed, which is the
failure mode this repo writes tests against.

**The import map** is `"wac/": "./compiler/"`. Package code that imports through `wac/` is
unchanged.

**The two sync tools take no path.** `site/tools/syncDemos.ts` and `syncMap.ts` used to be handed
the sibling checkout; run them from the repository root with no argument.

**The site is excluded from the Deno walks** and has its own invocation:

    deno test -A --unstable-sloppy-imports --no-check site/tools/site.test.ts

`site/src` is a vite project — `./file-store` with no extension is what vite and
`tsc --moduleResolution bundler` resolve and what Deno's resolver refuses. There are 33 such
imports; rewriting them would be changing the site to suit a tool that is not building it. `npx tsc
-b` in `site/` is the checker that agrees with the bundler, and it runs in CI.

**6.55 MB of built demo artifacts left the history** — `public/shell.html` and its two siblings,
seven versions each, generated on every deploy and already untracked. Nothing else was stripped.

## One thing still tracked at the root

`=`, which is plainly an accidental shell redirection (agent-b's, twice — `387efbff` and
`a66bbfd1`). Left alone rather than deleted during a merge; whoever wants it gone can remove it.

`transcript.ts` was here too and is now deleted. It was mine: a throwaway that printed what the
front page's transcript should say, committed by accident in `75e16fc3` alongside the test that
does the same thing properly (`tools/wac/frontpage_test.wac`). It had also stopped working, since 0103
took the applets out of `packages/sh` and it invoked that shell. I wrote in this file that neither
file was mine — that was an assumption rather than a check, and `git log --follow` disagreed.

## The state it was left in

Verified against a green baseline taken on both repositories first, so anything red afterwards was
attributable to the merge rather than pre-existing:

- `deno task test` — **2,924 passed, 0 failed**, plus 57 in the exclusive lane. That is the
  compiler's 1,278 and the packages' 1,646, exactly.
- `deno test -A --unstable-sloppy-imports --no-check site/tools/site.test.ts` — 19 passed.
- `deno task map --check` — current.
- `packages/wacc`'s bootstrap fixpoint still reaches the same bytes.

Thirteen tests failed during the merge and every one was a path that had reached across the old
boundary. All repointed, none weakened or skipped.

A first run on a fresh clone showed two failures that did not reproduce on two further runs. That
matches [0106](issues/system/open/0106-the-onion-service-test-goes-red-under-load-on-a-shared-machine.md)
and [0107](issues/system/open/0107-a-c-tor-fetching-from-our-onion-service-times-out-intermittently.md)
rather than anything here, and is recorded rather than dismissed.

## Still open, and now unblocked by the merge

[0092](issues/system/closed/0092-the-capability-layer-should-be-its-own-repo.md) — extracting the
capability layer into its own repository — was **obsoleted** by this merge and is closed as of
2026-08-11, when the operator confirmed it: one wac repo for the foreseeable future. The
directory provider it was blocked on is worth keeping on its own terms: it is what lets a package
come from somewhere other than the file beside you, which is what third-party packages need.
