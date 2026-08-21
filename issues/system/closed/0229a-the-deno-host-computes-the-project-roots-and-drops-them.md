# 0229a — the Deno host computes the project roots and drops them

- **Status:** closed
- **Closed by:** agent-a, 2026-08-21
- **Reported by:** agent-a, from GitHub issue 22 finding 4
- **Kind:** bug
- **Symptom:** the documented Deno path cannot compile any project using a `@/` import — two different messages, one cause

## Measured

A project on disk: `wac.json5`, `src/lib.wac`, and one entry importing `@/src/lib.wac`. The entry
written three times, at the project root, beside the file it imports, and two directories down. Every
one of them, through the command `docs/your-own-project.md` tells a reader to run:

    wacc (the default)   wacc cannot compile main.wac yet — an import of a file that was not supplied
    reference            `@/src/lib.wac` needs a project: no `wac.json5` above main.wac

Both compilers, in different words, from any depth. And through `tools/emitgen.ts`, which is the
author's own reproduction:

    src/rot13_test.wac: `@/src/rot13.wac` needs a project: no `wac.json5` above src/rot13_test.wac

## The cause, which is one layer above both compilers

`@/` is defined as the nearest `wac.json5` at or above the importing file — `design/lang/0009` D7 — so
it needs a filesystem search, and the compilers do no I/O. `harness/wacFiles.ts` does the search
(`projectRootOf`) because it is the thing already opening files, and it **has to**: a `@/` specifier
must be resolved to follow the import at all, or the graph is short a file.

Having found the roots, `wacFiles` returns the files and throws them away. `wacFilesWithRoots` returns
both. Counted over the repository: **2 of about 20 callers** used the second one — `referenceRun.ts`
and `referenceCheck.ts`. Everything else asked for the files alone, including both routes an outsider
is told to use.

GitHub issue 22 read the divergence as each tool growing its own loader with "subtle semantic
differences". There is one loader. What differed was which of its two entry points was called, and
nothing about the shorter name said it was lossy.

## And the option that was supposed to fix this already existed

`compileArtifacts` in `harness/waccBuild.ts` had taken a `roots` option since GitHub issue 21, with a
docstring naming the exact failure — *"an outsider compiling their own project got 'an import of a file
that was not supplied' where `wac build` compiled it"*. The word `roots` appeared **once in the file**,
in that type declaration. Every call in the body went to the root-less variant, and `waccArtifacts`,
its only caller, had no `roots` in its own options — so the option could not be passed even by a caller
who read the docstring and wanted to.

This is `issues/lang/0175a` one layer up and in another language: a parameter documented as the thing
that makes resolution work, never read. Two of these in one day, in two of the three places a `Res` has
to be threaded, suggests the shape rather than the site is the problem — a resolution context is
plumbing, every layer can compile without it, and nothing fails when a layer drops it. It goes quiet
instead.

## The fix

The whole `In` family and `Res` itself were **already exported by `api.wac` and already in the
generated glue** — `Res.$of(roots, mapFrom, mapSpec, mapTo, base)`, `diagnoseGraphIn`, `buildFilesIn`,
`emitFilesCoveredIn`, `covTableFilesIn`, `blockedFilesIn`, `bindTypesFilesIn`, `exportSigsFilesIn`. The
runtime surface was complete; nothing called it. So this is wiring, not new mechanism:

- `harness/waccBuild.ts` — `WaccApi` declares `Res` and the `In` entry points, so a host reading the
  type can see there is a choice; `waccRes` builds the `Res` from a roots map and a base;
  `compileArtifacts` calls the `In` variants; `waccArtifacts` accepts and forwards `roots` and `base`.
- `packages/platform/native.ts` and `packages/platform/build.ts` — `wacFilesWithRoots`, and both
  compiler routes get `{ roots, base }`. `nativeWire` too: it is where the manifest's struct and
  signature tables come from, so a type declared in a file reached only through `@/` would otherwise be
  missing from the boundary of a module that compiled.
- `harness/referenceCompile.ts` (new) — `compileEntry(entry, options)`, one function doing the walk and
  the compile together, because the alternative was the same four-line edit at seven call sites and
  that is how the omission spread. `tools/emitgen.ts`, `check.ts`, `validate.ts`, `coverage.ts` and
  `bindcheck.ts` call it and can no longer omit an argument they do not know exists.
- `packages/wacc/src/api.wac` — `describeFilesIn` and `diagnoseFilesIn`, the two members of the family
  that were missing, three lines each beside `buildFilesIn`.

**Two cache keys had to move**, and this is the part a reader should not skip. `wacc-artifacts` went to
`2` and `native-wire` to `3`: an entry written before the roots holds an artefact whose `@/` imports
resolved to nothing, and serving it against a key that now resolves them would answer a correct
question with the declined build. `filesParts` covers file *contents*, and a project's root is in none
of them. Both keys sort the roots map, because a `Map` iterates in insertion order and one project
walked from two entries would otherwise key differently and miss its own artefact.

## Tests

`packages/platform/test/project.test.ts`, driving `buildNative` — the thing the documentation names,
rather than the `In` entry points, which the compiler's own lanes already prove work and which cannot
say whether anything calls them.

- a project built from three entry depths, all of which failed before;
- the module *running*, `four()` answering 4, because a resolution bug that put the **wrong** file in
  the graph would also have built;
- and the same three entries spelled **relatively**, from inside the project, in a subprocess.

That third one was added after the first two passed, and it is the one worth keeping in mind: **an
absolute entry never exercises `base`.** The `@/` join is mapped back through it only when the importing
file's key is relative, so an absolutely-keyed fixture leaves that branch untaken — and it is the branch
that cost a cycle earlier the same day. It has to be a subprocess, because a relative entry is relative
to the working directory and `Deno.chdir` is process-wide.

Canaried twice, each against the arm it covers: restoring the root-less calls in `compileArtifacts`
fails the first two, and passing `""` as the base fails only the relative one and leaves the absolute
ones green.

## What this does not cover

- `appKeyParts` in `build.ts` does not include the roots. Two sibling projects with byte-identical
  sources, built with the same relative entry from different working directories, key the same — and
  produce identical bytes, since the sources and the manifest's `entry` string are identical. Named
  because it is a real gap in the key rather than a proof there is none.
- The other ~12 `wacFiles` callers are sweeps, size reports, benchmarks and stamp checks over *this*
  repository, which has no `@/` imports in the graphs they walk. They are not fixed and not broken.
- `harness/wacTestRun.ts` and `wacCoverage.ts` **were** done here, because `wac test` is one of the
  subcommands an outsider is told about and a test file imports through `@/` like any other file.
  `wacTestRun` needed a new `diagnoseFilesIn`: the only `In` variant that existed was the whole-graph
  `diagnoseGraphIn`, which is a *stricter* check than the entry-only walk that lane has always done, and
  swapping them while adding roots would have made every wac test file in the repository the subject of
  a second change nobody asked for.
- `harness/wacBind.ts` was not. It threads `files` through four internal functions and a cache key, and
  it binds this repository's own packages for Deno tests — no caller of it has a `@/` import today.
  `issues/system/0230a` carries it.
