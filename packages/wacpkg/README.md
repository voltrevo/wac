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
    'acme':  { git: 'https://example.invalid/monorepo', ref: 'v1', subdir: 'packages/acme' },
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

## What it does not do, on purpose

**No I/O.** It takes the bytes of a manifest and answers with a table, or with the first thing
wrong with it. Where those bytes came from is the caller's, and that is not tidiness: D7's rule is
that `@/` is the nearest `wac.json5` *above the importing file*, which is a filesystem search, and
the compiler's own resolver deliberately does no I/O so that it can run in a browser. Splitting at
this line keeps the policy testable with no host and leaves the search with the code that already
holds a capability.

**No fetching.** D11 puts that on `packages/git`, `packages/http` and `packages/tls`, which exist.

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

## Errors

One failure rather than a list, and `detail` names the mapping it is about — "two names overlap"
without saying which two is a message that sends you back to read the file yourself. The checks
are ordered so a later one cannot be reached with an earlier one outstanding, so a list would be a
list of consequences.

The codes are in `src/manifest.wac`; `test/manifest.test.ts` reads them out of the source and
fails if its own copy has drifted, the way `packages/json` does.

## Tests

Every planted fault fails the tests: seven of seven in `manifest.wac`, seven of seven in
`root.wac`, eight of eight in `lock.wac`. Two of those only fell to cases a canary found —
`matchSpecifier` given exactly `std/`, which every other case in the list was one byte too short
to reach, and the writer's escape branches, which nothing exercised until a mapping name contained
a tab.

`root.wac` also started with a `withinOrEqual` guard *and* a walk, and the canary is what showed
that was wrong: a fault planted in the guard left the tests green because the walk still refused,
and one planted in the walk left them green because the guard still refused. Two implementations
of one rule, each hiding the other's mutation. The guard is gone.

Branch coverage is 99.5%, and the one uncovered point is not ours: it reports as
`root.wac:1:1  case` in a file containing no `match`. That is `issues/lang/0148` — an `else:` arm's
coverage point is charged to the entry module at line 1 — and it arrives here through the import
of `normalisePath`. Nothing to chase in this package.
