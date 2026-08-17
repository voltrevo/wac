# 0009 — an installable toolchain, source built-ins, and locked Git imports

- **Status:** active
- **Opened:** 2026-08-17
- **Written by:** agent-a, from [github.com/voltrevo/wac#20](https://github.com/voltrevo/wac/issues/20) and the operator's ruling on it
- **Supersedes:** parts of [design/lang/0001](0001-import-resolution-core-and-what-packages-inherit.md) — D4, D5, D6 and its flat-resolution argument

## What this is for

There is no supported path from cloning this repository to developing an independent wac project.
The pieces mostly exist; an external user has to understand repository-internal Deno tasks, place a
binary on `PATH` by hand, and vendor or submodule this repository to import anything.

[0001](0001-import-resolution-core-and-what-packages-inherit.md) built the resolver half and
deliberately stopped short of *"a build system, a lockfile format, or whackage itself"*. This note is
those three, and it changes four of 0001's decisions on the way. The upstream issue is the long form;
this is the version that binds, because GitHub is not the source of truth for this repository.

## The decisions

**D1 — `wac` is installed, not found.** `deno task wac:install` builds the native V8 command and
installs it under `$WAC_HOME` (default `$HOME/.wac`) as `bin/wac`, `cache/git/`, `env` and
`install.json5`, adding one recognisable idempotent line to supported shell profiles. Deno bootstraps
the build and is not needed to run the result. `deno task wac:build -o ./wac` produces an uninstalled
binary. `wac uninstall [--keep-cache]` removes the binary, the cache, the profile line and the
metadata, and never a manifest, a lockfile, a source file or a build product.

`app:wacbin` becomes `app:native-binary`, which is what it always was: the generic builder, not the
dedicated one.

**D2 — the fixpoint is a property of the command, not of a test.** `wac:build` and `wac:install`
bootstrap compiler module B, build a native `wac` containing it, ask *that* binary to compile the
same sources into C, and compare B and C byte for byte. A mismatch fails the build with a diagnostic
and leaves the destination alone. The existing focused tests stay; this stops a compiler that merely
compiled once from being published.

**D3 — `core` and `std` are embedded source trees, not string literals.** Both are ordinary wac
sources inside the binary, reached through the same provider interface as the filesystem and Git, and
each carries its own `wac.json5` — as metadata and as the anchor for its internal `@/`. After
resolution they go through the ordinary checking and compilation pipeline.

This retires the duplication: `core` is a string literal in **two** places today,
`compiler/wacCore.ts` and `packages/wacc/src/emit.wac`, and every addition has to be made twice.

**D4 — `core` is the pure part, `std` is the capability part.** `core` holds `Read`, the JSX types
`Attr` and `Node`, and the whole of today's `packages/std` — `Option`, `Result`, `Vec`, `Map`,
hashing, equality — plus future generally useful code needing no capability. wac is garbage
collected, so there is no reason to reproduce Rust's `alloc` boundary and collections live in `core`
directly. `std` is what is entangled with the host: `Core`, `Cli`, filesystem, network, processes,
environment, terminal, clocks, randomness, page.

```wac
import { Read } from "core";
import { Option } from "core/option.wac";
import { Core, Cli } from "std/platform.wac";
```

`core`, `core/`, `std` and `std/` are reserved, cannot be remapped, and never appear in `wac.lock`.
Their versions are the toolchain's version.

**D5 — module specifiers are quoted, including the built-ins.** `from core` goes; `from "core"`
arrives.

**D6 — a project is a directory with `wac.json5`.** An empty manifest is valid. JSON5 rather than
JSON for all new manifest and lockfile structures, with deterministic formatting when generated. The
initial project-facing field is an import map of Git mappings. A project using only relative imports
needs no manifest; a manifest is required to define mappings or to use `@/`.

**D7 — `@/` is the root of the project containing the *importing file*.** Discovered from the source
by searching upwards for the nearest `wac.json5`, stopping at the provider boundary — the embedded
package root, the Git checkout root, the mapped `subdir`, or the local-filesystem boundary. No
manifest within that boundary is a compile error. A Git lookup never continues above its checkout
into the cache's own layout, and mapping a subdirectory does not declare it the `@/` root.

**D8 — identity is canonical after resolution, not by spelling.** Resolve the specifier to a provider
and a normalised path; use that as the module-graph key. For Git, identity is the repository, the
resolved commit and the repository-relative path — the mapping name, the requested ref and the
configured `subdir` govern reachability, not identity. So `./foo.wac`, `@/src/foo.wac` and a mapped
spelling of the same file are one module with one set of nominal types. Every import edge still has
to satisfy its own mapping's confinement; canonicalisation must not let a module first reached
through a broad mapping slip past a narrow one's rules.

**D9 — mappings do not overlap.** Names are exact or slash-terminated prefixes; `wac/` beside
`wac/packages/json/` is rejected when the manifest is read, as is `foo` beside `foo/`. `wac/` and
`wac2/` are fine. No longest-prefix precedence: a specifier has at most one possible mapping. For a
prefix mapping the unmatched suffix is appended to the mapping's `subdir`, normalised, and rejected
if it escapes through `..`, a symlink or anything equivalent.

**D10 — every mapping locks independently.** `wac.lock` at the project root, JSON5, one entry per
mapping repeating the inputs and recording the full commit SHA — even when several mappings name one
repository. Ordinary commands may create a missing entry and must never advance an existing valid one
because a branch moved; `wac update [name]` is the explicit operation, and a locked/CI mode fails
instead of writing. The cache may deduplicate by repository and commit; lock ownership stays per
mapping.

**D11 — fetching is wac, not Rust.** Dependency resolution and fetching use this repository's Git,
HTTP, TLS and filesystem implementations wherever measured performance allows. Rust provides only
what cannot reasonably be wac. Package policy, lockfile semantics, Git protocol and JSON5 handling do
not get a second implementation in the native layer without a demonstrated need. The cache lives at
`$WAC_HOME/cache/git/`, and a locked commit is usable from it without consulting a moving branch.

First implementation: public repositories over HTTPS, with `git`, `ref` and optional `subdir`. SSH,
private credentials, registries, package names, semver solving and non-Git sources are out of scope.

## What changed from 0001, and why the arguments there needed answering

Four of 0001's decisions are reversed. Two were the operator's, so the reversal is theirs to make;
what follows is the reasoning each one now rests on, because a decision with a written argument
should not be dropped in silence.

**0001's D4 said `std` stays unreserved**, so that it could be whackage's first package and
demonstrate the system is real rather than special-cased. It is reserved now. The demonstration has
to come from somewhere else — the Git mappings in D9 are the obvious candidate, since they are the
whole mechanism exercised by anyone who uses it at all.

**0001's D5 said `core` is unquoted**, on the argument that *"a quoted specifier says a file lives at
this path, and there is no path here to be right or wrong about"*. Under D6 there is now a path:
`core/option.wac` names a file inside an embedded tree, and the tree has a manifest at its root like
any other. The argument held while `core` was one module with no interior; it does not once `core` is
a package.

**0001's D6 set a high bar for `core`** — *"does a value of this type have to cross a repo boundary
through a funcref signature? If not, it is a library and belongs in a package"*. `Vec` does not meet
that test and is in `core` now. The bar was drawn when `core` was the only thing that could not be a
package, so everything else had to be excluded; with `std` also built in and whackage able to carry
libraries, `core` is free to be the pure-code shelf rather than the minimum that must have one
identity.

**0001 argued for flat resolution**, and called it *"the most important thing in this document"*:

> If packages A and B both depend on C, and any type of C's crosses between them, they must be the
> *same* C … **wac has none** [no closures], so there is no adapter to write: the call cannot be made
> at all, and the only remedy is changing a dependency.

**That invariant is still true.** What changes is what follows from it. It does not mean the
toolchain should *prevent* two versions of C; it means two versions cannot exchange C's types, which
is a property of the program rather than a reason to refuse the configuration. A user who writes two
mappings at two commits has said what they want, and D10 keeps them apart on purpose. Where the types
never meet, nothing is wrong. Where they do, the compiler says so in the ordinary way.

The consequence is that **making C consistent is a later feature, not a constraint on the manifest
format**. A future extension makes agreement easy to ask for — the shape 0001 reaches for with
minimal version selection is one candidate — and it can arrive without changing what is written here,
because per-mapping locks are a superset of one-version-per-repository rather than an obstacle to it.

## Order of work

1. **The fixpoint in the command** (D2). Small, and the machinery exists: `selfHostEmit` and
   `fixpointEmit` already do the comparison and `deno task seed` already builds B. Doing it first
   means everything after it is published under the check rather than beside it.
2. **De-duplicate `core`** (D3, first half). Both compilers stop carrying it as a string. Nothing
   below is safe until an addition to `core` is one edit.
3. **`core` and `std` as embedded trees** (D3, D4). `packages/std` moves into `core`; the platform API
   becomes `std`. The reference must keep compiling wacc's own sources —
   [0003](0003-the-spec-targets-wacc-and-the-reference-becomes-a-seed.md) fixes it as the source-only
   seed — so the embedded trees have to stay inside the shared subset.
4. **Quoted specifiers** (D5). A spec rule inverts and 65 files change; mechanical once 3 lands.
5. **`wac.json5` and `@/`** (D6, D7). The provider table from 0001 step 3 is where the directory
   provider goes.
6. **Canonical identity** (D8). See the warning below.
7. **Git mappings and `wac.lock`** (D9, D10, D11).
8. **`wac:install`, `wac uninstall`** (D1).

## State of play

| step | state |
| --- | --- |
| 1. fixpoint in the command (D2) | **done for the production path.** `tools/seed.sh` compares the compiler the binary produces against the one a binary containing it produces, and restores the previous seed rather than keep a mismatch. `wac:build` and `wac:install` do not exist yet (D1) and inherit it when they do |
| 2. de-duplicate `core` (D3) | not started, and **it is not a copy-paste job** — the two embeddings differ *by design* and neither compiler can read a file at runtime. See below |
| 3. `core` and `std` as embedded trees (D3, D4) | not started — `packages/std` is `hash, map, option, result, vec` and moves whole |
| 4. quoted specifiers (D5) | not started — inverts `§wac-core-unquoted-3nqk7vd`, 65 files use the current form |
| 5. `wac.json5` and `@/` (D6, D7) | **started at the bottom.** `packages/json` reads JSON5 (`parseJson5`), measured against `npm:json5`; the manifest, the provider table and `@/` are still open. 0001's step 3, the directory provider, is the same work; `importKey` is where it goes |
| 6. canonical identity (D8) | not started — see below |
| 7. Git mappings and `wac.lock` (D9, D10, D11) | not started — `packages/git`, `packages/http` and `packages/tls` exist to build it on |
| 8. `wac:install`, `wac uninstall` (D1) | not started — `app:wacbin` is renamed to `app:native-binary` here |

Nothing has landed. The counts above were read on 2026-08-17 and are the reason the order is what it
is: 2 before 3 because otherwise five more files get duplicated, 3 before 4 because the migration is
mechanical only once the trees are real.

## Step 2 is not the copy-paste it looks like

Measured before starting it, and worth knowing before anybody else does.

**The two embeddings are not the same text, and should not be.** `compiler/wacCore.ts` holds `Read`
and nothing else — 1077 characters, most of it the argument for `core` existing. `coreSource()` in
`packages/wacc/src/emit.wac` holds `Read` **plus `Attr` and `Node`**, 239 characters with the
comments deliberately left out. That is not drift: it is the row `compiler/README.md` already
carries — *"`Node` and `Attr` in `core` | no | yes"* — because JSX lands in wacc alone.

So a guard asserting the two agree would be wrong, and a generator writing one text into both would
delete a documented omission. Whatever replaces them has to be able to say *this declaration is
wacc's alone*, which is a third thing neither copy expresses today.

**Neither compiler can read the source at runtime.** `wacCore.ts` says why: the reference is bundled
into the playground and "must reach the browser with no filesystem". wacc's copy is inside a wasm
module. So "stop carrying it as a string" cannot mean "read `core/read.wac`" — both keep a literal,
and de-duplication means *generating* both from one tree, with the omission expressed in the tree
rather than by two people maintaining two files.

That makes step 2 larger than it reads and couples it to how omissions are represented, which is
`compiler/README.md`'s table today. Worth settling that before writing the generator, because the
generator is where the answer gets encoded.

## Two things that make a byte comparison lie, found building step 1

Both cost a wrong answer before they were noticed, and both matter again at D8.

**A module embeds its own output name.** Building one source tree to `-o B` and to `-o C` with a
single compiler gives two files of equal length differing in exactly one byte. Any comparison across
different output names therefore reports a difference and means nothing. The stages in
`tools/seed.sh` are written to the same basename in different directories for this reason.

**The Deno path and the binary path are different pipelines.** `packages/platform/native.ts` and
`wac build` emit artefacts 18 bytes apart from identical sources. Comparing one against the other
measures the two toolchains, not the compiler — so a fixpoint check has to take both stages from the
same one.

Neither is a defect. Both are the kind of thing that makes a differential agree or disagree for a
reason that has nothing to do with what it claims to test, which is why they are written down here
rather than only in the script.

## Two things about step 5, found reading for it

**`@/` cannot be resolved where specifiers are resolved today.** `packages/wacc/src/files.wac`
turns a specifier into a key and deliberately does no I/O — "a compiler that reads files is a
compiler that cannot run in a browser" is its opening paragraph, and `emitFiles` takes `paths` and
`sources` already read. But D7 says `@/` is found by *searching upwards for the nearest
`wac.json5`*, which is I/O, and the search cannot be hoisted to a single startup step either: the
root depends on the importing file, so a graph spanning two projects has two roots.

So the split is that the caller that already reads files resolves `@/`, and the pure half is told
the root for the file it is resolving from — `resolveFrom(fromPath, spec)` gains a third argument
rather than gaining a capability. That keeps the browser property and keeps the provider-boundary
rule (D7) with the code that knows where the boundary is.

**The walk exists four times.** `harness/wacFiles.ts`, `compiler/wacx.ts`,
`packages/wacc/example/wacc.wac` and `packages/wacc/src/api.wac` each queue a path, read it, ask for
its import specifiers and resolve them. Today they agree because the rule is two lines. A manifest
lookup, a provider table and a mapping table are not two lines, and four copies of *that* will
diverge — the first symptom being a program that compiles under `wac build` and not under the
harness, or the reverse. Consolidating is not part of D6 or D7, but it is the thing that decides
whether they cost one edit or four, and it should happen before the mappings land rather than after.

## The one to be careful with

**D8 is not a resolver nicety.** Nominal identity rides on it, and getting it wrong produces two
incompatible copies of one struct — a program that type-checks, runs, and fails at a seam whose error
message names the same type twice. It is the failure mode 0001 spent its longest paragraph on, and
the reason that paragraph is quoted above rather than summarised.

It deserves a differential rather than cases somebody thought to write: the same file reached by
`./foo.wac`, by `@/src/foo.wac`, by a whole-repository mapping and by a `subdir` mapping, asserted to
be one module — and two mappings at different commits asserted to be two.

## Acceptance

The upstream issue's checklist is the acceptance criteria and is not copied here, because a list in
two places is a list that drifts. What is copied is the decisions, because those are what the rest of
this repository has to agree with.
