# 0155 — a build that emitted no code reports success

- **Status:** closed — 2026-08-25
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** diagnostic
- **Symptom:** no error

## Reproduction

Any input that defeats the emitter will do; the one to hand is `issues/lang/0154`'s. With that trigger in
place:

```
$ WAC_KEEP_AGGREGATE=1 wac test packages/wacc/test/wac/zzprobe_test.wac <22 others>
$ wac build .cache/wac-aggregate-<pid>-0.kept.wac -o .cache/agg
.cache/agg.wasm: 73846 bytes from 72 file(s)
$ echo $?
0
```

`.cache/agg.wasm` has **one section**: `wac.manifest`, 73,821 bytes of valid JSON listing 50 exports. There
is no type section, no function section, no code section and no export section. Every byte of the file is
the manifest and the eight-byte header.

Expected: a build that could not emit says so and exits non-zero.

Actual: it reports success, and the artefact left behind looks like a module — it has the magic number, the
version, and a manifest a reader will believe.

**A correction, because this issue first said two things and only one was true.** Running an export the
manifest lists answers `wac: test_zz_trivial__f0 is not callable` — and `native/v8/src/main.rs` returns **1**
for that, correctly. The first version of this issue claimed exit 0 there as well; that reading came from
`… | tail -2`, so what was reported was the pipe's status and not the program's. Only the build half is a
defect.

## Why this one first

It is the reason 0154 went unnoticed for however long it has been there, and it will hide the next one too.
A module with no code is not a thing a compiler should be able to write: the emit either produced functions
or it failed, and there is no third answer worth putting on disk.

The size line makes it worse rather than better. `73846 bytes from 72 file(s)` is exactly what a successful
build of a large graph looks like, so the one number a person checks agrees with the failure.

## Fixed in the CLI, 2026-08-18

`packages/wac/src/wac.wac` refuses to write a module of eight bytes or fewer and returns 1, with a
message that says the emitter produced no code and that nothing was declined — the distinction between this
and the `blocked` path above it, which is the emitter declining *with a reason*. Verified against the
trigger: exit 1, no file written. A source with no functions at all still builds (2,117 bytes), so the
threshold does not catch anything legitimate.

That is the reporting half. The emit itself is still `issues/lang/0154`.

## Where to look

`wac build`'s path writes the module after `withManifestSection` wraps it. Whatever bails before that —
`emitLinked` answering an empty or header-only module — is not checked for having produced anything. The
same question applies to `wac <module.wasm> <fn>`: `is not callable` is a diagnosis, and exit 0 says the run
was fine.

## 2026-08-20: the guard this asks for exists; the trigger no longer reaches it

`wacc.wac` has it, with a comment citing this issue — a module of `wasm.len() <= 8` is named and the
build exits 1. Two stronger nets now sit beside it, both from `issues/lang/0170a`: an export the
source declared and the module lacks fails the build, and `wac build` validates what it wrote.

**Not closed, because the reproduction cannot be re-run.** It needed the `0154` trigger, and that no
longer produces a bare module: the `Case` collisions in `packages/wacc/test/wac` were renamed, so the
aggregate builds, and the collision that remains produces a 4.5 KB *invalid* module which the new
validator catches rather than an eight-byte one. So the guard is in place and unreachable by the only
route anybody has recorded — which is a good state and not a demonstrated one.

To close this properly somebody needs an input that still makes the emitter produce nothing at all.
If no such input exists, the honest close is "the guard is here, and nothing can reach it" — but that
is a claim about every input, and this issue exists because a claim like that was wrong once.

## 2026-08-21: the claim is about return sites, not inputs — agent-a

This issue hesitates to close because *"the guard is here, and nothing can reach it"* is a claim about
every input, and it exists because such a claim was wrong once. That is the right instinct and the wrong
quantifier: the guard fires on an **eight-byte module**, and a module is eight bytes only if the emitter
returned `bareModule()`. There are seven such returns and they can be read.

| site | when | does it say why? |
| --- | --- | --- |
| `emitModuleOfFront`, `env.ambiguous \|\| env.full` | a guessed name, or a decline | yes — `buildLinked` reads both and reports, since `issues/lang/0154` |
| `emitModuleOf…`, `env.full` | a decline | yes — same reader |
| the type-section-grew guard | a type registered mid-body | yes — `declineFor` with the counts and the names |
| four `Built(bareModule(), …)` returns | link failure, ambiguity, missing import | yes — the reason is the second half of the `Built` |
| `emitLinkedTracedSlots`, `blob == ""` | the link failed | **no**, and see below |
| `emitLinkedWith2`, `blob == ""` | the link failed | **no**, and see below |

So for `wac build` every route is covered, and the two that are not are the *in-process* `emitFiles`
family: they answer `u8[]` and have nowhere to put a reason, so a caller whose link fails gets eight
bytes and no explanation. That is `issues/lang/0170a`'s known gap — *"the export-parity net covers `wac
build` and not the in-process API"* — with three options already written up there, and it is the same
two functions.

### The eight-byte module still exists, in-process, and it is measured

`waccApi()` driven directly, on a program whose import names a file nobody supplied:

    missing import: emitFiles -> 8 bytes,    blockedFiles -> "an import of a file that was not
                                             supplied: /gone.wac (/m.wac imports it as "./gone.wac")"
    fine:           emitFiles -> 1065 bytes, blockedFiles -> ""

So the input this issue asks for does exist — it is just not reachable through `wac build`, because the
CLI's `gather` reads from disk and a missing file fails there first. And the reason is one call away and
a good one: `blockedFiles` names the key, the importing file *and* the specifier as written.

**Which makes this issue's close a smaller question than it looks.** Not "does an input exist" but
"should the `emitFiles` family be able to say why it produced nothing". The build path answers; the
library path does not, and its callers are code that is itself under test. `blockedFiles` and
`missingImportFiles` are the seams a caller can already ask, so nothing is unable to find out — the
family just does not volunteer it.

The enumeration is worth more than the reproduction hunt: an input demonstrates one route, and the
return sites are all of them. If a later change adds an eighth, this table is what makes it visible.

### What a close would need

Not an input any more — there is one above. What is missing is the thing the tracker asks for: a
reproduction that *behaves*, canaried by reverting the fix. The CLI guard cannot be demonstrated
because every route to it now reports something better first, and that is exactly the state this issue
distrusts. So the honest options are:

- **close it on the enumeration** — seven return sites, six covered, and the seventh is a library
  function with nowhere to put a reason — accepting that the guard itself is untested;
- **make the `emitFiles` family able to say why** (`issues/lang/0170a`'s three options), which turns
  the seventh site into a covered one and leaves the guard as dead code to delete;
- **leave it open** as the standing reminder that an eight-byte module is possible.

Recommended: the second, and **keep the guard**. Deleting it once the family reports would be the usual
move here — a belt beside a fixed brace — but this belt is the only thing that catches an *eighth*
return site, and the enumeration above is a claim about today's code rather than a property of it. A
guard that costs one line and fires on a byte count is cheaper than the sweep that would otherwise be
needed after every change to the emitter's early exits.

## Fixed: the build asks about the artefact, not about the engine's opinion of it — 2026-08-25

`hollowWhy` in `packages/wacc/src/manifest.wac` walks the sections of the module about to be written
and answers why it is hollow, or `""`:

    no code section        nothing was emitted
    empty export section   and the manifest promises exports
    a section past the end the bytes are not a module

`wac build` asks **before it writes**, so there is no artefact left to believe, and it says the fault is
the compiler's rather than the program's — because it is.

**Why nothing caught this for a week is the part worth keeping.** That file *validates*: a module
consisting of one custom section is legal wasm, so the engine check `wac build` runs after a build —
`issues/lang/0170a`'s rule that a module the engine refuses must fail the build — had no complaint to
make. Two guards can both be working and leave this gap between them, because one asks the engine and
the other asks nobody. `hollowWhy` asks the artefact.

Checked in the program rather than in a host, so all three refuse it.

## The test does not reproduce the emitter bug, on purpose

The reported reproduction needs `issues/lang/0154`'s collision in place — a second open bug, and a
moving target. The *shape* of the artefact is not: `withManifestSection` on an eight-byte module is
exactly it, with a real manifest so that the only thing wrong is the absence of the module.
`test/wac/manifestsection_test.wac` pins that, and pins the other direction too — a real artefact is
not called hollow, and a module that does export something does not trip the export arm. A guard that
refused everything would pass the first assertion and break every build.

Verified: the seed is a fixed point built through the guarded path (a 220-file program plus two
payloads), and `app_test`, `buildcache_test`, `declined_test` and the 42-row `commandparity_test` are
green.
