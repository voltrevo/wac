# 0291b — editing `std/` or `core/` does nothing until `gen:core` runs, and the diagnostic blames the import

- **Status:** closed
- **Reported by:** agent-b
- **Date:** 2026-08-30
- **Kind:** bug
- **Symptom:** wrong answer — a file that exports a name is said not to export it

## Reproduction

Add an export to `std/platform.wac` and call it, changing nothing else:

    $ printf '\nexport i32 staleProbeMarker() { return 4242; }\n' >> std/platform.wac
    $ grep -c staleProbeMarker std/platform.wac
    1

    $ cat probe.wac
    import { Core, Cli, staleProbeMarker } from "std/platform.wac";
    export i32 main(Core core, Cli cli) { return staleProbeMarker(); }

    $ wac build -o probe probe.wac
    error: that file does not export this name
      --> probe.wac:1:21
       |
     1 | import { Core, Cli, staleProbeMarker } from "std/platform.wac";
       |                     ^

The file exports it. The compiler is not reading the file.

## Why

`std/platform.wac` and `core/*.wac` are **carried inside the compiler**, as
`packages/wacc/src/coretext.wac`, and `isBuiltinSpec` there answers true for `"std/platform.wac"` —
so an import of that specifier is served the embedded text and never touches the disk. That is the
design (`design/lang/0009` D3/D4): a compiler in a wasm module has no filesystem, so it carries the
tree.

`wac task gen:core` regenerates the embedding from the source, and **`./bootstrap.sh` does not run
it** — the strings `gen:core` and `coretext` appear nowhere in that script. So editing a file in
`std/` or `core/` and rebuilding leaves the compiler carrying the previous version, indefinitely and
silently.

`wac task gen:core --check` does notice, immediately and correctly:

    1 generated file(s) do not match `core/`:
      packages/wacc/src/coretext.wac is out of step with core/

## Two things are wrong, and they are separable

**1. The diagnostic points at the wrong thing.** *"that file does not export this name"* is a
statement about `std/platform.wac`, and it is false — the reader will open the file, find the export,
and be stuck. Every other stale-artefact failure in this repository has been given a sentence that
names the artefact: `issues/system/0160` for the seed, `0208` for the wasmtime host. This one says
the opposite of what is true. It should say the embedding is out of step and name the command, and
the resolver knows enough to say it: the specifier is a built-in and the name is not in the embedded
text, which is exactly the condition.

**2. The check runs after the thing it would explain.** `tools/wac/gencore_test.wac` runs
`gen:core --check` and would catch this — in the *suite*, which `tools/push.sh` reaches after the
build. A stale embedding breaks the build, so the guard arrives after the damage. That is the same
shape as the seed-freshness argument in `issues/system/0289b`, where the fix was to run the check
where the failure happens rather than where the checks live.

The obvious move is `bootstrap.sh` running `gen:core --check` before it builds, and it has a
constraint that needs thinking about rather than a patch: a fresh clone has no `wac` binary to run a
task with, which is why `bootstrap.sh` is a shell script in the first place. So the check can only run
when a binary already exists — which is the case that matters, since a fresh clone cannot have edited
`std/` and rebuilt.

**Done, 2026-08-30.** `bootstrap.sh` asks the question immediately after it settles on a root and
before the ladder, using whichever of the two native binaries is already there and skipping when
neither is — the same "only when it exists" shape the wasmtime rebuild uses further down. It refuses
rather than regenerating, because regenerating writes a checked-in file and that is a commit somebody
should make on purpose. Both branches were run: a tree with one export added to `std/platform.wac`
exits 1 with the message before the ladder starts, and a clean tree bootstraps through to its fixed
point and exits 0.

**And the diagnostic, 2026-08-30.** A built-in gets its own code now — `errStaleBuiltinEmbedding`,
210 — raised where `api.wac` checks a graph's imports against what each file exports, chosen by
`isBuiltinSpec(paths[i])`:

    error: the compiler's copy of that built-in does not export this name
      = help: `core/` and `std/` are carried inside the compiler — run `wac task gen:core` if you have edited one

Its own code rather than reworded 56, because the two are different facts: 56 is about a file, and
this is about a build step that has not been run. An ordinary file that genuinely does not export a
name still gets 56 and its own help, unchanged — both branches were run side by side.

One change covers both entry points: `wac check` on a single file builds a graph too, so a bare
`import { notThere } from "core";` reports it as well.

`packages/wacc/test/wac/builtinspec_test.wac` pins it, through the command rather than through
`diagnoseFiles` — a caller of that can supply any text it likes for `std/platform.wac`, and what is
being checked is that the *embedded* copy is what answers.

**So both faults are closed.** Left open only as the record of what the shape was, and because
`codes_test.wac` cannot pin 210: its rows are single sources through `dumpErrors`, and this code needs
a graph with a built-in in it.

## What it is not

Not `issues/lang/0291c`. That is a capability with a seventh parameter dropping the module's entry
point, and its reproduction edits `std/platform.wac` — so this is worth ruling out there first, and
the note on that issue says how. But this reproduces on its own, with one added export and no
capability involved.

## Scope

Everything `gen:core` generates: `core/read.wac`, `core/jsx.wac`, the five `core/` siblings, and
`std/platform.wac`. Nine files. Anyone editing one of them and rebuilding meets this.

Both `std/README.md` and `core/README.md` said only "do not edit the *embedding* by hand" — the
opposite hazard, and it reads as though editing the source is the safe thing to do. They say this as
well now, and so does `CLAUDE.md` beside its "rebuild after touching `packages/wacc/`" line, which is
where somebody would look for it.
