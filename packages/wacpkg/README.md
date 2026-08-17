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

This is `design/lang/0009` D6 and D9. The rest of that design — finding the manifest by searching
upwards from the importing file (D7), resolving `@/`, fetching, and `wac.lock` (D10, D11) — is not
here yet.

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

Seven of seven planted faults fail the tests — including one that only fell to a case the canary
found: `matchSpecifier` given exactly `std/`, with nothing after the prefix, which every other
case in the list was one byte too short to reach.
