# git

git's object database, in wac. Reads and writes the objects a real repository is made of, and agrees
with `git` about what every one of them is called.

```
$ git hash-object --stdin <<< "hello"
ce013625030ba8dba906f756967f9e9ca394464a
```

`nameOf(Kind.Blob, "hello\n")` answers the same forty characters, and it is not a coincidence that
can be arranged: **a git object's name is the SHA-1 of its own bytes**, so agreeing with git here
means agreeing about what the object *is*.

## What it does

| | |
| --- | --- |
| `src/zlib.wac` | RFC 1950 framing over `packages/gzip`'s deflate, with Adler-32 verified on the way in |
| `src/object.wac` | the four kinds, the `<kind> <len>\0<content>` framing git hashes, and loose files |
| `src/tree.wac` | tree entries — mode, name, and twenty raw bytes of hash |
| `src/idx.wac` | a pack index: names, offsets, and the binary search over them |
| `src/pack.wac` | a packfile: object headers, offset and reference deltas, chains |
| `src/commit.wac` | commits and annotated tags — the two objects git stores as text |
| `src/refs.wac` | refs, loose and packed, and `HEAD` as a symbolic one |
| `src/index.wac` | `.git/index` — read and written, extensions preserved |
| `src/repo.wac` | a repository over `packages/fs`: object lookup, refs, checkout |
| `example/gitco.wac` | `git checkout`, as a program |
| `example/gitci.wac` | `git commit -a`, as a program |

The header is the whole reason `"hello\n"` is `ce013625…` rather than SHA-1 of those six bytes, and
it puts the kind inside the identity: the same bytes as a blob and as a tag are two different
objects, which `test/interop.test.ts` pins.

It reads packfiles, which means it can read a real repository — including this one. Every one of the
**18,209 objects** in this repository's own 8.7 MB pack reconstructs to bytes that hash back to the name
the index has for them, deltas and all, in about ten seconds. That check needs no second
implementation: an object's name is the SHA-1 of its bytes, so being wrong and agreeing is not
available.

**It commits.** `example/gitci.wac` writes every file as a blob, every directory as a tree, a commit
whose parent is whatever the branch names now, and moves the branch — updating `.git/index` in the same
pass. `git fsck --strict` accepts the result, `git log` shows the commit with its parent, and
`git status` is empty afterwards.

**It checks a repository out.** `example/gitco.wac` is a program — no TypeScript in the path — that
resolves `HEAD`, reads the commit's tree out of loose objects or a pack, writes every file and
subdirectory, and writes a matching `.git/index`. Delete a repository's working tree, run it, and
`git status --porcelain` is empty with `git fsck` clean. The one exception is the executable bit, below.

It walks history. Given this repository's own objects it resolves `HEAD` through a symbolic ref, reads
the commit, and follows parents to the root — **445 commits, identical to `git rev-list --first-parent`,
crossing 88 merges, over 142 loose objects and 303 packed ones**, in a tenth of a second.

## What it does not do yet

Named rather than approximated, because a git implementation that quietly did some of these would be
worse than one that says which:

- **No ref directory walk.** `repo.wac` resolves a ref by name; enumerating `refs/heads/` to list
  branches is not written.
- **No network.** No protocol, no fetch, no push.
- **No author from anywhere.** `gitci` writes a fixed identity and a fixed timestamp, because it has
  neither a clock nor a config reader. Inventing either quietly would make two runs of the same tree
  produce different commits, which for a content-addressed store is the one thing worth avoiding.
- **No config, no `.gitignore`.** Every file under the repository is committed.
- **Checkout, not diff.** A tree can be written to a working tree with a matching index; nothing
  compares a directory against a tree, so there is no `status` of our own.
- **The executable bit cannot be set.** `packages/fs` cannot `chmod` a host mount, because no such
  capability exists on `Cli`, so an executable checks out without it and git reports that one file as
  modified. Counted and reported rather than silent —
  [issues/system/0132](../../issues/system/open/0132-a-checkout-onto-a-host-mount-cannot-set-the-executable-bit.md).
- **SHA-1 only.** git can be configured for SHA-256 object names; this implements the format that is
  still the default and does not detect the other.

So this is the object database and not a client. It is enough to name, store and read git's objects,
and to walk a tree.

The order the rest would go in, and what would count as arriving, is
[design/system/0005](../../design/system/0005-git-in-wac.md) — kept there rather than here so the plan
and this package's limitations do not become two records that drift. Short version: packfiles first,
and packfile reading, refs and commits are done. Next is the index and a working tree, which together
give `status` and `checkout`, and step 5 writing a repository git accepts — all done. What remains is
step 6, fetch over our own TLS, and step 7, writing packfiles.

## Two things about the format worth knowing before reading the code

**A tree's hashes are raw bytes, not hex.** Twenty binary bytes sit in the middle of otherwise
textual data, and either can contain a space or a NUL. A parser that scans for the next delimiter
walks straight through them.

**A tree's order is git's, not the locale's.** Entries sort by name as raw bytes, with a subtree
sorted as though its name ended in `/` — so `a.b` comes before the directory `a`, because `.` is 0x2E
and `/` is 0x2F. `writeTree` deliberately does not sort: the entries are written in the order given,
because re-sorting would silently rewrite a tree that had round-tripped, and a caller that parsed one
already has git's order.

## Checked against

`git` itself, which is the right oracle here and rarely available so directly — content addressing
means there is no room for two implementations to disagree politely.

```sh
deno test -A packages/git/test/interop.test.ts     # objects and trees
deno test -A packages/git/test/pack.test.ts        # packfiles
deno test -A packages/git/test/history.test.ts     # refs, commits, and walking them
deno test -A packages/git/test/index.test.ts       # .git/index, judged by `git status`
deno test -A packages/git/test/checkout.test.ts    # a working tree we rebuilt, judged by `git status`
deno test -A packages/git/test/commit.test.ts      # a commit we made, audited by `git fsck --strict`
```

Both skip themselves, loudly, where git is not installed.

Both directions, because they are different failures: `git cat-file` reads objects this package
wrote, and this package reads objects `git hash-object -w` wrote.

**The compressed bytes are not compared, and that is deliberate.** A loose object is a zlib stream;
this deflates with `packages/gzip` and git deflates with zlib's own match search, so the two produce
different valid encodings of the same bytes — 34 against git's 21 for `"hello\n"`, 41 against git's
59 for five thousand `a`s. Ours is sometimes smaller and sometimes larger and neither is wrong.
Byte-identity there would require reimplementing zlib's heuristics, which is not what interoperating
means; what is required is that git can read what we write.
