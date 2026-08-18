# 0155 — a build that emitted no code reports success

- **Status:** open
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

```
$ wac .cache/agg.wasm test_zz_trivial__f0
wac: test_zz_trivial__f0 is not callable
$ echo $?
0
```

Expected: a build that could not emit says so and exits non-zero; a program that could not be run does the
same.

Actual: both report success, and the artefact left behind looks like a module — it has the magic number,
the version, and a manifest a reader will believe.

## Why this one first

It is the reason 0154 went unnoticed for however long it has been there, and it will hide the next one too.
A module with no code is not a thing a compiler should be able to write: the emit either produced functions
or it failed, and there is no third answer worth putting on disk.

The size line makes it worse rather than better. `73846 bytes from 72 file(s)` is exactly what a successful
build of a large graph looks like, so the one number a person checks agrees with the failure.

## Where to look

`wac build`'s path writes the module after `withManifestSection` wraps it. Whatever bails before that —
`emitLinked` answering an empty or header-only module — is not checked for having produced anything. The
same question applies to `wac <module.wasm> <fn>`: `is not callable` is a diagnosis, and exit 0 says the run
was fine.
