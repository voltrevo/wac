# 0129 — every built executable carries a floor that has grown seven-fold

- **Status:** open
- **Claimed by:** (nobody — the arithmetic is done, the bundling question is open)
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
   **Done, 2026-08-11 — and it is the answer to the whole issue:**

   | executable | total | embedded wasm | the rest, which is JavaScript |
   |---|---:|---:|---:|
   | `platform/example/wc.wac` | 273,774 | 93,766 | **148,750** |
   | `box/src/bin/sh.wac` | 927,210 | 583,699 | **148,942** |

   The JS is **the same 149 KB** under a program that reads standard input and under one carrying 65
   applets and a shell. That is the floor, in one number, and it is the host bundle rather than
   anything the compiler emitted.
2. **Whether the 92 KiB wasm floor is the language runtime or the capability layer.** `deno task
   size` already measures layers for `packages/tor`; the same treatment for a program that uses one
   capability would say which.
3. **What `wasm-opt` would take off**, which is [0094](../closed/0094-nothing-has-ever-run-wasm-opt-over-what-we-ship.md).
   **Measured 2026-08-11**: −41% on this program's module (93,766 → 55,143), which takes the
   executable from 273,774 to **222,274** — and the optimised module runs, checked by patching it back
   into the executable and comparing output. So the cheapest lead is real and it is a third of the
   problem: 149 KB of JavaScript is left, untouched by any wasm tool.

   Which re-scopes this issue. The question is no longer "where does the floor come from" but **what
   does a program that never spawns, never draws and never opens a socket need from the host bundle**
   — `entry.ts`, `layout.ts`, `respond.ts`, `children.ts` and the rest go in whole, and a `wc` uses
   almost none of it. That is a bundling question, not a compiler one, and it is where the next 149 KB
   is.

## The audience question, settled

Some of this issue's weight came from `packages/platform` becoming its own repo, where a host bundle
is a shop window rather than an internal detail. That is
[closed](../closed/0092-the-capability-layer-should-be-its-own-repo.md) — one wac repo, decided
2026-08-11 — so the 149 KB is ours to look at when it is worth looking at, and nobody else's to
judge. It keeps the *for* below and loses the argument from somebody else's download.

## Why it matters, and why it might not

Against: nothing here is shipped over a network to a browser on a slow link, and 800 KiB on disk is
not a problem anybody has had. `box` starting in 15ms matters more and is fine.

For: the size table in `packages/box/README.md` exists because **small self-contained binaries were a
claim this project made about itself**, and `deno task size` and `packages/tor/size/` exist for the
same reason. A floor that grows unremarked turns those measurements into decoration — which is
exactly what happened here: three documents drifted by 3× to 7× and no test, and no reader, noticed
until a build was run beside them.

## 2026-08-12: the host bundle is a fixed table, not a function of what the program imports

The open question above was *"what does a program that never spawns, never draws and never opens a
socket need from the host bundle"*. Measured on a freshly built `packages/platform/example/wc.wac`
(276,202 bytes; 125,502 of embedded base64; **150,700 of JavaScript**), by looking for the names the
launcher wires:

    accept  arg  connect  env  exit  listen  mkdir  now  randomBytes
    readChunk  readDir  readFile  remove  rename  stat  write  writeFile

`Deno.listen`, `Deno.connect`, `Worker(` and `spawnSelf` are all in an executable whose whole job is
to read standard input and print three numbers. Two of those it could not reach if it tried: the
wasm module imports the handful of capabilities the *wac program* named, and nothing else can be
called from inside.

So the 149 KB is not a bundler failing to tree-shake. `host/provider.ts` registers every capability
in a fixed table by design — its own header says so, and the design is the reason a ticket can be
dropped without leaking — and `build.ts` selects the runtime by *target* (`entryBrowser`,
`entryNode`, `entry`) but never by *program*. A browser build correctly leaves out the Deno host;
nothing leaves out the sockets for a program that has no socket.

**The next step, and it is a measurement before it is a change.** The module's import list is
already in hand at build time — `wacBindgen(r.compiled)` generates the glue from it — so the
question "which providers does this program's wasm actually import" is answerable without new
machinery. Two numbers would settle whether this is worth doing:

1. bundle `host/entry.ts` with the spawn half (`children.ts`, `child.ts`, `childLife.ts` — 43 KB of
   source) removed, and diff the bundled bytes;
2. the same for the socket half, which is *not* a separate file — it is inside `deno.ts` and
   `provider.ts` — and is therefore the one that would need the code moved before it could be
   left out.

If (1) is a few kilobytes then the fixed table is not where the 149 KB lives and this issue needs a
different lead; if it is thirty, then a per-program provider table is worth the complexity it adds
to a build that is currently very easy to reason about. **Nobody has run either**, and the estimate
that would decide it is an hour of work rather than a guess.

Still not urgent, and the *for* above is unchanged: this matters because small self-contained
binaries are a claim this project makes about itself, not because 800 KiB on disk hurts anybody.
