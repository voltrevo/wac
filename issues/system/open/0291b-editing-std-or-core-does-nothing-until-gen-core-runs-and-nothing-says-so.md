# 0291b — editing `std/` or `core/` does nothing until `gen:core` runs, and the diagnostic blames the import

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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

## What it is not

Not `issues/lang/0291c`. That is a capability with a seventh parameter dropping the module's entry
point, and its reproduction edits `std/platform.wac` — so this is worth ruling out there first, and
the note on that issue says how. But this reproduces on its own, with one added export and no
capability involved.

## Scope

Everything `gen:core` generates: `core/read.wac`, `core/jsx.wac`, the five `core/` siblings, and
`std/platform.wac`. Nine files. Anyone editing one of them and rebuilding meets this, and
`std/README.md` and `core/README.md` currently say only "do not edit the *embedding* by hand" —
which is the opposite hazard, and reads as though editing the source is the safe thing to do.
