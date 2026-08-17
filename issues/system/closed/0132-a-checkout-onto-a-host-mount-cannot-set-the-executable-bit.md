# 0132 — a checkout onto a host mount cannot set the executable bit

- **Status:** closed
- **Claimed by:** agent-c
- **Fixed in:** `Cli.setExecutable` and `Stat.isExecutable`, 2026-08-11
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

## The same gap, read rather than written

`Stat` has no `mode` field either — `exists`, `isFile`, `isDir`, `size`, `modifiedMillis`, `isSymlink`
and nothing else. So the missing capability cuts both ways:

- **writing**, above: a checkout cannot set the executable bit.
- **reading**: building a tree *from* a working tree cannot tell an executable file from a plain one, so
  every blob is recorded as `100644`. A commit made that way is valid — `git fsck --strict` accepts it
  and `git log` shows it — but committing a tree that contained an executable records a mode change
  nobody asked for.

Both are one decision: whether a file's mode belongs on the capability surface. Filed together because
splitting them would mean two issues whose fix is the same field, which is the duplication
`issues/README.md` warns about.

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

## Fixed — the narrow option, and why that was the decision

`Cli` gained **`setExecutable(path, bool)`** and `Stat` gained **`isExecutable`**. One bit each way,
not a `chmod` and not a mode, which is the choice this issue asked somebody to make:

- git's two regular-file modes differ only in that bit. Symlink and gitlink are entry *kinds*, not
  permissions, so nothing here wants the rest of a POSIX mode.
- `mkdir` and `remove` are already `(string, bool) -> Change`; `setExecutable` is the same shape,
  whereas `chmod(path, i32)` would import a permission model the surface does not otherwise have.
- a page's OPFS has no mode bits. With one bit the browser answers `FAULT_UNSUPPORTED` — capability
  present, backing refuses, which is the distinction 0117 added the word for. A general `chmod`
  there would be unanswerable rather than merely unsupported.
- widening later is additive; narrowing later takes something away. The narrow mistake is cheaper.

Implemented on all four hosts: Deno and Node read-modify-write the one bit (execute follows read,
which is `chmod +x`'s rule rather than a mode chosen here), the native host does the same through
`PermissionsExt`, and the browser refuses. `STAT_BYTES` went 21 → 22 with `isExecutable` **appended
past the fault byte**, because moving the fault is what silently misreads a reply on a host that was
not recompiled — `packages/platform/test/unnameable.test.ts` used to pin "the fault is last" and now
pins the offsets themselves, which is the invariant that was actually meant.

`packages/fs` grew **`setExecutable` beside `chmod`** rather than widening `chmod`. The first attempt did
widen it — a host mount applied the owner-execute bit of the mode and answered success — and
`packages/box`'s own test caught it: `chmod` there is a user-facing command, and `chmod 600 secret`
reporting success while leaving the file world-readable is a worse answer than `not implemented`. So
`chmod` on a host mount still refuses, `setExecutable` promises exactly one bit and delivers it, and the
git checkout calls the narrow one. The child protocol gained `ASK_SET_EXECUTABLE` for the same reason it
could not reuse `ASK_CHMOD`: `Stat` carries one bit, not a mode, so a child cannot compute what to send.

### What adjudicates it

Both halves have real-git oracles rather than a claim:

- **writing** — `packages/git/test/wac/checkout_test.wac`: an executable in the tree checks out
  executable, `git status --porcelain` is **empty**, `git diff --summary` is empty, and the bit is
  checked on disk as well as in the index, since a wrong index and a wrong file agree with each
  other. That test previously asserted the *opposite* and was written to fail loudly when this
  landed, which is what happened.
- **reading** — `packages/git/test/commit.test.ts`: a tree built from a working tree records
  `100755` for an executable and `100644` for a plain file, per `git ls-tree`. It was watched to
  fail first, on exactly that assertion.
- **the clone** — `packages/git/test/clone.test.ts` against real GitHub now requires an empty
  porcelain, and asserts the clone's index holds at least one `100755` entry so that removing the
  tolerance did not just make the check vacuous.

### Still not done

No two-host comparison of `SET_EXECUTABLE`; it is a `gap` entry in
`packages/platform/test/conformance.test.ts` with the reason. The mask arithmetic exists three times
— Deno, Node, Rust — and only the Deno copy is exercised, so a wrong mask in the other two would not
be caught. That is worth a `native_hostfs` case next time one is added.
