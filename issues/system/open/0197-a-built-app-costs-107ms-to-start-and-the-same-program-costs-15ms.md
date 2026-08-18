# 0197 — a built app costs 107 ms to start; the same program through the `wac` binary costs 15 ms

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** performance
- **Symptom:** no error — the test suite spends most of its time starting processes

## The measurement

`packages/box`, file by file, is 184 s. **1 701 of those seconds' worth of work is process starts**: the
package spawns 1 701 built programs, and each costs about **107 ms**.

    20 spawns of a built app (box's sh, 1.27 MB)       107.3 ms each
    20 spawns of a built app with the cache flags off   90.1 ms each
    20 spawns of a built hello-world app (412 KB)       69.5 ms each
    20 × `wac sh -c 'seq 1 3 | tr 1-9 a-i'`             15   ms each   ← the same shell, same applets
    20 × `deno run` of `console.log("")`                14   ms each
    20 × `bash -c ':'`                                   1   ms each

So it is **not** Deno starting — that is 14 ms — and **not** the program, because the identical shell runs
a pipeline through the applets in 15 ms when the native binary hosts it.

## What a built app is

`packages/platform/build.ts` writes a **1.27 MB JavaScript file** with this shebang:

```
#!/usr/bin/env -S DENO_EMIT_CACHE_MODE=disable deno run --no-code-cache --allow-read --allow-write --allow-env
```

Every spawn re-parses 1.27 MB of generated JavaScript with code caching switched off in two ways, then
instantiates the wasm embedded in it. Removing both flags takes 107 ms to 90 ms — 16%, and worth knowing,
but it is not where the money is: the cost scales with the artefact, 69.5 ms for 412 KB and 107 ms for
1.27 MB, so roughly **50 ms fixed and 43 ms a megabyte**.

The native binary pays neither. Its wasm is `include_bytes!`'d and V8 boots from a snapshot, which is why
the same program is seven times cheaper to start there.

## Why this is the suite's biggest number

`issues/system/0193` cut `packages/box` from 351 s to 184 s by moving two differentials in process, and
then stopped: what remains is either about processes on purpose or already at the floor. This is the
floor. **1 701 spawns × 92 ms of avoidable cost is about 156 s** — more than the whole package now takes,
and it is one change rather than sixty.

It is not box's alone. Every `*.test.ts` in this repository that builds a program and runs it pays this.

## Shapes worth measuring

* **Let a test spawn through the native binary.** `wac sh` already proves the cost is not intrinsic; what
  is missing is a way to run a *built* module — `wac exec prog.wasm [args…]` — so `buildApp` could write a
  `.wasm` and the harness spawn the binary on it. That is 15 ms plus the module's compile.
* **Make the built app's JavaScript cacheable.** The flags are there for a reason and the reason should be
  written down before they move; 16% says this is the smaller half either way.
* **Ask why the JS is 1.27 MB** for a program whose wasm is a fraction of that.

## Notes

Found while measuring what was left of `issues/system/0193` after the conversions. The numbers above were
taken back to back on one machine with the box otherwise quiet; `deno task test` was not running.
