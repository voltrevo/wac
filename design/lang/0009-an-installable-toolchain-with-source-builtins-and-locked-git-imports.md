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
dedicated one. *(2026-08-18: done — the task, `packages/platform/nativeBinary.ts`'s usage line,
`native/v8/README.md` and the test that names it. Closed issues keep the old spelling, because they
record what somebody typed on a day.)*

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
| 2. de-duplicate `core` (D3) | **done** (2026-08-18). `core/read.wac` and `core/jsx.wac` are the source; `deno task gen:core` writes `compiler/wacCore.ts` and `packages/wacc/src/coretext.wac`, and `--check` fails when either drifts. The omission is expressed by *which file a declaration is in*, so the reference gets `read.wac` alone — see below, and `core/README.md` |
| 3. `core` and `std` as embedded trees (D3, D4) | **`core` is a tree; `std` is untouched** (2026-08-18). `core/` holds `read` and `jsx` as the root and `option`, `result`, `hash`, `map` as siblings, each its own module reached as `"core/option.wac"`, with its own tests under `core/test/` and `deno task coverage:core`. `vec` moved with the rest and **`packages/std` is gone** — `core/` is `read`, `jsx`, `option`, `result`, `hash`, `map` and `vec`. The seam is in three resolvers and both compilers; see below. `std` as the *capability* tree (D4's half: `Core`, `Cli`, filesystem, network) has not been started |
| 4. quoted specifiers (D5) | **done** (2026-08-19). Every specifier is a quoted path, `core` included: both compilers accept `"core"` and `"core/option.wac"`, the 54 files using the bare form were swept, and the bare form is now an error — `core` gets its own message telling you to quote it, anything else is `unknown module`. `§wac-core-unquoted-3nqk7vd` states the removal and `§wac-core-one-key-5jm2qhx` keeps the property the old clause was really about: however the root is reached it is one module, which nominal types make load-bearing. `spec/spec/grammar.md`'s `source` is `STRING` now. wapy is untouched — a Python-shaped `from X import` names its module bare whatever X is, so the two surfaces still agree about the module and differ only in syntax each already had. |
| 5. `wac.json5` and `@/` (D6, D7) | **`@/` works, in both compilers** (2026-08-19), with `§wac-import-project-4hq7mnv` and a differential that compiles every fixture with each of them. The upward search for `wac.json5` lives with whichever caller already reads files — `harness/wacFiles.ts` and `gather` — and finds a manifest without reading one, so the JSON parser stays out of the compiler's graph. What is left of D6 is the manifest's *contents*: mappings are D9-D11. The shape was decided first — see *How `@/` gets its root* below. The consolidation this step was waiting on is done: two resolver bodies, one per language, and the change was additive rather than a 22-signature sweep because the hundred-plus call sites have no root to give. **started at the bottom.** `packages/json` reads JSON5 (`parseJson5`), measured against `npm:json5`; `packages/wacpkg` reads the manifest and enforces D9's non-overlap. What is left is the half that needs a capability, and the API change under it — the upward search works and the linker resolves the specifier a second time from a function with no root, so `@/` costs a parallel `roots` through `api.wac`. See below — 0001's step 3, the directory provider, is the same work |
| 6. canonical identity (D8) | not started — see below |
| 7. Git mappings and `wac.lock` (D9, D10, D11) | **the pure half is done.** `packages/wacpkg` enforces D9's non-overlap, reads and canonicalises `wac.lock`, and `plan` decides USE/CREATE/REFRESH per mapping — including the rule that a moved branch is not a reason to re-resolve. `refToCommit` resolves a ref to a commit, measured against real `git` — an object name, an exact advertised name, then `refs/heads/` or `refs/tags/`, with an ambiguous name refused rather than ranked, and an annotated tag's peel preferred because the two advertised lines name different objects. The cache **layout** is settled too — `cachePath` is `$WAC_HOME/cache/git/<escaped repository>/<commit>`, a function of those two and nothing else, with the repository name escaped reversibly rather than hashed or slugified. Settled before anything fetches on purpose: a cache key lives in people's home directories and cannot be changed later without a migration. **Fetching works**: `packages/wacpkg/example/fetch.wac` resolves, fetches over `packages/git`+`packages/tls`, verifies the commit is in the pack by content address, writes it to the cache and updates the lock — 7.6 MB and 2618 objects from `github.com/voltrevo/wac`, and a second run fetches nothing, which is D11's sentence demonstrated. **Done** (2026-08-19): the fetch checks the tree out as files beside the pack — reusing the `Pack` the commit verification already opened rather than indexing the same objects twice — and `wac build` resolves a mapped specifier to `cachePath(repo, commit)` plus the repository-relative path and opens it. Demonstrated end to end against `github.com/voltrevo/wac`: 8 MB and 2725 objects fetched, tree checked out, and a program importing `dep/cases/0001-….wac` through a `subdir: "spec"` mapping compiled and answered 3. `§wac-import-mapped-6np2rkq`, `packages/wacc/test/wac/mappedspec_test.wac`. The **whole** tree is written rather than the mapping's `subdir`, deliberately: the cache is keyed by repository and commit alone, so two mappings with different subdirs share one checkout, and extracting per mapping would make the cache a function of three things and quietly break the identity D8 rests on. What is left of this step is `wac update` as a command — the fetcher is `packages/wacpkg/example/fetch.wac`, a program you build, rather than a subcommand D10 names |
| 8. `wac:install`, `wac uninstall` (D1) | **done as tasks.** `tools/install.ts` builds the seed fixpoint-checked, installs `bin/wac`, `cache/git/`, `env` and `install.json5` under `$WAC_HOME`, and adds one marked line to the profiles that exist — replaced rather than left when it points at a different home, which is how a reinstall to a new `$WAC_HOME` works. `wac:uninstall [--keep-cache]` removes those and the profile line, and nothing else. **`wac uninstall` is a subcommand as of 2026-08-19**, which is what D1 asked for and what the task cannot be: the task is a Deno program under `tools/`, so it needs this checkout, and somebody who installed the command has a `$WAC_HOME` and no checkout. The layout is written down twice now — Rust in `native/v8/src/main.rs` and TypeScript in `tools/install.ts`, with nothing to share it through — and `packages/wacc/test/wac/uninstall_test.wac` is what keeps them one list: it builds the same fake install twice, takes one away with each, and compares what survives, with a canary so that two uninstallers that both did nothing cannot agree their way to green. `app:native-binary` is renamed (2026-08-18) |

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

*(2026-08-18: **every addition to `SIBLINGS` needs `seed:bootstrap`, not `seed`.** The seed carries
its own copy of the list, so a compiler that does not yet know `core/map.wac` is a built-in resolves
it against the importing file's directory and reports `cannot read packages/fs/src/core/map.wac`. It
cannot build its own successor. `seed:bootstrap` goes through the reference, which has the
regenerated list, and then the normal path works again. Twice now, and it is a property of the
design rather than a mistake — worth knowing before the third.)*

*(2026-08-18: settled and built. **The file is the unit of omission** — `core/read.wac` goes to both
compilers, `core/jsx.wac` to wacc alone, and `tools/genCore.ts` holds the two lists. The alternative
was a marker inside one shared file, which is a third thing to invent, to parse and to keep true for
a distinction a directory already draws; and D3 makes `core` a source tree regardless, so this is on
that path rather than beside it.*

*(2026-08-18, later: **the concatenation was not the cost, and this paragraph guessed wrong.**
Measured by changing it — one string literal per file instead of one per line — regenerating and
reseeding: the generated wac shrank 10,442 to 8,008 bytes and the seed moved 800,077 to 798,974.
**1,103 bytes, 0.1%.** So the per-line form is reverted, because the reason it was chosen still
holds — a one-line change to `core/` stays a one-line diff in a generated file that is checked in —
and it costs almost nothing.*

*(2026-08-18, third measurement, and it corrects the one below: **the text costs about 2.8x, not
about 1x.** `hash` and `map` moved with the seam already paid, so their delta is purely text —
11,033 bytes of source against **+31,096 bytes of seed**, 800,077 to 831,173. The paragraph below
guessed linear from a delta that was mostly one-off machinery, which was the wrong inference from
the right observation. `vec` at 5,934 bytes should therefore cost about 16 KB, and the whole of
`packages/std` in `core` is roughly 9% on a seed that began this session at 777 KB.*

*It is not the concatenation — that was measured and reverted at 0.1%. **And it is not what a wasm
module costs to carry a string literal, which is what this paragraph used to say and was written from
a model rather than from `emitExprAt`.** There are no bytes to carry: `packages/wacc/src/emit.wac`
emits a literal as one `i32.const` **per character**, then `array.new_fixed`. That is one byte of
opcode plus one byte of signed LEB below `0x40` and two at or above it — and lowercase letters are
`0x61`-`0x7A`, so identifiers and prose take the three-byte path. Predicted from the byte
distribution of the two files measured here, 4,104 below and 6,929 at or above: 28,995 bytes, 2.63x,
against 31,096 measured. The rest is the per-line concatenation and function overhead. `issues/lang/0162`. Worth knowing
before `core` grows past collections, and worth measuring again rather than extrapolating, since
this is the second extrapolation in this paragraph and the first was wrong.)*

*Which relocates the question. The 5.9 KB step 2 added, and the 17 KB step 3's first move added, are
mostly the **seam** — `coreFile`'s dispatch, `isBuiltinSpec`, `sourceOf` and `resolveFrom` — which is
one-off and already paid. The text itself is close to linear. `vec`, `map` and `hash` are 16,967
bytes between them and should cost about that, not a multiple of it. Worth re-measuring after the
next move rather than trusting this sentence too.)*

*Two things worth knowing before step 3 does the same for `std`. The reference's embedded text is
**byte-identical** to what it replaced, which is the check worth having — the reference sees exactly
the source it saw before. And wacc's copy gains the comments it had deliberately been written
without: the seed went 777,000 to 782,937 bytes, **5.9 KB rather than the ~800 bytes the text alone
would suggest**, because the generated file spends code on a per-line concatenation as well as the
strings. It is still a fixed point after one round. If step 3 multiplies that by the whole of
`packages/std`, the concatenation is the thing to reconsider, not the comments.)*

## Step 3 is a provider seam, and there is not one yet — measured 2026-08-18

Read before starting it, the way step 2's section was.

**`core` is one module with one key, in both compilers.** The reference special-cases it in
`wacCompile.ts` — `wantsCore` looks for an import whose prefix is `CORE.key`, parses `CORE.source`
under that key and adds it to the program map. wacc does the same with the key `" core"`, in
`emit.wac`'s `linkFiles` and `api.wac`'s `corePath()`. Everything else is the filesystem, reached by
path arithmetic in `compiler/wacResolve.ts` and `packages/wacc/src/files.wac`, with the *caller*
(`wacc.wac`'s `gather`) doing the reading.

So there is **no seam where a specifier becomes a source**. There is a special case for `core` and a
default of "open the file". D3 asks for `core` and `std` to be "reached through the same provider
interface as the filesystem and Git", and that interface does not exist to be reached through.

**Step 3's work is that interface, not moving five files.** `packages/std` is
`hash, map, option, result, vec` and moves whole; the part that does not move whole is
`core/option.wac` needing to be a *separately nameable module*, which one key cannot express. That
means a per-file key, per-file name mangling (`core$Read` is keyed on the single core today), and
both compilers' walkers calling the same thing.

**It is the same seam step 7 needs**, which is the argument for doing it once and properly.
`packages/wacpkg` already answers "which repository, which ref, which repository-relative path" for
a mapped specifier — `matchSpecifier`, `locate`, D9's confinement — and *nothing asks it*. A
provider interface with three implementations (embedded, filesystem, Git) is what connects the work
that is already done to the compiler that cannot yet use it.

### A collision step 4 introduces, worth knowing now

Today `import { Read } from core;` reaches the embedded module, and
`import { Read } from "core/read.wac";` is **a filesystem path** — it answers
`cannot read core/read.wac` in a directory with no `core/`. After D5 quotes every specifier, one
spelling has to mean one of the two.

D4 already decides it: `core`, `core/`, `std` and `std/` are reserved and cannot be remapped, so the
built-in wins and a project's own `core/` directory becomes unreachable by that name. Two
consequences to carry into step 4 rather than discover in it:

- **This repository now has a top-level `core/`** — step 2's source tree. It is benign, because the
  embedded copy is generated from exactly those files and a check keeps them in step, but the same
  spelling will name two things whose identity is a build step rather than a rule.
- The reserved names have to be reserved *by the resolver*, before the filesystem is consulted.
  Doing it after is the failure where a directory that happens to be called `core` shadows the
  built-ins in one project and not another.

### What `"core"` names once the tree has files, and the feature it does not need

D4 shows both spellings together:

```wac
import { Read } from "core";
import { Option } from "core/option.wac";
```

which only works if `"core"` is *something*. Three readings, and the choice decides whether step 3
depends on an unbuilt language feature:

- **A facade that re-exports.** `core`'s entry would say `export { Read } from "./read.wac";` —
  and wac has no re-export. That is `issues/lang/0073`, open and unclaimed since 2026-08-05. This
  reading makes step 3 wait on it.
- **The union of the tree.** `"core"` gives everything in it. No feature needed, and it costs: a
  program importing `Read` embeds `Vec`, `Map` and the hashing, in a built-in that is compiled into
  every binary.
- **A root module, with the collections as siblings** — `"core"` is the file at the root of the
  tree, `"core/option.wac"` is a file in it, and neither is reachable through the other. This is
  what D4's two lines actually show: `Option` is fetched by path *because* it is not in `"core"`.

**The third.** It needs nothing that does not exist, it keeps the built-in small for the program
that wants one type out of it, and it is what step 2 already built — `tools/genCore.ts` concatenates
the root files per compiler, and `read.wac` and `jsx.wac` are two files only so the wacc-only
omission has somewhere to live. Step 3 adds siblings beside them rather than changing what the root
is.

Worth writing down because the facade reading is the intuitive one, and taking it would have made
step 3 block on `issues/lang/0073` for no gain.

### `std`'s half of step 3 costs about 384 KB of seed, and that wants deciding first

`core` is done and cost what it was measured to cost. `std` — D4's capability half — is a different
size of thing, counted 2026-08-18 with `core` already moved:

| file | bytes | importers |
|---|---:|---:|
| `packages/platform/src/platform.wac` | 105,318 | **437** |
| `packages/platform/src/frame.wac` | 17,206 | 10 |
| `packages/platform/src/stream.wac` | 14,748 | 28 |

At the **2.8x** the collections measured, 137 KB of source is about **384 KB of seed** — a compiler
that is 847 KB today would be roughly **1.23 MB**, and the sweep is 437 files rather than 68.

Three things to weigh, and none of them is obvious:

- **The argument for embedding `core` does not transfer unchanged.** `core` is embedded because
  nominal types must be one thing everywhere and a funcref cannot adapt between two declarations of
  `Read` — plus the playground has no filesystem. The first half applies to `Core` and `Cli` exactly
  as it does to `Read`. The second half applies to any embedded tree. So the case is real; it is the
  *price* that is new, because `platform.wac` is twenty-seven times `option.wac`.
- **It is mostly one file.** 105 KB of the 137 KB, and 437 of the 475 import edges, are
  `platform.wac`. Whatever is decided can be decided about that file alone; `frame` and `stream` are
  38 importers between them and could stay packages without weakening anything D4 says.
- **2.8x is a measurement of one emitter choice, and `issues/lang/0162` names it.** A string
  literal is emitted as one `i32.const` per character — so text costs 2.6-2.8x its length in
  *code*, with no data segment anywhere. Through a data segment and `array.new_data` the same
  137 KB would be roughly 140 KB rather than 384 KB, and the objection below largely goes away.
  So this bullet is the load-bearing one rather than a hedge: **the 384 KB is not a fact about
  embedding, it is a fact about how literals are emitted**, and if that number is the reason not
  to move `platform.wac` then the thing to attack is the emitter.

Recommendation: **do not move `platform.wac` on the strength of D4 alone.** Reserve `std/` and the
specifier, move `frame` and `stream` if they are wanted, and treat the big file as its own decision
with the 384 KB in front of whoever takes it. Doubling the compiler is not a thing to discover after
the sweep.

### The move list, counted

`packages/std` is five files, and they are not equal work — importers, counted 2026-08-18:

| file | importers | note |
|---|---:|---|
| `result.wac` | 0 | imports `option.wac`, so it cannot move alone |
| `option.wac` | 2 | `json/src/value.wac`, `sh/src/exec.wac` |
| `map.wac` | 6 | |
| `hash.wac` | 9 | |
| `vec.wac` | 64 | the one that makes this a sweep |

So `option` + `result` are the pair to move first — eight files touched including the four
`packages/std/test/wac/*_test.wac` that name them, `compiler/wapyPrint.ts` and that package's `cov.ts`
— and they exercise the interesting case on the way: `result.wac` imports `./option.wac`, so a
sibling resolving a sibling inside the tree is proved by the first move rather than the last.

**One decision that move forces: where a built-in tree's tests live.** `option_test.wac` is under
`packages/std/test/wac/` and its subject would be `core/option.wac`. Either the tests move with the
source — `core/test/` — or a package keeps tests for code it no longer contains. The first is
tidier and makes `core/` a package like any other, which is what D3 says it becomes; the second
avoids inventing a test root inside a tree whose whole point is to be embedded. Not settled here,
because it is cheap to settle when somebody is holding the files.

### Ordering

The note's stated reason for 3 before 4 is that the migration is mechanical only once the trees are
real. That holds for `packages/std`'s 73 importers. It does not address that `core/option.wac` is
**unspellable** until 4 — unquoted `core/read.wac` is a parse error, and quoted means the
filesystem. So step 3 can make the trees real and multi-keyed while the only specifier that reaches
them is still the bare `core`; step 4 then adds the spelling. Worth stating in the plan, because
"make `core/option.wac` importable" reads like one step and is two.

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

**The walk exists four times, and three of them read files.** `harness/wacFiles.ts`, the
reference CLI's and `packages/wacc/example/wacc.wac` each queue a path, read it, ask for its
import specifiers and resolve them.

*(2026-08-18: three times now, two of them reading files. The reference CLI went, the `wac`
binary having replaced it. One fewer copy is one fewer place for a
manifest lookup to diverge, and does not change what this section argues — the copies that read
files still have to agree, and the count going down by attrition is not the same as consolidating
them.)* The fourth, `closureOf` in `packages/wacc/src/api.wac`, does
the same traversal over an already-supplied `paths`/`sources` pair and opens nothing — so it needs
to be *told* the root rather than to find it, and it is the one place that must not grow a
manifest lookup.

Today the three agree because the rule is two lines. A manifest lookup, a provider table and a
mapping table are not two lines, and three copies of *that* will diverge — the first symptom being
a program that compiles under `wac build` and not under the harness, or the reverse. Consolidating
is not part of D6 or D7, but it decides whether they cost one edit or three, and it should happen
before the mappings land rather than after.

## What `@/` actually costs, measured by trying it — 2026-08-17

`@/` was wired into `packages/wacc/example/wacc.wac`'s `gather` and then **reverted**, because the
attempt found the real cost and it is larger than the split described above.

The wiring itself is small and worked: `gather` finds the nearest `wac.json5` by walking up from
the importing file, resolves `@/src/lib.wac` against that root, and reads the file. It needs only
`packages/wacpkg/src/root.wac` — the manifest parser and its JSON dependency stay out of the
compiler's graph, because `@/` has to *find* a manifest and never to read one. The compiler grew
1.6 KB and remained a fixed point.

It fails one step later, with `an import of a file that was not supplied`, and the reason is the
thing to write down:

**Specifier resolution existed a third time, inside the linker — and there were seven in all.**
That copy is gone: `packages/wacc/src/path.wac` holds the rule, imports nothing, and both
`files.wac` and `emit.wac` use it (`issues/lang/0150`, where the two disagreed about
`./sub/../lib.wac` and a valid program read and then failed to link). Four remain —
`compiler/wacResolve.ts`, `harness/wacFiles.ts`, the reference CLI's and
`site/src/editor/file-store.ts`. *(2026-08-18: three, and the count in the measurement below with
it — the reference CLI was retired. The pairs it contributed are gone from
the total rather than newly disagreeing.)* `packages/wacc/test/corpus.ts` now
uses the harness's, which also fixed it: its own copy claimed in a comment to resolve "the way
the emitter's linker does" and did not — `from.slice(0, from.lastIndexOf("/"))` drops the last
*character* when there is no slash, and its `..` popped unconditionally.

**The measurement, both times:** over every real import specifier in the repository the copies
agree — 2915 pairs for the two wac ones, 2955 for the four TypeScript ones, zero disagreements
either time.

> **Asked a third time on 2026-08-19, and the answer had changed, because the set had.** Two of the
> four TypeScript copies were gone by then — the reference CLI's with the CLI, and
> `packages/wacc/test/corpus.ts`'s, which became the harness's — so the figures above and the
> "8 of 24, 9 of 16" below are about a population that no longer exists. Between the two that were
> left: **4232 of 4232 real specifiers agree, and 26 of 27 hand-written spellings.** The one
> disagreement was `..` climbing above an absolute root, where `compiler/wacResolve.ts` dropped the
> leading slash and returned a *relative* key — which a relative import can also produce, so two
> specifiers named one module. That is D8's failure at the smallest possible scale, and it
> compiled: an entry keyed `/home/wac/main.wac` importing four levels up was handed a file keyed
> `../lib.wac`. Fixed there rather than worked around, and with the answers then identical the
> harness's body became a call into the compiler's and `site/src/editor/file-store.ts`'s copy — the
> one this section counts and nothing ever called — was deleted.
>
> So the consolidation this section asks for is **done for the resolution rule**, and the count is
> two: one per language, which is the floor. What it does *not* cover is the part that has not been
> written — a manifest lookup and a provider table still have to land in both, and the argument
> below is about those. The useful thing the exercise proved is that the section was right for a
> reason it did not state: the copies did not agree, and no test noticed, for as long as nobody
> asked. Over hand-written edge cases, 8 of 24 and 9 of 16. One of those crosses the oracle relationship and is worth naming for whoever consolidates: for `/a/c.wac` importing `../../d.wac`, wacc answers `/../d.wac` and `compiler/wacResolve.ts` answers `d.wac`, because its `..` can pop the root marker. POSIX says `/..` is `/`, so the answer is arguably `/d.wac` and **both** are wrong — which makes it a decision rather than a fix, and an unreachable one until an absolute entry path climbs above its root. That is the shape of this whole
problem: they agree on everything anybody writes today, and the moment the rule grows a
manifest lookup they will not, and no existing test will notice. The original wording of this paragraph follows, because the shape it describes
is unchanged even though one copy is: Beyond
`packages/wacc/src/files.wac`'s `resolveFrom` and `compiler/wacResolve.ts`'s `importKey`, there is
`resolveImport(from, rel)` in `packages/wacc/src/emit.wac`, called from `linkFiles` — and that is
the copy that decides which supplied file an import edge points at. `gather` resolving `@/` gets
the file *read*; the linker then resolves the same specifier again, from a function that has no
project root and no way to be given one.

So step 5 is not "teach the walker about `@/`". It is:

- `linkFiles` and `resolveImport` take the importing file's project root, which means
- the `(paths, sources, entry)` shape that about ten exported functions in `packages/wacc/src/api.wac`
  share gains a parallel `roots`, which means
- `harness/wacFiles.ts`, the reference and every test that calls
  one of them passes it.

That is a cross-cutting change to the compiler's public API rather than a feature added at an edge,
and it lands in files somebody is actively porting. It is left here as a decision with its cost
attached rather than made: **the recommendation is to consolidate the three resolvers first**, on
the argument already in this note — three copies of a two-line rule agree, and three copies of a
rule with a manifest, a provider table and a mapping table in it will not.

A half-wired `@/` is worse than none, which is why the wiring was reverted rather than left behind
a flag: it reads as a broken import in a program that is correct.

## How `@/` gets its root, decided before writing it — 2026-08-19

**The recommendation above is discharged: the resolvers are consolidated.** `packages/wacc/src/path.wac`
has been the single wac-side rule since 2026-08-18, and as of 2026-08-19 `harness/wacFiles.ts` is a
call into `compiler/wacResolve.ts` and `site/src/editor/file-store.ts`'s copy is deleted. Two bodies
remain, one per language, which is the floor. Consolidating also found the last disagreement between
them rather than merely tidying — `..` above an absolute root, where the compiler's answer dropped
the leading slash and produced a relative key — so the exercise paid for itself before `@/` starts.

**The section above says `resolveFrom(fromPath, spec)` gains a third argument. It should, and the
sweep it implies should not happen.** `api.wac` has **22** exported entry points taking
`(string[] paths, string[] sources, string entry)`, and they are not evenly used: `emitFiles` alone
has 44 call sites, `blockedFiles` 25, `diagnoseGraph` 18 — well over a hundred in all, across
packages several agents are working in. Threading a fourth parameter through every one of them is a
change whose diff is almost entirely places where the answer is "no project, same as before", which
is one judgement stamped a hundred times.

So: **additive**. The internals learn a parallel `string[] roots`, the existing 22 keep their
signatures by passing an empty one, and new entry points carrying roots exist only for callers that
have a filesystem to find a manifest with — today `example/wacc.wac`'s `gather` and nothing else. A
call site moves when somebody has a reason to move it, rather than because a parameter list changed
under it.

The reference needs no such care: `wacCompile(files, entry, options)` already takes an options bag,
so `roots` is a field in it and no call site changes at all.

### Where the root has to reach, counted rather than guessed

Three places resolve a specifier inside wacc:

- `packages/wacc/example/wacc.wac`'s `gather` — the reader, and the only one with a filesystem, so
  it is where the upward search for `wac.json5` happens and where the roots are *computed*.
- `packages/wacc/src/api.wac`'s `closureOf` — the checker's per-file closure, which resolves each
  file's imports to decide what to check it against.
- `packages/wacc/src/emit.wac`'s `linkFiles`, through `resolveImport`. Seven functions call it, each
  an exported `…Linked` that an `api.wac` entry point calls, so the thread is
  entry point → `…Linked` → `linkFiles`.

That is the whole of it: three resolution points, seven internal call sites for the third. The
hundred-plus call sites are all *outside*, on the public entry points, and none of them has a root to
give — which is the argument for leaving their signatures alone.

`packages/wacpkg/src/root.wac` imports exactly one thing, `normalisePath`, so bringing it into the
compiler's graph costs nothing; the manifest *parser* stays out, as this note already says, because
`@/` finds a manifest and never reads one. wac allows circular imports, so an edge from the path
rules to the project rules is not a structural problem — but the tidier arrangement is for the `@/`
string arithmetic to live in `path.wac` with the rest of the path rules and for `root.wac` to take it
from there, keeping one definition and leaving `path.wac` a leaf.

### Roots are optional by construction, and that is D7 rather than a convenience

`wacCompile` is also called by the playground, with a synthetic file map and no filesystem at all, so
"there is no root for this file" has to be an ordinary state rather than an error in the caller. D7
already says what it means: *no manifest within that boundary is a compile error*. An absent root
makes `@/` a diagnostic, not a fallback to something relative — which is the one outcome that would
be silently wrong, because `resolveAt("@/src/a.wac", "")` would otherwise look like `src/a.wac`
relative to nothing.

### The alternative that was rejected, and why it is worth writing down

`gather` could resolve `@/` at read time and hand the compiler a source with the specifier already
rewritten. That needs no API change at all — no roots, no new entry points, nothing threaded — and it
is the first thing anybody will think of on reading the above.

It is wrong because **spans point into the text**. A rewritten specifier is a different length from
the one the author wrote, so every column on that line after it is off by the difference, and the
file the compiler reports about is not the file on disk. Import lines do carry diagnostics — a
specifier naming nothing is reported at the specifier — so this is the case that matters rather than
a corner. The compiler reading exactly what the author wrote is worth more than the API change costs.

### What is still missing on both sides

The pure half exists: `packages/wacpkg/src/root.wac` has `candidateRoots`, `resolveAt` and
`isProjectSpecifier`, with tests. What has no implementation on *either* side is the **search** —
walking up from the importing file to the nearest `wac.json5`, stopping at the provider boundary. The
reference needs one too, or a program that compiles under `wac build` will not compile under the
harness: the same "both compilers or neither" rule the `core` work ran into, and the reason this is
not a wacc-only change.

## The one to be careful with

**D8 is not a resolver nicety.** Nominal identity rides on it, and getting it wrong produces two
incompatible copies of one struct — a program that type-checks, runs, and fails at a seam whose error
message names the same type twice. It is the failure mode 0001 spent its longest paragraph on, and
the reason that paragraph is quoted above rather than summarised.

It deserves a differential rather than cases somebody thought to write: the same file reached by
`./foo.wac`, by `@/src/foo.wac`, by a whole-repository mapping and by a `subdir` mapping, asserted to
be one module — and two mappings at different commits asserted to be two.

*(2026-08-19: two of those four spellings exist now, and asking the question of them found that **the
paragraph above describes a failure neither compiler has**. With one file under two keys the
reference reads it twice and runs fine; wacc's checker stays clean and the *engine* rejects the
module, blaming the compiler. Not two incompatible copies in one program, but one compiler tolerating
what the other cannot load. `issues/lang/0163`. Nothing a user can write produces two keys today —
it took a perturbed resolver to make one — but D9-D11 are exactly what makes "the same file under two
names" expressible from a manifest, so this is due before the mappings rather than after.)*

## Acceptance

The upstream issue's checklist is the acceptance criteria and is not copied here, because a list in
two places is a list that drifts. What is copied is the decisions, because those are what the rest of
this repository has to agree with.
