# 0001 — import resolution, `core`, and what packages inherit

- **Status:** active
- **Opened:** 2026-08-06
- **Written by:** agent-c, from a design conversation with the operator

## What we are aiming at

Every import in wac was a relative file path — `spec/spec/imports.md` said, before step 1 of this
landed: *"Import paths are relative, using `./` or `../` prefixes."* That was the whole of the module
system, and it held up well for a single tree.

It stops holding the moment there is more than one tree. That case used to be wac-mono's issue 0092,
moving the capability layer into a repo of its own — **decided against on 2026-08-11**, one wac repo
for the foreseeable future, so this design no longer has a caller waiting on it inside the
repository. What it has instead is the case it always had further out: a package service, for which
the operator has the name **whackage**. That still needs the same thing: **a prefix that resolves to
a set of wac sources which need not be a directory on disk.**

Arriving looks like this:

```wac
import { Read } from core;                      // ships inside the compiler
import { Buf } from "../../bytes/src/buf.wac";  // unchanged
```

What it is **not**: a build system, a lockfile format, or whackage itself — and it deliberately does not
propose a specifier syntax for fetched packages, because nothing needs one yet. What it *is* is the
resolution mechanism those would be built on, plus the one constraint the language forces on them (D7).

## Why this is small in the compiler and large in consequence

**Two resolvers exist.** `compiler/wacx.ts` walks the graph for the CLI, and wac-mono's
`harness/wacFiles.ts` does the same for its harness. Both now read imports off the *parsed program*
rather than by matching text, so both already have one place where a specifier becomes a file.

**`wacCompile` already takes a source map.** Its signature is `wacCompile(files: Map<path, string>,
entry, options)` — the browser playground compiles with no filesystem at all. So "sources that are not
on disk" is not a new idea here; it is the idea the playground has been using without a name.

**The frontend table is the shape to copy.** `compiler/wacFrontend.ts` maps an extension to a parser,
and everything downstream takes a `Program` and cannot tell which ran. A resolver table is the same
move one level out.

## Decisions

**D1 — a prefix maps to a *provider*, not to a path.** "Directory" is the wrong noun, because only one
of the four kinds is a directory:

| provider | who uses it |
| --- | --- |
| embedded in the compiler | `core` |
| a directory | a local checkout, a vendored package |
| fetched from somewhere else | a package service, later |
| an in-memory map | the playground, tests, `wacCompile` today |

**D2 — a provider answers with a frontend, not just with text.** The extension currently selects the
frontend: `.wac` parses with `wacParse`, `.wapy` with `wapyParse`. A prefixed specifier like
`core.read` has no extension, so the provider's interface is `read(name) -> { source, frontend }`
rather than a path lookup. A provider knows its own contents; the caller should not have to guess. Two
files differing only by extension inside one provider is an error rather than a precedence rule.

**D3 — a prefix boundary is a resolution boundary.** Sources inside a provider may import relatively
*within* it, or by another prefix, and never `../` out of it. Without this, `core` stops being
embeddable the first time something reaches sideways, and a fetched package could read the importing
project's files. It is cheap to check and expensive to retrofit.

**D4 — the reserved prefix is `core`, not `std`** (operator). Rust's distinction is exactly the one
that applies: `core` is the minimal, always-available part; `std` is the larger library above it. What
belongs here is not a standard library — see D6 — so `core` is the accurate name, and it leaves `std`
free to be a whackage package later. That would be a good first one: it demonstrates the package system
is real rather than special-cased.

**D5 — `core` is syntax, not a reserved string** (operator's lean, and I agree):

```wac
import { Read } from core;
```

A quoted specifier means *a file lives at this path*. `core` is not a file — it is inside the compiler,
it cannot be remapped, and its version is the compiler's version. Spelling it `"core:read"` is a small
lie a reader has to know to decode, and it invites the question "can I point that somewhere else?", to
which the answer must be no. If `core` grows past one module, `from core.read` extends compatibly.

The cost, stated plainly: the resolver has one mechanism with two front doors, so "everything is a
prefix in one table" stops being literally true. That is worth paying because `core` genuinely is
different in kind, and encoding "different" as "different-looking" is the honest move.

**D6 — `core` holds only what *must* have one identity.** The rule, and it is a test rather than a
taste:

> Does a value of this type have to cross a repo boundary through a funcref signature? If not, it is a
> library and belongs in a package.

`Read` qualifies. A streaming transform names the exact type its source produces —
`gunzipStream(fn[Read()] read, …)` — and **wac has nominal types and no closures**, so no adapter can
convert one declaration of `Read` into another. Two copies are two types, proven:

```
error: type mismatch: expected fn() -> Read, got fn() -> ReadB
error: type mismatch: expected Read, got End
```

`Buf` does not qualify: it is a data structure, and callers can hold their own. `Option` and `Result`
are the interesting edge — they would qualify the moment a capability returned one, and today none
does. Measured on wac-mono's capability signatures, the types named are `Pending`, `Change`, `Socket`,
`Stat`, `Child`, `Event`, `Picked`, `FileResult`, `Captured` — all defined by the capability layer
itself — and `Read`, which is not. **`Read` is the entire case for `core` today.** A vocabulary of one
is the right size to start at.

**D7 — a package system built on this must resolve to one version per package, globally.** This
follows from the language rather than from preference, and it is the most important thing in this
document.

If packages A and B both depend on C, and any type of C's crosses between them, they must be the *same*
C. Cargo permits two versions of a crate in one build and produces the familiar "expected `foo::Bar`,
found `foo::Bar`" — annoying but survivable, because Rust has closures and the seam can usually be
converted. **wac has none**, so there is no adapter to write: the call cannot be made at all, and the
only remedy is changing a dependency.

So whackage needs flat resolution — closer to Go's minimal version selection than to npm's nested tree.
Deciding it now costs a paragraph; discovering it later costs a manifest format.

The same reasoning is why D4's `core` is embedded and versioned with the compiler rather than being an
ordinary package. If `core` could be diamonded, `Read` would fracture and every streaming transform in
the ecosystem would stop composing with every other.

## Order of work

1. **The provider table, with two providers.** `core` (embedded) and the existing relative-path
   resolution, expressed through one mechanism. Done when a program importing `from core` compiles in
   `wacx`, in `wacCompile` from an in-memory map, and in the browser playground — the last of which
   proves the embedding, since it has no filesystem.
2. **`Read` moves into `core`.** Done when nothing declares it but `core`. Planned as two steps — a
   re-export first, so nothing changed shape, then the re-export removed — and done as one, because
   two spellings that both compile invite new code against the old one. 25 files across seven
   packages (`box`, `gzip`, `platform`, `sh`, `ssh`, `stream`, `tor`) changed in a single commit.
3. **A directory provider.** A prefix pointing at a checkout. Its motivating caller was issue 0092,
   which is closed — the capability layer stays here — so this is now the first half of *whackage*
   rather than something a package in this repo is blocked on. Done when a prefix can name a set of
   sources that is not a directory beside you.
4. **`spec/spec/imports.md` gains the resolution rules**, with tags and tests, at which point steps 1
   to 3 stop being design and become behaviour.

Whackage is deliberately not on this list. It is a destination that this direction makes possible, and
it should be its own document when somebody is ready to build it — carrying D7 with it.

## State of play

| step | state |
| --- | --- |
| 1. provider table, `core` embedded | **done** — `compiler/wacCore.ts`, one prefix and one module. Compiles and runs through `wacx`, through `wacCompile` from a map, and in the playground (`The core Module`, which is the embedding's proof: no filesystem there) |
| 2. `Read` into `core` | **done** — `core` declares it, and wac-mono's 25 importers name it there. `packages/bytes/src/read.wac` is deleted, with no re-export |
| 3. directory provider | not started — `importKey` is where it goes |
| 4. specified in `spec/` | **done for `core`** — `§wac-core-one-type-8fjm2wq`, `§wac-core-unquoted-3nqk7vd`, `§wac-core-read-6kv4pnx`, `§wac-wapy-core-5wq8jhn`. Step 3 will add to it |

Two things the implementation settled that the design had not:

- **`from "core"` is an error, not a synonym.** A quoted specifier joins against the importing file's
  directory and lands on the same key, so without a check it would reach the embedded module through
  something that reads as a path. There is one spelling.
- **The diamond test needs its negative control.** "Two files agree on `Read`" passes just as well if
  types are matched by name or by shape, so a hand-written copy that must *still* be rejected is
  what makes the other test mean anything.

## Open questions

- **Whether `core` is one module or several.** It holds one type today, so `from core` is enough and
  `from core.read` is the growth path. Deciding now would be deciding without evidence.
- **How a fetched package is named and keyed.** Left open on purpose: no specifier syntax is proposed
  here, and D7 is the only thing this document asks of whoever picks one.
- **Whether `.wapy` sources can live in `core`.** D2 says a provider names its own frontend, so
  nothing forbids it. Whether the language's own vocabulary should be written in more than one surface
  is a separate question, and the answer is probably no.
