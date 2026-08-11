# 0132 — a checkout onto a host mount cannot set the executable bit

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-11
- **Kind:** missing feature
- **Symptom:** wrong answer

## Reproduction

`packages/git/example/gitco.wac` checks a commit's tree out over a working tree. On a repository whose
tree contains an executable, `git status` afterwards is **not** clean:

```
$ gitco /tmp/repo
5 files
$ git -C /tmp/repo status --porcelain
M run.sh
$ git -C /tmp/repo diff --summary
mode change 100755 => 100644 run.sh
$ stat -c %a /tmp/repo/run.sh
666
```

Every other file matches, `git fsck` is clean, and the index we wrote says `100755` — correctly, since
that is what the tree says. The file on disk is what disagrees.

## Where

`Fs.chmod` in `packages/fs/src/fs.wac`, which says so plainly rather than pretending:

```wac
case Host(cli): { return Change.of(FAULT_UNSUPPORTED(), "chmod on a host mount is not implemented"); }
```

That is the honest answer for the layer it is in, because the capability underneath does not exist:
**`Cli` has no `chmod` opcode.** `rg chmod packages/platform/src/platform.wac` finds nothing but a
comment. So the gap is at the capability surface, not in `packages/fs`, and `packages/fs`'s
`FAULT_UNSUPPORTED` is it reporting the truth.

## Notes

Two things follow, and the second is why this is filed rather than fixed.

**A checkout is otherwise correct.** Written as an explicit measurement so the boundary is known: a
tree with a subdirectory, nested directories, binary content and five files checks out to a working
tree and an index that `git status` calls clean — *unless* one of the files is executable, and then
exactly that one file is reported and nothing else. So this is one mode bit, not a broken checkout.
`packages/git`'s `checkout` now returns how many modes it could not set alongside how many files it
wrote, so a caller can see it rather than discovering it from `git status`.

**Adding the capability is a decision about the surface, not a patch.** A new `Cli` member has to be
implemented on all four hosts — Deno, Node, browser and the wasmtime one in `native/` — and it lands in
`packages/platform/test/conformance.test.ts`'s two-host ledger, currently 31 of 38 opcodes compared.
Some of that is not obvious: a browser's OPFS has no mode bits at all, so the browser host has to answer
something, and answering `FAULT_UNSUPPORTED` there means the *capability* is present and the *backing*
refuses — which is a distinction the fault vocabulary can express (0117 added the word) and which the
ledger will want a row for.

A narrower option, if the full capability is not wanted: an `executable: bool` on whatever creates a
file, since the four modes git records differ only in that bit and in whether the entry is a symlink or
a gitlink. That would serve this caller and avoid a general `chmod` on hosts where mode bits are not a
thing. Which of the two is right is the decision.

**Not blocked on this:** `design/system/0005` step 4's criterion is stated as `git status --porcelain`
empty after our checkout. It is met on a tree with no executable file, and the design note now records
that and points here, rather than claiming the step outright or weakening the criterion quietly.
