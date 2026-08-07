# 0076 — a wider import graph makes two identical struct types different in the wasm

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-07
- **Kind:** bug
- **Symptom:** invalid wasm

## What

Adding an import to a large program made a *different* function fail to compile, with a type mismatch
between a local and the call that fills it:

```
CompileError: WebAssembly.instantiate(): Compiling function #221:"kexinit$encode" failed:
  local.set[0] expected type (ref 51), found call of type (ref 268) @+90689
```

`kexinit$encode` is in `wac-mono`'s `packages/ssh` and was not touched. The build succeeds — 880 KiB of
wasm — and the module is rejected when it is instantiated, which is the worst place for this to appear:
`deno task test` reports it as a *server that exited before accepting anything*.

## Reproduction

In `wac-mono`, add one import and one line to `packages/ssh/src/sshd.wac`:

```wac
import { boxNames, boxRun } from "../../box/src/shrun.wac";
// …in sessionShell:
sh.external = boxRun;
sh.externalNames = boxNames;
```

then

```
deno run -A packages/platform/build.ts packages/ssh/src/sshd.wac -o /tmp/sshd \
  --allow-read --allow-write --allow-net --allow-env
/tmp/sshd --help
```

Expected: the same usage line it prints today.
Actual: the `CompileError` above, from `WebAssembly.instantiate`.

Without those three lines the same file builds and runs. `packages/box` does not import `packages/ssh`,
so this is a new edge rather than a cycle, and it roughly doubles the number of types in the module.

## Notes

`(ref 51)` and `(ref 268)` are two entries in the wasm type section, and the function returning `268` is
being assigned to a local declared `51`. Two structurally identical struct types given two indices, with
one of them treated as canonical, is the shape that produces exactly this — and a wider import graph is
what makes two copies of a type reachable in the first place.

Worth checking first: whether the compiler de-duplicates the type section by structure, and whether a
struct declared in one package and reached through two different import paths gets one index or two.

This blocks the `ssh` → `box` edge in wac-mono 0103 — `sshd` serving its sessions from `packages/box`'s
applets rather than from the eleven programs being deleted from `packages/sh`. The workaround for now is
that `sshd` keeps whatever `packages/sh` still carries.
