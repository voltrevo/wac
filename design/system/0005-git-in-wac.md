# 0005 — git in wac: a client that can clone this repository and be believed

- **Status:** proposal
- **Opened:** 2026-08-11
- **Written by:** agent-c
- **Depends on:** nothing new. `crypto` has SHA-1, `gzip` has deflate, `fs` has a filesystem, `tls` and
  `http` have a network. The first slice is already in [`packages/git`](../../packages/git/README.md).

## Why this document exists

`packages/git` exists and is not git. The gap between "an object database" and "a client" is most of
the work, and it is easy to build the next convenient piece rather than the next necessary one.

When this was written the package was 347 lines and could not read the repository it lives in, because
that repository keeps its objects in a pack. Step 2 closed that. The point of the document is unchanged:
reading objects is the part where the format punishes you immediately, and everything after it — refs,
an index, a working tree, a wire protocol — is where a client that looks finished can still be wrong in
ways only real git will tell you about.

## What we are aiming at

**`git clone` this repository from GitHub over our own TLS, check it out, and have `git fsck` and
`git status` from the real git agree that the result is correct.** Then commit to it and have real git
read the commit.

That is one sentence with four checkable halves, and each is a different kind of evidence:

- **fetch** exercises the wire protocol and TLS against a server nobody here controls.
- **checkout** exercises packfiles, delta resolution and the working tree.
- **`git fsck`** is the real git auditing our output — every object reachable, every hash correct.
- **`git status` clean** is the sharpest of the four: it compares our index, our working tree and our
  refs against what git computes from the same repository, and disagreeing anywhere shows up as a file
  git thinks is modified when nothing touched it.

### What this is explicitly not

- **Not a git reimplementation.** No rebase, no merge strategies, no bisect, no submodules, no
  worktrees, no hooks, no `filter-branch`. Those are a user interface on top of the four halves above,
  and none of them is evidence of anything this document is trying to show.
- **Not a server.** Serving `git fetch` is a separate direction and would want [0001](0001-a-self-contained-system.md)'s
  session machinery, not this.
- **Not SHA-256 object format.** git can be configured for it. Interoperating means the default.
- **Not performance.** A clone that takes a minute where git takes a second has met the criterion. The
  one place this is not true is delta resolution, where the wrong algorithm is quadratic rather than
  slow, and that is called out in step 2.

## Decisions

**The oracle is real git, and this is unusually strong.** Content addressing means there is no room for
two implementations to disagree politely: an object's name *is* the hash of its bytes. Every step below
has a `git` command that adjudicates it, and where one does not exist the step says so.

**Loose objects are not compared byte for byte, and never will be.** We deflate with `packages/gzip`,
zlib deflates with its own match search, and the two produce different valid encodings — measured at 34
bytes against git's 21 for `"hello\n"` and 41 against git's 59 for five thousand `a`s. What is required
is that git can read what we write. Already settled in `packages/git`'s README and repeated here because
it is the decision people will want to revisit.

**Read before write, at every step.** Reading a format git produced is checkable against a repository
git built; writing one is checkable by handing it back. Doing them in that order means the writer is
tested by a reader that already agrees with git, rather than by itself.

**`zlib` stays in `packages/git` until a second consumer appears.** PNG is the obvious one. A container
with one caller is better beside it than in a package everything imports.

**No `.git` compatibility shortcuts.** The on-disk layout is git's, so real git can be pointed at a
repository we made at any point. A private format that needed converting would remove the oracle from
every step after the one that introduced it.

## Order of work

Each step is chosen so that the thing after it becomes checkable, and each names what adjudicates it.

**1. Objects and trees.** *Done — `packages/git`.* Hash, name, loose read and write, tree parse and
serialise. Adjudicated by `git hash-object`, `git cat-file` and `git ls-tree`, both directions.

**2. Packfiles, read.** The largest single piece, and the one without which no real repository can be
opened. A `.pack` is objects deflated back to back; a `.idx` maps names to offsets; and the objects may
be **deltas** against a base identified either by offset or by name, chained. Resolving them wants care
rather than cleverness: a naive resolver that re-reads and re-applies a chain per object is quadratic in
chain length, and git's own chains reach fifty. Done when we can list and read every object in this
repository's own pack and every name matches. Adjudicated by `git verify-pack -v`, which prints each
object's name, type, size and delta depth — so ours can be compared line for line rather than in
aggregate.

**3. Refs, commits and tags.** `.git/refs/*`, `packed-refs`, `HEAD` as a symbolic ref, and the text
format of a commit — `tree`, `parent`, `author`, `committer`, the blank line, the message — including
that a commit has *zero or more* parents, which is where a root commit and a merge both live. Done when
we can walk this repository's history from `HEAD` to its root and the commit names agree. Adjudicated by
`git rev-list --all` and `git cat-file commit`.

**4. The index, and a working tree.** `.git/index` is a binary format with a version, sorted entries,
stat data used as a cache, and extensions that may be skipped but must be preserved. Then checkout: tree
to files, with modes. Done when `git status` is clean after our checkout of a commit git made.
Adjudicated by `git status --porcelain` being empty, which is the criterion that catches an index whose
stat cache is subtly wrong — git will call every file modified.

**5. Writing objects into a repository git accepts.** *Next.* Blobs, trees, a commit; refs updated. Done when
`git fsck` reports no problem and `git log` shows our commit with its parent. Adjudicated by `git fsck
--strict` and `git log`.

**6. Fetch, over our own network.** The smart HTTP protocol: `GET /info/refs?service=git-upload-pack`,
then a `POST` of wants and haves in pkt-line, then a packfile. On `packages/tls` and `packages/http`,
against GitHub. Done when a clone of this repository from GitHub produces a working tree `git status`
calls clean and `git fsck` accepts. Adjudicated by both, plus comparing our resolved object set against
a real clone's.

**7. Packfiles, write.** Needed for push and not before. Deltas are optional in the format — a pack of
whole objects is valid and larger — so this step is small if we accept the size, and a research problem
if we want git's ratios. Take the small version and say so.

Steps 2, 3 and 4 are the ones with real risk. Step 6 is mostly plumbing over two packages that already
interoperate with somebody else's server.

## What could make this not worth finishing

Written down now, while it is cheap to say:

- **If step 2 shows the pack format wants a byte-level primitive the language cannot express well.**
  Delta application is `memcpy` with extra steps, and `WASM-WISHLIST.md` #1 is that nothing copies
  between a GC array and linear memory. If resolution is dominated by that, the honest outcome is a
  wishlist entry with a measurement, not a slow clone.
- ~~**If the index's stat cache cannot be filled from `packages/fs`.**~~ **Settled by measurement, and
  it is not a risk.** `packages/fs`'s `Stat` answers `exists`, `isFile`, `isDir`, `size`,
  `modifiedMillis` and `isSymlink` — no `ctime`, no `dev`, no `ino`, no `uid`, and milliseconds where
  git wants seconds and nanoseconds. So the cache cannot be filled, and the question was what git does
  about it. Tested rather than reasoned: zeroing every stat field of a committed index and repairing its
  trailing SHA-1 leaves `git status --porcelain` **empty**. git treats the field as what it is called —
  a cache — so a mismatch makes it re-read the file, compare the hash, find it identical, report clean,
  and write real stat data back. Step 4 may therefore write zeros there and keep its criterion. What it
  costs is speed on git's side, not correctness on ours.

## State of play

| # | step | state |
|---|---|---|
| 1. objects and trees | **done.** [`packages/git`](../../packages/git/README.md) — names agree with `git hash-object` on every case tried, `git cat-file` reads our loose objects, and a tree git wrote parses to what `ls-tree` prints and serialises back byte-identical. Six tests, skipped loudly where git is absent. Not among the packages that pass on wacc-emitted code: it declines a method on an enum |
| 2. packfiles, read | **done.** `src/idx.wac` and `src/pack.wac` — version-2 index with the large-offset table, object headers, offset and reference deltas, chains bounded at 64. Every one of the **18,209 objects in this repository's own pack** reconstructs to bytes that hash back to its index name, in ten seconds; headers match `git verify-pack -v` field for field, including that its size column is the *delta* for a delta and `cat-file -s` is the object. Not done: a thin pack's reference delta whose base is outside the pack is reported absent rather than resolved, which is a fetch concern and named in step 6 |
| 3. refs, commits, tags | **done.** `src/refs.wac` and `src/commit.wac` — loose and packed refs, `HEAD` symbolic and detached, commits with zero or more parents, annotated tags, and a `gpgsig` continuation that does not eat the message. Walking this repository's own history gives **445 commits identical to `git rev-list --first-parent`**, 88 merges crossed, root reached, across 142 loose and 303 packed objects. Not done: enumerating `refs/heads/` needs a filesystem, and nothing yet combines loose and packed lookup — the caller picks the order |
| 4. index and working tree | **done, with one named exception.** `example/gitco.wac` is a checkout as a *program* over `packages/fs`, which is what makes this git in wac rather than wac libraries driven by TypeScript: delete a repository's working tree, run it, and `git status --porcelain` is empty, `ls-files` unchanged, `fsck` clean, on a fixture with nested directories, binary content and a packed object database. **The exception is the executable bit** — `packages/fs` cannot `chmod` a host mount because no such capability exists on `Cli`, so an executable lands without it and git reports that one file. Counted, reported by the program, filed as [issues/system/0132](../../issues/system/open/0132-a-checkout-onto-a-host-mount-cannot-set-the-executable-bit.md), and pinned by a test so implementing the capability makes the stale limitation fail loudly. Earlier state of this row: **index done, working tree not.** `src/index.wac` reads and writes version 2 and 3, preserves extension blocks verbatim, refuses version 4 rather than misreading its compressed paths, and verifies the trailing SHA-1. The criterion for the half that is done: replace git's index with ours and `git status --porcelain` is still empty, `ls-files` unchanged, `fsck` clean. The stat-cache risk this document opened with is **settled and not a risk** — a committed index with every stat field zeroed and its checksum repaired still gives an empty status, because git re-reads and re-hashes on a cache miss, and that measurement is kept as a test so the plan cannot quietly stop being true. What is left is checkout: writing a tree to files, which needs the loose-and-packed store the README names |
| 5. writing a repository git accepts | not started. Step 1 can write the objects; nothing writes a ref |
| 6. fetch | not started |
| 7. packfiles, write | not started, and deliberately last |
