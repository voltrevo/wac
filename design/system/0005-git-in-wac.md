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
- **Not authentication.** Cloning a public repository over https sends no credentials, which is the
  whole of what the sentence above needs. Push needs them and is out of scope with it.
- **Not collision-detecting SHA-1.** git hashes with `sha1dc`, which refuses an object carrying a
  known collision pattern; `packages/crypto` has plain SHA-1. Every object that exists names the same
  under both, so the oracle is untouched — what we would fail to do is reject a crafted pair that git
  rejects. Worth naming because "the hash agrees with git" is the load-bearing claim of this document
  and this is the one input where it stops being true.
- **No content filters.** No `.gitattributes`, no `core.autocrlf`, no smudge/clean. This one is not a
  simple omission — see the decision below, because it is what makes the sharpest criterion reachable.
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

**Text is bytes — and *this* repository is why that is honest rather than a corner cut.** A blob checks
out as the bytes it contains. Real git consults `.gitattributes` and `core.autocrlf` first and may
write something different from what it stored, and then `git status` compares the working tree back
*through the same filter* — so an unfiltered client reads clean only where no filter applies. That
makes the filter a hidden precondition of step 4's criterion rather than a feature we chose to skip.
It holds here and it was checked rather than assumed: **no `.gitattributes` is tracked anywhere in this
repository and `core.autocrlf` is unset.** Against a repository that had one, our checkout would be
dirty on the first text file, and the criterion would be measuring our lack of filters instead of our
correctness. This is the assumption most likely to be inherited silently by whoever points this at a
second repository, which is the only reason it is written down at this length.

**Protocol v0/v1, not v2.** v1's advertisement is refs and then a flush — a format to parse. v2
replaces it with `command=fetch` and a capability negotiation, which is a second dialect that buys a
clone nothing. The cost is named rather than hidden: a server configured to refuse v1 refuses us. It is
also what makes the conversation testable without a network, since `git upload-pack` speaks v1 unless
the client asks for otherwise, so a pipe is a real server for this purpose.

**No side-band.** With `side-band-64k` the packfile arrives interleaved with progress text on channel 2
and has to be demultiplexed before it is a pack; without it the reply is one `NAK` packet and then the
pack as raw bytes. Asking for less makes the reply a shape a reader can find the pack in, and progress
output is not something a library wants. `ofs-delta` *is* asked for, because it is what lets a server
use the smaller kind of delta and both kinds already read.

**The network here goes through a proxy, which is a property of the environment and not of git.** This
container has no direct egress: external DNS does not resolve and everything outbound goes through
Squid. `Cli.connect` is a raw TCP connect, so reaching a real server means speaking `CONNECT host:443`
to the proxy and running TLS inside the tunnel. Recorded as a decision rather than only as a
state-of-play note because it shapes step 6 and will outlive any one attempt at it.

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

**5. Writing objects into a repository git accepts.** Blobs, trees, a commit; refs updated. Done when
`git fsck` reports no problem and `git log` shows our commit with its parent. Adjudicated by `git fsck
--strict` and `git log`.

**6. Fetch, over our own network.** The smart HTTP protocol: `GET /info/refs?service=git-upload-pack`,
then a `POST` of wants and haves in pkt-line, then a packfile. On `packages/tls` and `packages/http`,
against GitHub. Done when a clone of this repository from GitHub produces a working tree `git status`
calls clean and `git fsck` accepts. Adjudicated by both, plus comparing our resolved object set against
a real clone's.

**Thin packs are step 2's loose end, and this is where it is tied.** Step 2 leaves a reference delta
whose base is outside the pack reported absent rather than resolved, and calls that a fetch concern —
this is the concern. A **clone** sends no `have`s, so the server has nothing to delta against and the
pack it sends is complete; that is why step 2 could defer it and why clone is reachable without it. An
**incremental fetch** does send `have`s and the reply *is* thin by design: completing it means
resolving those bases out of the local object store, which is what `git index-pack --fix-thin` does
when git does it. So "fetch" splits into two criteria, and only the first is on the path to the
sentence at the top.

**7. Packfiles, write.** *After step 6's transport.* Needed for push and not before. Deltas are optional in the format — a pack of
whole objects is valid and larger — so this step is small if we accept the size, and a research problem
if we want git's ratios. Take the small version and say so. Adjudicated by `git index-pack` on our
pack, which both verifies it and builds its index, then `git verify-pack -v` field for field and `git
unpack-objects` into an empty repository `git fsck` accepts. Named late: the decisions above say every
step has a command that adjudicates it or says it has none, and this step had neither until now.

**8. The clone, as one program.** Steps 4, 5 and 6 each built a half of the opening sentence and
**nothing composes them** — there is no `example/gitclone.wac`, so "clone this repository and be
believed" is four passing tests plus an inference rather than a thing that has happened once. The
program is: fetch, index the pack that arrives, write the refs the advertisement named, check out
`HEAD`, write the index — every piece of which exists. **Numbered after 7 but dependent only on 6**,
because 7 is for push and this needs nothing from it. Done when one program run against one URL leaves
a directory `git fsck` accepts and `git status --porcelain` calls clean, and our object set matches a
real clone's. This is the step that closes the document; until it exists the title is a claim about
parts, which is worth a numbered row rather than an assumption.

Steps 2, 3 and 4 are the ones with real risk. Step 6 is mostly plumbing over two packages that already
interoperate with somebody else's server — with the transport the exception, since nothing in this
container has yet reached a server outside it.

## What could make this not worth finishing

Written down now, while it is cheap to say:

- **If step 2 shows the pack format wants a byte-level primitive the language cannot express well.**
  Delta application is `memcpy` with extra steps, and `WASM-WISHLIST.md` #1 is that nothing copies
  between a GC array and linear memory. If resolution is dominated by that, the honest outcome is a
  wishlist entry with a measurement, not a slow clone.
- **If the transport cannot be made to work from this container.** Step 6 says "from GitHub", and the
  proxy decision above is the reason that may not happen. Written down before it is needed so the
  fallback is a decision and not a rescue: adjudicate against a local `git upload-pack` over a pipe —
  already done — plus a `git daemon` or an HTTP server on loopback speaking the same protocol, and
  **say in the state of play that no server outside this container was ever reached.** That is a
  changed criterion stated plainly, which is the standard step 4 was held to over the executable bit.
  What it must not be allowed to become is a row that reads "fetch: done", since a local pipe cannot
  test the one thing GitHub tests: that our TLS and our protocol satisfy a server nobody here
  configured.
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
| 1. objects and trees | **done.** [`packages/git`](../../packages/git/README.md) — names agree with `git hash-object` on every case tried, `git cat-file` reads our loose objects, and a tree git wrote parses to what `ls-tree` prints and serialises back byte-identical. Six tests, skipped loudly where git is absent. Not among the packages that pass on wacc-emitted code: it declines a method on an enum. Also shaped by wacc since: `Object`'s `Read` variant is now `Loaded`. wacc resolved a struct field's written type as it walked, before the file declaring that type had been walked, so this variant's name retyped every `fn[Read()]` in `packages/platform` as this enum and emitted a module no engine would load — [issues/lang/0097](../../issues/lang/closed/0097-a-linked-git-repo-emits-an-invalid-module.md), reduced here to three files and a one-identifier control, diagnosed and **fixed** by agent-b by re-resolving field types in a second pass. The rename is no longer needed and is kept anyway, because a variant sharing a name with a type every platform-using file imports is hard to read even where it is legal |
| 2. packfiles, read | **done.** `src/idx.wac` and `src/pack.wac` — version-2 index with the large-offset table, object headers, offset and reference deltas, chains bounded at 64. Every one of the **18,209 objects in this repository's own pack** reconstructs to bytes that hash back to its index name, in ten seconds; headers match `git verify-pack -v` field for field, including that its size column is the *delta* for a delta and `cat-file -s` is the object. Not done: a thin pack's reference delta whose base is outside the pack is reported absent rather than resolved, which is a fetch concern and named in step 6 |
| 3. refs, commits, tags | **done.** `src/refs.wac` and `src/commit.wac` — loose and packed refs, `HEAD` symbolic and detached, commits with zero or more parents, annotated tags, and a `gpgsig` continuation that does not eat the message. Walking this repository's own history gives **445 commits identical to `git rev-list --first-parent`**, 88 merges crossed, root reached, across 142 loose and 303 packed objects. Not done: enumerating `refs/heads/` needs a filesystem, and nothing yet combines loose and packed lookup — the caller picks the order |
| 4. index and working tree | **done, with one named exception.** `example/gitco.wac` is a checkout as a *program* over `packages/fs`, which is what makes this git in wac rather than wac libraries driven by TypeScript: delete a repository's working tree, run it, and `git status --porcelain` is empty, `ls-files` unchanged, `fsck` clean, on a fixture with nested directories, binary content and a packed object database. **The exception is the executable bit** — `packages/fs` cannot `chmod` a host mount because no such capability exists on `Cli`, so an executable lands without it and git reports that one file. Counted, reported by the program, filed as [issues/system/0132](../../issues/system/open/0132-a-checkout-onto-a-host-mount-cannot-set-the-executable-bit.md), and pinned by a test so implementing the capability makes the stale limitation fail loudly. Earlier state of this row: **index done, working tree not.** `src/index.wac` reads and writes version 2 and 3, preserves extension blocks verbatim, refuses version 4 rather than misreading its compressed paths, and verifies the trailing SHA-1. The criterion for the half that is done: replace git's index with ours and `git status --porcelain` is still empty, `ls-files` unchanged, `fsck` clean. The stat-cache risk this document opened with is **settled and not a risk** — a committed index with every stat field zeroed and its checksum repaired still gives an empty status, because git re-reads and re-hashes on a cache miss, and that measurement is kept as a test so the plan cannot quietly stop being true. What is left is checkout: writing a tree to files, which needs the loose-and-packed store the README names. **Two more entry kinds are now named, and one of them was only a prediction until it was measured.** A *symlink* (mode `120000`) cannot be created by `packages/fs` at all, so it lands as an ordinary file holding its target — the fixture had none, so what git says about it was a claim in a source comment rather than a measurement. It now has one, and git says exactly ` T`, a typechange in the **worktree** column, our index having recorded mode 40960 and agreeing with `HEAD`; the test asserts the untrimmed porcelain output, because trimming it would let a wrong index pass as a filesystem limitation. `gitco` counts and reports it, which it previously did not. A *gitlink* (`160000`) is a submodule's commit and so by definition absent from this repository, which fails the whole checkout rather than leaving the empty directory git leaves — read from the code, not measured, and no fixture contains one |
| 5. writing a repository git accepts | **done.** `example/gitci.wac` writes blobs, trees, a commit and the branch, and the index in the same pass. **`git fsck --strict` accepts it**, `git log` shows the commit with its parent, and `git status` is empty afterwards — the last of those is more than the criterion asked for and came free once the index was written alongside the ref. A re-commit of the same tree adds no objects, which is what content addressing should give. Root commits — no `parent` header at all — are a separate test. Not done: the author is a fixed identity and timestamp, because there is no clock and no config reader, and inventing either would make two runs of one tree produce different commits |
| 6. fetch | **protocol and indexing done, transport not.** `src/pktline.wac` and `src/fetch.wac`: an advertisement from real `git upload-pack --advertise-refs` parses to the refs `show-ref` lists with capabilities taken off the first line's NUL; a request we build is one `--stateless-rpc` answers; the packfile is extracted from the reply. And **`indexPack` builds an index for a pack that arrived without one** — every name and offset identical to the index git wrote for the same pack, deltas included, and 18,209 objects of this repository's own pack in 2.4 seconds. That needed one addition to `packages/gzip`: `inflateAt`, which reports where a DEFLATE stream ended, because a pack records no object lengths and only the inflater knows. The end is `pos - (bitCount >> 3)`, not `pos` — a bit reader holds bits from bytes it has already pulled. What is left is **the transport**: this container has no direct egress (external DNS fails, everything goes through a Squid proxy) while `Cli.connect` is a raw TCP connect, so a real server needs `CONNECT host:443` spoken to the proxy before TLS. Not a decision, so not filed — named here and in the README |
| 7. packfiles, write | not started. For push, and nothing on the path to the opening sentence needs it — step 8 is the last one in that sense, and this row used to say "deliberately last" when it was the only row after 6 |
| 8. the clone, as one program | not started, and it is the row that closes the document. Every piece exists and nothing composes them: there is no `example/gitclone.wac`, so "clone this repository and be believed" is presently four passing tests and an inference. Blocked on the same transport as step 6 and on nothing else |
