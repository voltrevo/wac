# 0129 — every built executable carries a floor that has grown seven-fold

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-11
- **Kind:** performance
- **Symptom:** no error

Three READMEs stated the size of a built program and all three were wrong the same way, by roughly
the same factor. Rebuilt on 2026-08-11:

| what | the README said | measured |
| --- | --- | --- |
| `packages/box` — 65 applets | 111K | **815 KiB** |
| `box`'s `wc`, built alone | 47K | **347 KiB** |
| `box`'s `sha256sum`, alone | 51K | **350 KiB** |
| `box`'s `grep`, alone | 59K | **367 KiB** |
| `packages/ssh`'s `ssh` | 151K | **352 KiB** |
| `packages/tor`'s client | 386.7 KiB | **490.1 KiB** |

The numbers are corrected in place with the date and the command that produced them. This issue is
about the pattern rather than the prose.

## It is not the programs

`wc` counts standard input. Built alone it is 347 KiB, and `grep` — regular expressions, a file
walk, options — is 367 KiB. Twenty kilobytes between them. The thing they have in common is what
costs the money.

The floor, measured the same way:

```
packages/platform/example/wc.wac       266.1 KiB executable,  91.6 KiB wasm
packages/box/src/bin/wc.wac            347.1 KiB executable, 152.4 KiB wasm
```

`platform/example/wc.wac` imports the capability layer and nothing else. So **a program that does
nothing but read standard input and print three numbers is 266 KiB**, of which about 92 KiB is wasm
and the rest is the host: the bridge, the worker plumbing, the capability closures and the base64 of
the module itself.

## What would settle it

Not stated as a diagnosis, because I have not made one — this was found by re-measuring prose, and
what it establishes is the *size*, not the cause. Three things worth separating before anyone
optimises:

1. **How much of the 266 KiB is the embedded wasm** (base64 is 4/3 of 91.6 KiB ≈ 122 KiB) and how
   much is host JavaScript. That is arithmetic on one file and nobody has done it.
2. **Whether the 92 KiB wasm floor is the language runtime or the capability layer.** `deno task
   size` already measures layers for `packages/tor`; the same treatment for a program that uses one
   capability would say which.
3. **What `wasm-opt` would take off**, which is [0094](0094-nothing-has-ever-run-wasm-opt-over-what-we-ship.md)
   — open since 2026-08-06 and never run over anything. It is the cheapest of the three to answer and
   the only one that needs a tool this container does not have.

## Why it matters, and why it might not

Against: nothing here is shipped over a network to a browser on a slow link, and 800 KiB on disk is
not a problem anybody has had. `box` starting in 15ms matters more and is fine.

For: the size table in `packages/box/README.md` exists because **small self-contained binaries were a
claim this project made about itself**, and `deno task size` and `packages/tor/size/` exist for the
same reason. A floor that grows unremarked turns those measurements into decoration — which is
exactly what happened here: three documents drifted by 3× to 7× and no test, and no reader, noticed
until a build was run beside them.
