# 0300 — a wac program can read a symlink and cannot make one

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-31
- **Kind:** missing feature
- **Symptom:** not implemented — `Cli` has `linkStat` and no way to create the thing it reads

## What is missing

`Cli` carries `linkStat(path)`, which answers what a *name* is rather than what it leads to, and
`Stat.isSymlink` beside it. Nothing creates one. The filesystem-mutation surface is:

    writeFile   mkdir   remove   rename   setExecutable   chmod   openInput   openOutput

So a program can be handed a tree containing links, ask about them correctly, and never make one —
and no test written in wac can build a fixture that has one.

## Where it bites

**`box` has no `ln`.** `packages/platform/test/wac/native_hostfs_test.wac` says so while making its
own fixture from the harness: *"The symlinks have to be made from here: there is no `ln` in this
system, so a script cannot create its own — and `linkStat` is the one filesystem question no two-host
script used to ask."*

**A test that cannot move.** `box.test.ts`'s symlink case — GitHub wac-mono#25, where `tar` walked
into a link to a directory, stored it under the link's name, and grew the path until something
trapped on a self-referential one — needs three links in its fixture and stays in TypeScript for that
reason alone. Its assertions are two exit codes and a listing.

## The shape this is in

Exactly `chmod`'s, before `issues/system/0296c`: the **reading** half present and the **writing** half
absent, so the vocabulary can describe a state nothing in the language can produce. That one was
closed by adding the capability, and `setExecutable`'s note gives the argument that applies here too —
*"widening later is additive; narrowing later removes something callers depend on"*.

Worth deciding rather than assuming, though, because a link is not a mode:

- **A browser's OPFS has no links**, so the browser host answers `FAULT_UNSUPPORTED`, as it does for
  `chmod` and `setExecutable`. That part is settled by precedent.
- **`Fs`'s image format records an entry *kind***, and `setExecutable`'s note already says "symlink
  and gitlink are entry kinds, not permissions". So an image mount can hold one, which means the
  question is what `Fs.symlink` does on each backing rather than whether the concept exists.
- **`packages/git`'s checkout is the caller that would want it first**: git's `120000` mode is a
  symlink, and a checkout containing one currently cannot be reproduced faithfully.

## Not urgent

Nothing is wrong today — this is a gap, not a defect. It is filed because it was found twice from
opposite directions, by a test that could not be written and by a fixture that had to be built from
outside, and because the second finder should not have to work it out again.
