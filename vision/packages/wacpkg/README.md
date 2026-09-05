# wacpkg — the two import proposals, checked against the machinery

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, disposable.

**One file, added later.** [`src/resolve.wac`](src/resolve.wac) is the resolver as this directory
would have it, written when a *third* import question arrived and turned out to have the same answer
as the two below.

This exercise invented two things about imports — a package entry point, so
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

## Three proposals, one mechanism, and the mechanism already exists

A third question arrived on 2026-09-04: `vision/`'s own imports. Seventeen of them name twelve files
that are not in `vision/` and are in `packages/` at the same path — an **overlay**, and
`../../QUESTIONS.md` said flatly that it *"is not something the resolver can express"*.

Writing [`src/resolve.wac`](src/resolve.wac) showed that to be half wrong, and the half that is wrong
is the half this README had already found for the entry point.

- **An overlay is not a manifest key.** A key would mean *if absent, look over there*, and absence is
  a filesystem question the resolver cannot ask. That part stands.
- **But the reader can ask it**, and handing the answer over is what `mapFrom`/`mapSpec`/`mapTo` are
  for. Try `vision/<path>`, fall back to `<path>`, emit a mapping. Seventeen mappings, computed by
  something that already walks the files to read them.

Which is **exactly how a git dependency works** — a lockfile lookup by something with a filesystem,
handed to the resolver as an answer — and exactly what this README concluded a package entry point
should be. So the three are one shape:

| proposal | what it looked like | what it is |
|---|---|---|
| package entry point | a manifest field the resolver reads | a mapping the reader computes |
| git dependency | — | a mapping the reader computes (already) |
| overlay | a resolver feature that cannot exist | a mapping the reader computes |

**None of the three needs a change to `path.wac`**, which is the file all three were assumed to be
about. What remains of the overlay question is a real choice and a small one: is the fallback the
reader's *policy* — one flag, no language surface — or something a project *declares*, `{ overlay:
".." }`, which is still the reader honouring it rather than the resolver reading it.

## What could not be written

**A two-part map key.** `mapped(from, spec)` is a linear scan, in the shipped resolver and here.
`../../DECISIONS.md`'s *references are comparable but not hashable* means a `Map` key has to be built
out of the two strings, and `\0` does it — no path contains one. So the answer exists; what is
missing is that **the key is a string a caller can build wrongly**, and nothing relates
`key(from, spec)` to the map it belongs to.

One package wants it: this one. [`@/packages/wac`](../wac/)'s build cache composes a key from four
things and gets away with it by **hashing** them, so the composite is lossy and a wrong lookup is a
cache miss. Here a wrong lookup is a wrong file. **A composite key is cheap exactly when the lookup
is allowed to be wrong**, which is the useful form of this and is not a count.

**A `Mapping` is one value where the resolver has three parallel arrays.** `mapFrom`, `mapSpec`,
`mapTo`, keyed by position — the shape [`@/packages/webrtc`](../webrtc/) found five of in one struct,
at the size where it is cheapest to fix and easiest to leave.

**`mapped` answering `""` for *no mapping*.** A sentinel drawn from the value's own range, working
because an empty key is not a real key — the same accidental reason every instance of that shape
works. `string?` makes it a null check instead.

**A mapping is keyed by the importing file, so a file reached two ways needs two.** `resolveFromAt`
collapses `.` and `..` precisely because *"the same file reached two ways would otherwise be two
entries in `paths`"*, and a mapping's `from` is one of those keys, so it inherits the rule and
nothing states it. Harmless for an overlay, which is per specifier occurrence; for a git dependency
resolved once and used by many files, one dependency is N mappings.



**Nothing.** This is the first entry here whose finding is entirely about the existing
implementation, and that is the shape the exercise has been converging on since about the tenth
package: fewer constructs, more checking of what is already there against what was assumed.

**The constructor obligation exists, and it is in this package.** Added with
[`src/lock.wac`](src/lock.wac). `plan(Manifest, Lock)` is pure and returns one decision per mapping,
so a caller that wants to resolve a ref must have been handed a step saying so — *"a value a caller
cannot ignore rather than a comment telling it what not to do."* That is what
[`../quic/`](../quic/)'s entry asked a language to provide an hour earlier, and it needs **no
language feature**: separate the decision from the action, return the decision, and the action is
unreachable without it. Promoted as a correction to that entry.

It also sharpens the obligations entry: **an obligation discharged once per decision is a return
value; one discharged continuously has no call to hang on.** `quic`'s frame epochs and this lock rule
are the first kind and need nothing. `ssh`'s window adjust is the second and is the only one of the
three still asking.

**And the same file gives the value back twenty lines later.** `Step` carries `i32 action` with
`USE`/`CREATE`/`REFRESH` as bare integers, plus `string commit` *"set only for USE"* and `string why`
*"for REFRESH … `""` otherwise"* — so a caller reading `commit` after a `CREATE` gets `""`. The file
wins the argument it set out to win and then hands back the part the value was for. Sharpest evidence
in the tree that **getting the obligation right does not carry you through the encoding**: same
author, twenty lines apart, explicitly thinking about the first.

**A `string` payload that is right.** `why` goes to a human, nothing branches on it, and the set of
reasons is open because a future manifest field adds one. So *a member with a `string` payload is a
fault that has given up on being matched* needs its converse: a `string` payload is right exactly
when no caller will branch on it.

**Uniqueness of a field, which no collection type here carries.** `design/lang/0009` D10 makes every
mapping lock independently — *"even when several mappings name one repository"* — so two entries
with one name is a corrupt lockfile and `Vec` cannot say so. Third form of the collection-invariant
problem, after a sorted `Table` and an eight-element `Pieces`: not order, not length, but uniqueness.

**And the two-part key has three costs in one package.** `resolve.wac` already noted that a composite
key is cheap exactly when the lookup is allowed to be wrong. `wac`'s build cache hashes and a wrong
lookup is a miss; the resolver's is a wrong file; the lockfile's is **another mapping's commit** —
the exact failure D10 exists to prevent. Nothing distinguishes the three where the key is built.
