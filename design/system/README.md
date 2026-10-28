# design

One numbered document per **direction**: something we are aiming at that is too big to be an issue and
too load-bearing to live in a commit message.

`issues/system/README.md` says an issue is "something actionable that is not already written down", and lists
three other homes — a package's README for its own roadmap, `~/notes/living/` for costs measured across
projects, and [`issues/lang/`](../../issues/lang/) for compiler bugs. A direction is a fourth kind: it spans packages, it takes
more than a sitting, and the decisions in it constrain code that has not been written yet.

## What belongs here

- **The target**, concretely enough to tell whether we have arrived, and what it explicitly is *not*.
- **The decisions already taken**, each with the reason. A decision without its reason is a rule nobody
  can revisit, which is how a design becomes scar tissue.
- **The order of work**, with what "done" looks like for each step.
- **A state of play**, one line per step, updated as pieces land. This is the part that keeps the
  document honest: a design that says "next: a process table" six weeks after the process table landed
  is worse than no document.

## A destination, which is a second kind

Most of these are directions: a target, decisions, an order of work. A **destination** has no order of
work — it is the shape several independent lines of work converge on, written down so each can be judged
against where it is going. `Status: destination` says so, and its state of play tracks contributing
pieces rather than steps, ordered by dependency rather than intent.

The distinction earns its place because the two fail differently. A direction with no order of work is
incomplete; a destination with one invites somebody to follow it top to bottom, which is exactly the
mistake [0003](0003-an-ethereum-centric-reference-distribution.md) exists to prevent — its verification
core is finished and its plumbing is not, so reading it as a sequence would start at the wrong end. If a destination
acquires a sequence, it becomes an ordinary direction and says so.

## What does not belong here

- Anything actionable now — that is an issue, and the issue **references this document rather than
  restating it**. Two records of one plan drift, which is the argument `issues/system/README.md` already makes
  about the GitHub mirror.
- A package's own roadmap. Once a direction has produced a package, its limitations and next steps go in
  its README, and this document links to it.
- Progress narration. The state of play is a table, not a diary; what happened and why lives in the
  commit that did it.

## Writing one

`design/NNNN-short-slug.md`, taking the next free number. Same numbering habit as issues, and the same
rule for a collision: renumber yours, it is a rename, and the loser is whoever pushes second.

Add a line to the table below in the same commit — the index is the thing people read.

A document is not a promise. Retiring one is ordinary: set its status to `abandoned` with the reason,
which is worth more to the next reader than deleting it.

## The documents

| # | direction | status |
|---|---|---|
| [0001](0001-a-self-contained-system.md) | a self-contained system: a filesystem, processes and users in wac, with the ssh and browser demos as its terminals | active |
| [0002](0002-the-whole-tor-stack.md) | the whole Tor stack: relays, authorities and onion services, and a network of our own | active |
| [0003](0003-an-ethereum-centric-reference-distribution.md) | an Ethereum-centric reference distribution: what arriving looks like | destination |
| [0004](0004-rendering-that-backs-a-desktop.md) | rendering that backs a desktop: one surface, from a kernel or from a tab | proposal |
| [0005](0005-git-in-wac.md) | git in wac: a client that can clone this repository and be believed | met |
| [0006](0006-candidates-for-what-to-build-next.md) | candidates for what to build next, and the oracle each one would have | candidates, none chosen |
| [0007](0007-quic-and-the-datagram-capability.md) | QUIC, and the datagram capability it needs first | done |
| [0008](0008-webrtc-in-wac.md) | WebRTC in wac | met |
| [0009](0009-a-typescript-to-javascript-bundler-written-in-wac.md) | a TypeScript-to-JavaScript bundler, written in wac | built and in use |
| [0010](0010-a-handle-carries-its-own-methods.md) | a handle carries its own methods: `sock.recv()`, never `sys.recv(sock)` | decided, unbuilt |
| [0011](0011-programs-in-a-page-without-shared-memory.md) | programs in a page without shared memory: the shell and the desktop as `packages/web` pages, stages as workers, nothing that waits | done |
| [0012](0012-a-page-is-a-tree-of-handles.md) | a page is a tree of handles: `Elem` grants one element and its subtree, and diffing is a library over it | done |
| [0013](0013-every-capability-answers-a-result.md) | `Sys` is the only capability: handles built from closures, each fault its own type, `Core`/`Cli`/`Pending` deleted (`issues/system/0330a`) | agreed |
| [0014](0014-frames-stream-with-backpressure.md) | a frame's output streams with backpressure: the in-process route becomes a spawned child, whose queue already waits, and `truncated` goes (`issues/system/0252a`) | option 1 chosen 2026-10-24; folded into 0013 |
| [0015](0015-a-page-runs-a-module-it-is-given.md) | a page runs a module it is given: `spawn` of bytes and `load`, wired by `driver.ts` to the capabilities the page module exports; every child started by the main thread, talking to its parent over a `MessageChannel` | agreed 2026-10-28 |
