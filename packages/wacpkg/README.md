# wacpkg

Where a wac project says its dependencies come from: `wac.json5`, read and checked.

```sh
deno test -A packages/wacpkg/test/     # the tests
deno task coverage:wacpkg              # branch coverage
```

A project is a directory with a `wac.json5` in it. An empty one is valid — a project that imports
only its own files needs a manifest to *exist*, not to say anything. The field this package reads
is `imports`, a table from a **mapping name** to the repository its modules come from:

```json5
{
  imports: {
    // A prefix mapping: everything under `std/` comes from this repository.
    'std/':  { git: 'https://example.invalid/std', ref: 'main' },
    // An exact mapping, of one subdirectory of a larger repository.
    'acme':  { git: 'https://example.invalid/monorepo', ref: 'v1', subdir: 'lib/acme' },
  },
}
```

```wac
Manifest m = readManifest(bytes);
if (!m.ok) { /* m.code says what, m.detail says which */ }
Match hit = matchSpecifier(m, "std/vec.wac");   // found, index 0, suffix "vec.wac"
```

This is `design/lang/0009` D6, D7, D9 and D10. What is not here is everything that needs a
capability: reading the files, resolving a ref to a commit, and fetching (D11, which
`packages/git`, `packages/http` and `packages/tls` exist to do).

## `wac.lock`

`plan` answers the only question an ordinary command has: for each mapping, is there a commit to
use, or does it have to go and find one?

```wac
Step[] steps = planFor(manifestBytes, lockBytes);
// USE     — the entry is valid; steps[i].commit is the answer, and no ref is consulted
// CREATE  — no entry yet; an ordinary command may resolve and write one
// REFRESH — the manifest changed; steps[i].why says which input
```

**A branch that moved is not a reason to do anything.** An entry whose `git`, `ref` and `subdir`
still match is `USE`, and the commit it names is the answer this month and next. Only a *manifest*
change produces `REFRESH`; `wac update` is a separate, explicit operation and is not this function.
That rule is the whole point of a lockfile and the easy thing to get wrong, because "resolve the
ref" is the same operation in both cases and only the surrounding decision differs — so the
decision is a value a caller cannot ignore rather than a comment telling it what not to do.
`planNeedsResolving` is the one call a locked or CI mode needs.

`updatedLock` is the write side: a manifest, the lock as it stands, and one commit per mapping, in
`planFor`'s order. **A `USE` step ignores the commit it is offered** and keeps the entry it had —
the same rule `plan` states, enforced at the only place it can actually be broken, because a
caller that resolved everything rather than deciding would otherwise write a lock that advanced
every mapping and looked exactly like a correct one. A run with nothing to do produces the bytes
already on disk, so "did anything change" is a byte comparison. A missing or malformed commit for
a mapping that *did* need one is a refusal rather than a partial file: a lock is a claim about
every mapping, and silently un-pinning one is worse than writing nothing.

**Every mapping locks independently, even when several name one repository.** The cache may
deduplicate by repository and commit; lock ownership does not. Two mappings on one URL at different
refs keep their own commits, so updating one cannot move the other.

`rewriteLock` is the writer, and it is a canonicalisation: sorted by mapping name, two-space
indented, JSON — which is valid JSON5, and buys nothing by not being. Running it on its own output
is the same bytes, and so is running it on the same entries written in a different order, so two
agents who resolved the same mappings produce the same file and a generated artefact is one less
thing to conflict on. A commit is checked to be forty lowercase hex digits **when the file is
read**: an abbreviated one resolves to something, and to a different something once the repository
has grown enough for the prefix to stop being unique.

## Seeing it work

`example/plan.wac` reads a project's two files and says what an ordinary build would have to fetch:

```sh
deno task app:build packages/wacpkg/example/plan.wac --allow-read -o wacplan
./wacplan .
```

```
  locked   std/  https://example.invalid/std @ main  aaaaaaaaaaaa
  new      acme  https://example.invalid/monorepo @ v1 / lib/acme  (no entry yet)
  stale    gone  (in the lock, not in the manifest)
2 mapping(s), 1 needing the network, 1 stale lock entr(ies)
```

Exit 0 when everything is locked, 2 when something needs the network, 1 when the directory is not
a project or its files are malformed — which is the shape a CI mode wants.

**It exists to be the first caller with a capability.** Everything above is deliberately I/O-free,
and until something read a manifest off a disk nothing had checked that the split is one a real
caller can work with. It found a defect the library's own tests could not: the first version had a
single `describe` turning an `i32` code into a sentence, and manifest codes and lock codes are two
spaces that both start at 1 — so a broken lockfile would have been explained in the manifest's
words. Neither test could see it, because neither ever holds a bare code.

## Which commit a `ref` names

`plan` says a mapping needs resolving; `refToCommit` says what it resolves *to*, given what the
server advertised. Tried in order, and the order is the decision:

1. **An object name resolves to itself** — forty lowercase hex digits needs no advertisement. A
   manifest may pin a commit the server does not advertise, and that is exactly what every lockfile
   entry becomes when somebody pastes it back as a `ref`.
2. **An exact advertised name**, which is how `HEAD` and any fully-qualified `refs/…` are asked for.
3. **`refs/heads/<ref>` or `refs/tags/<ref>`** — and *both* is refused.

**An ambiguous ref is refused rather than ranked.** `git rev-parse` picks the tag and warns; for a
lockfile, answering is the wrong thing. A repository with a branch and a tag both called `v1` is
one where a human meant one of them, and choosing silently is how a dependency moves without
anybody deciding. `refs/tags/v1` says which, and is one word longer.

An annotated tag advertises two lines — `refs/tags/v1` for the tag object and `refs/tags/v1^{}` for
the commit — **naming different objects**. The peel wins, because a checkout needs the commit, and
`via` reports which name was used so an annotated tag can be told from a lightweight one when the
answer later surprises someone.

The oracle is real `git`: `packages/wacpkg/tools/vendorRefs.ts` builds a repository with a branch,
a slashed branch, a lightweight tag, an annotated tag and one name that is both, reads the
advertisement with `git ls-remote` and asks `git rev-parse <ref>^{commit}` what each query means.
`^{commit}` and not plain `rev-parse`, because plain answers an annotated tag with the tag object
and a fetcher wants the commit. Built rather than typed out: the rows that matter are the ones
where what you believe `ls-remote` prints is wrong.

## Where a fetched commit lives

    $WAC_HOME/cache/git/<escaped repository>/<commit>

D11 says a locked commit must be usable from the cache "without consulting a moving branch", which
is a constraint on the *key*: the path is a function of the repository and the commit and nothing
else. Two commits of one repository are siblings, which is what lets the cache deduplicate by
repository; two repositories are not.

**Escaped reversibly, not hashed and not slugified.** A hash is safe and makes the cache
unreadable — `ls` tells you nothing and neither does a path in a bug report. A slug is readable and
not injective: `a/b` and `a-b` collide, and a collision here serves one repository's contents for
another's. So every byte outside `[a-z0-9._-]` becomes `%HH` and an uppercase letter becomes `!x`,
which is Go's module-cache trick for the reason Go had it — without it a case-insensitive
filesystem merges `github.com/A/b` and `github.com/a/B` into one directory and the second fetch
silently serves the first's files.

Reversible is the property worth having, because a machine can check it: `unescapeRepo` of
`escapeRepo` is the identity over any corpus, where "these look different enough" is not. The
inverse also has to be able to *refuse* — otherwise the round trip is satisfied by a function that
passes everything through, which is its own test.

This is settled before the fetching on purpose. A cache key is written into people's home
directories and is the one part of a package system that cannot be changed later without a
migration or orphaning everything already downloaded.

## Fetching

`example/fetch.wac` is D11's network half, and it is composition rather than new protocol:
`wacpkg` decides *what* to fetch and where it goes, `packages/git` and `packages/tls` do it.

```sh
deno task app:build packages/wacpkg/example/fetch.wac \
  --allow-read --allow-write --allow-net --allow-env -o wacfetch
./wacfetch . ~/.wac
```

Against `https://github.com/voltrevo/wac` with `ref: master`, over its own TLS:

```
wacfetch: x/ (https://github.com/voltrevo/wac @ master)
  master -> ecb7c7329648 via refs/heads/master
  7678374 bytes, 2618 objects -> …/cache/git/https%3A%2F%2Fgithub.com%2Fvoltrevo%2Fwac/ecb7c73…
wacfetch: 1 fetched, 0 already locked
```

and then, run again with the lock it wrote:

```
wacfetch: nothing to fetch; 1 mapping(s) already locked
```

which is D11's sentence — a locked commit needs no server — demonstrated rather than asserted.

**It does not trust a 200.** The pack is indexed and the commit looked up in that index *by name*.
A pack is content-addressed, so one mis-parsed cannot produce an object whose SHA-1 is the name we
asked for; getting that commit back out is TLS, HTTP, pkt-line, the pack format, delta resolution
and SHA-1 all agreeing at once. It also checks the object is a commit rather than something else
that happens to hash to the name, and answers a thin pack by name rather than letting it fall
through — unreachable while nothing sends a `have`, and it will not stay that way.

**What is not automated, and should be said plainly.** Every rule this program composes has tests
— resolving a ref against a real `git` advertisement, the plan, the lock it writes, the cache path,
the transport refusal. The *composed program* is verified by the run above, by hand. A suite test
would download 7.6 MB on every run; `packages/git/test/fetchlive.test.ts` is the pattern for one
that is skipped without a proxy, and this has no equivalent yet.

## What it does not do, on purpose

**No I/O.** It takes the bytes of a manifest and answers with a table, or with the first thing
wrong with it. Where those bytes came from is the caller's, and that is not tidiness: D7's rule is
that `@/` is the nearest `wac.json5` *above the importing file*, which is a filesystem search, and
the compiler's own resolver deliberately does no I/O so that it can run in a browser. Splitting at
this line keeps the policy testable with no host and leaves the search with the code that already
holds a capability.

**No opinion on transports in the reader.** `unsupportedTransport` says whether this toolchain can
fetch a `git` url — HTTPS and nothing else today, which is what `packages/git`'s `parseRemote`
takes and what D11 scopes the first implementation to. It is deliberately *not* part of
`readManifest`: which transports exist is a property of the toolchain, not of the file format, so a
manifest written for a build with SSH is unsupported **here** rather than invalid, and a build that
later grows SSH needs no change to the reader. Whatever is about to fetch calls it, so the refusal
arrives before the network instead of as a transport error three layers down naming a url the
person did not think they had typed.

**No fetching, and no network.** D11 puts that on `packages/git`, `packages/http` and
`packages/tls`, which exist. The advertisement arrives here as two parallel arrays of strings
rather than as `packages/git`'s `Advertised`, so the Git protocol is not in this package's
graph to read two fields off it — and the rule stays testable with a table.

## The overlap rule is the whole point

D9: **a specifier has at most one possible mapping.** There is no longest-prefix tie-break, so a
table where two names could both match has no defined meaning — and the failure would not be an
error, it would be a program that resolves differently depending on the order the manifest happens
to be written in. So the table is rejected when it is read.

Two names overlap when, with one trailing slash removed from each, they are equal or one is a path
prefix of the other:

| pair | |
| --- | --- |
| `foo` and `foo/` | rejected — equal after trimming |
| `wac/` and `wac/packages/json/` | rejected — one is under the other |
| `a` and `a` | rejected — JSON5 keeps duplicate members; a manifest must not |
| `wac/` and `wac2/` | **fine** — neither is under the other |
| `a/` and `ab/` | **fine** — a prefix has to end at a `/` |

The last two rows are why the check compares `outer + "/"` rather than calling `startsWith`. A
checker that rejected them would pass every "must reject" case above and still be wrong, so both
directions are tested, and every pair is tested in both orders because the comparison is between
two names and could easily be right one way round only.

A `subdir` that contains any `..` component, or begins with `/`, is refused. Checked on the text
rather than on a normalised path: `a/../b` stays inside and is still refused, because allowing it
would mean the escape check has to trust a normaliser to agree with it about `a/../..`.

## Where a specifier lands

`locate` is D9's second half, and the half where being slightly wrong is a hole rather than a bug:
the unmatched suffix is appended to the mapping's `subdir`, normalised, and refused if it leaves
the checkout.

| mapping | specifier | |
| --- | --- | --- |
| `'sub/'` → `subdir: lib/acme` | `sub/src/a.wac` | `lib/acme/src/a.wac` |
| `'deep/'` → `subdir: a/b` | `deep/../c.wac` | `a/c.wac` — inside, so allowed |
| `'whole/'` → no subdir | `whole/../c.wac` | refused |

**Checked after joining, and only after.** Those last two rows are the same suffix and different
answers, which is why the order in D9's sentence is the substance and not the phrasing: a `subdir`
and a suffix that each look alarming can be harmless together, and two that each look harmless can
escape together. A pre-check on the suffix alone refuses `deep/../c.wac`, which is inside — and,
worse for whoever reads this next, makes the real check unreachable, so a fault planted in it
would never fail a test. `subdir` itself is refused at read time if it contains `..` at all,
because a person writes it once where a suffix is whatever an import happens to say.

## `@/` and finding the project

`candidateRoots` gives the directories to look in, nearest to the importing file first, ending at
the provider boundary; `resolveAt` turns `@/src/a.wac` into a path once the root is known. Reading
those directories is the caller's — see the top of this file — and a caller with no root must
report D7's compile error rather than pass `""`, which would resolve `@/src/a.wac` against nothing.

Only the slash form is a project reference. `@` alone and `@name` are not, which leaves the bare
`@` free to mean something later without a migration.

## Errors

One failure rather than a list, and `detail` names the mapping it is about — "two names overlap"
without saying which two is a message that sends you back to read the file yourself. The checks
are ordered so a later one cannot be reached with an earlier one outstanding, so a list would be a
list of consequences.

The codes are in `src/manifest.wac`, and `test/wac/manifest_test.wac` imports them. It used to be
two hand-copied tables in TypeScript with a test comparing them against the source for drift; a wac
test needs neither, which is most of why these moved.

## Tests

**The tests are in wac** — `test/wac/*_test.wac`, run by `wac test`. They replaced eight
`.test.ts` files that drove the package through `wacpkg.wac`'s byte-taking boundary from a
TypeScript host; the wac tests call the modules directly, the way `example/plan.wac` does.
Migrating also deleted two hand-copied tables of the `M_*` and action codes and the test that
compared them against the source for drift, which is not a tidier way to catch drift but the same
guarantee with nothing to maintain.

**Fault detection is measured, not remembered.** `deno task mutate --package wacpkg --operators`
plants every `guard` and `extreme` mutant in the package — a removed validity check and a gutted
function, the two operators worth reading when they survive. That is the number to quote here, and
it comes from running the sweep rather than from counting the faults I could think of.

The first run after the migration is why `test/wac/entry_test.wac` exists. Seventeen mutants
survived, one per entry point in `wacpkg.wac`: every wrapper in that module could be gutted to
`return ""` with the suite still green, because the TypeScript tests had been the only thing
calling them and the wac tests that replaced them go underneath. **Coverage did not show it** —
`cov.ts` drives the module from its own workload, so the lines ran and nothing checked what came
back. A covered line and an asserted one are different claims, and this is the gap between them.

An earlier version of this section counted 28 hand-planted faults against the TypeScript tests.
Two of those only fell to cases a canary found — `matchSpecifier` given exactly `std/`, which every
other case in the list was one byte too short to reach, and the writer's escape branches, which
nothing exercised until a mapping name contained a tab. Both cases are in the wac tests.

`root.wac` also started with a `withinOrEqual` guard *and* a walk, and the canary is what showed
that was wrong: a fault planted in the guard left the tests green because the walk still refused,
and one planted in the walk left them green because the guard still refused. Two implementations
of one rule, each hiding the other's mutation. The guard is gone.

Branch coverage is 99.7%, and the one unreached point is named in place: `applyPlan`'s guard
against a `steps` array that did not come from `plan`. `plan` itself makes it unreachable; it
exists because the function takes the array as an argument and cannot know where it came from, and
refusing is the answer there because a trap in a lockfile writer is not.

This paragraph used to describe a second unreached point, `root.wac:1:1  case` in a file with no
`match` in it — `issues/lang/0148`, an `else:` arm's coverage point charged to the entry module at
line 1, filed from this package and since fixed by somebody else, who found a conditionless loop
with the same fault while they were there. The point is gone and so is the sentence.
