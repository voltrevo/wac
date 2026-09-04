# wacpkg — the two import proposals, checked against the machinery

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, disposable.

**Nothing is rewritten.** This exercise invented two things about imports — a package entry point, so
a file writes `@/packages/http` rather than `@/packages/http/src/request.wac`, and re-export, so a
barrel can exist at all. Both are in [../README.md](../README.md)'s proposals table with a cost
beside them. Neither had been checked against the code that would have to implement it.

They land in two different places, and the existing architecture has an opinion about each.

---

## A package entry point is the resolver's, and the resolver has no filesystem

`packages/wacc/src/path.wac` resolves a specifier to a *key* by path arithmetic and nothing else.
`resolveFromAt(fromPath, spec, root, base)` takes four strings and returns one; there is no `Cli` in
sight, and `Res.empty()` is documented as *"what every caller without a filesystem passes"*.

So **a directory entry point cannot be a manifest field the resolver reads**, because the resolver
cannot read. Two shapes fit, and the second is already in the design:

**A convention.** `@/packages/http` means `@/packages/http/src/http.wac`, computed. Pure arithmetic,
no new concept, and wrong the moment a package wants its entry somewhere else.

**A mapping the reader computes.** `Res` already carries `mapFrom`/`mapSpec`/`mapTo` — parallel
arrays keyed by importing file and specifier — and `resolveVia` checks them *first*, with the reason
written at the line: *"A mapping first, because only the reader could have resolved one."* A git
dependency is resolved by the reader, which has a filesystem and a lockfile, and handed to the
resolver as an answer.

A directory entry is the same shape: the reader knows the layout, looks, and supplies the key. It
needs no new concept, it lets a manifest name the entry if that turns out to be wanted, and it
leaves `path.wac` pure. **The proposal should say "a mapping" rather than "a convention", and it did
not, because it was written without looking.**

## Re-export is not the resolver's at all

`./itoa.wac` already resolves. What fails is one step later: `errNoSuchExport`, code 56, *"that file
does not export this name"*, whose help string is the sentence this exercise kept quoting —
*"import it from the file that declares it — importing does not re-export."* That is `check.wac`,
the export table, not `path.wac`.

Worth knowing because the two proposals looked like one thing — *how imports should work* — and are
not related. Re-export could land with no change to path resolution whatsoever.

**And `check.wac` has already solved the diagnostic half of it, for a different cause.** Code 210
exists because 56's wording is false for built-ins:

> Its own code rather than better wording on 56, because the two are different facts: 56 is about a
> file, and this is about a *build step that has not been run*.

A barrel needs the same split again. *This file does not declare it* and *this file re-exports it
from somewhere that does not declare it either* are different facts, and the second is the one a
barrel makes reachable — a name misspelled in `core.wac` would otherwise be reported against
whichever file the reader was importing from.

## What this changes in the proposals table

Nothing is withdrawn. One is re-aimed — the entry point is a reader-computed mapping, not a
convention — and the two stop being one proposal. The costs already listed stand.

## What could not be written

**Nothing.** This is the first entry here whose finding is entirely about the existing
implementation, and that is the shape the exercise has been converging on since about the tenth
package: fewer constructs, more checking of what is already there against what was assumed.
