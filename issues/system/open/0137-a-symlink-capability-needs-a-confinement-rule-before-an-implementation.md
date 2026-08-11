# 0137 — a symlink capability needs a confinement rule before it needs an implementation

- **Status:** open
- **Blocked on:** a decision, not an implementation
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-11
- **Kind:** missing feature
- **Symptom:** not implemented

## What is missing

`Cli` has no `symlink` and no `readLink`. `Stat.isSymlink` can *report* one — `linkStat` asks the
host — but nothing in wac can create one or read its target.

The visible consequence is in `packages/git`. A tree entry with mode `120000` is a symbolic link, and
`example/gitco.wac` checks it out as an ordinary file holding the target path. git reports that as
` T`, a typechange, so a repository containing a symlink cannot check out to a working tree
`git status` calls clean. That is the last of the mode-shaped exceptions in design/system/0005's
step 4; the executable bit was the other and is closed (issues/system/0132).

`packages/fs` says the same thing from its own side: "No symbolic links can be made here. There is no
call that creates one."

## Why this is a decision and not just work

0132 was the same shape — a missing capability, one bit wide — and adding it was ordinary work once
the surface question was answered. This one is not, because **a symlink is the one filesystem object
whose contents are a path**, and every confinement rule this system has is expressed as a path.

`packages/fs` confines a session by mounting: a program sees `/home/wac` because a mount says so, and
`Fs.at` resolves names within it. A symlink written inside a mount can name anything at all, including
a path outside the mount, and the resolution happens below us. So `Cli.symlink(target, path)` is not
one capability — it is a capability plus an unstated rule about what a target may say, and if the rule
is left unstated the answer is "anything".

That is what has to be decided, and it is expensive to undo: a capability on the shared surface has
callers within a day, and taking one away is a breaking change on four hosts.

## The options, in increasing order of restriction

1. **Do not add it.** `packages/git` keeps checking symlinks out as ordinary files, counted and
   reported, as it does now. This is the status quo and costs nothing except that step 4's criterion
   keeps its exception.
2. **Add it unconfined**, matching what the host filesystem does, and say plainly in
   `packages/platform`'s README that a program which can write a mount can name anything from inside
   it. Honest, simple, and moves the confinement question onto whoever grants the mount.
3. **Confine the target to the mount** — refuse a target that escapes, resolved at creation time.
   Cheap to implement and *not* sufficient on its own: a relative target can be made to escape later
   by moving the link, and a target that does not exist yet cannot be resolved.
4. **Confine at use rather than at creation** — every path resolution in `packages/fs` walks links
   itself and refuses to leave the mount. Correct, and much the largest: it means `Fs` stops handing
   whole paths to the host and starts resolving them component by component.

My own view, stated so it can be argued with rather than inherited: **(3) is the trap.** It reads as
security and is not, which is worse than (2), which reads as what it is. The real choice is between
(1), (2) and (4), and (4) is a change to how `packages/fs` addresses the host rather than a new
capability.

## What a browser does about it

The Origin Private File System has no links at all, so the browser host answers `FAULT_UNSUPPORTED`
whichever way this goes — capability present, backing refuses, the same shape `setExecutable` has
there. That is settled and is not part of the decision.

## Notes

There is a filed security note bearing on option (2) — `~/notes/security/`, **0003**. It is named
here by number only, deliberately: see that directory's README for why its content does not appear in
this repository. Anyone taking this decision should read it first, because it is the reason (2) is
written above as "moves the question onto whoever grants the mount" rather than as "harmless".
