# 0167a — a project can map `std/` and `core/`, which D4 reserves, and the mapping is used

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-19
- **Kind:** bug
- **Symptom:** wrong answer — a reserved namespace resolves to somebody's repository

## Reproduction

A project, outside this repository, with a manifest that maps the reserved prefix:

```json5
// wac.json5
{ imports: { 'std/': { git: 'https://example.invalid/std', ref: 'main' } } }
```

```wac
// src/n.wac
import { thing } from "std/nope.wac";
export i32 main() { return thing(); }
```

    $ wac run src/n.wac
    wacc: std/nope.wac needs a locked commit for `std/` — run `wac update`

The manifest is accepted and **the mapping is consulted**. `wac update` would resolve the ref and
fetch, and `std/nope.wac` would then be that repository's file. The same holds for `core/`.

## What the design says

`design/lang/0009` D4, in the sentence that follows the split:

> `core`, `core/`, `std` and `std/` are reserved, cannot be remapped, and never appear in `wac.lock`.

`spec/spec/imports.md` states it as `§wac-std-reserved-5kt8nqw`. Both say the *prefix*.

## Why it happens

The reservation is implemented per built-in **file**, not per namespace. `isMappingCandidate` in
`packages/wacc/example/wacc.wac` is `return !isBuiltinSpec(spec);`, and `isBuiltinSpec` asks whether
the tree holds a file of exactly that name — `coreFile(spec) != "" || stdFile(spec) != ""`. So
`std/platform.wac` is protected because it exists, and `std/nope.wac` is a mapping candidate because
it does not.

The test that should have caught it asks the reservation question of `std/platform.wac`, which is the
one name the file-level check already answers correctly.

## Why it matters

**A name that is reserved only where it is already taken is not reserved.** Two consequences, and the
second is the one that will actually bite:

- A project can point `std/` at a repository today and have it work for every name the compiler does
  not carry.
- If wac later adds a file to `std/` — `std/net.wac`, say — every project that had mapped `std/`
  silently stops using its fetched copy for that one name and starts using the built-in. Nothing
  reports it. That is a change of code under a program that did not change, decided by which version
  of the toolchain is installed.

`wac.lock` is also supposed never to hold one of these, and nothing stops it: the lock is written from
the mapping table.

## What a fix probably is

Refuse the manifest. `packages/wacpkg` reads and checks it — `readManifest` already has a `code`/
`detail` pair for a bad mapping — and a reserved name is a manifest error rather than a resolution
error, so it can be reported once, at the point the person wrote it, instead of at each import.

Checking the *prefix* is what the rule says: `core`, `core/`, `std`, `std/`, and anything beginning
with `core/` or `std/`.

## Incidental, found alongside

`packages/wacpkg/README.md`'s worked example uses `'std/'` as its illustration of a prefix mapping:

```json5
'std/':  { git: 'https://example.invalid/std', ref: 'main' },
```

That was written before D4 reserved the name. It should be some other prefix, or the example teaches
the thing this issue is about.
