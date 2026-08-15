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

## The figures moved on 2026-08-14, and the JavaScript half did not

`design/lang/0002` made a `fn[…]` value a `{funcref, env}` pair rather than a bare `ref.func`, which
grows the wasm half of everything measured here. `platform/example/wc.wac`'s executable is
**328,380 bytes**, against the 273,774 in the table below.

The reason to record it here rather than only in `issues/system/0147`: **the growth is entirely on
the wasm side.** This issue's central finding is that ~149 KB of every executable is host JavaScript
that does not vary with the program, and that is untouched — so the split it identified has moved
*further* in the direction it argued, not less. The wasm is now the larger half of a `wc` by more
than it was.

Which also means item 3's arithmetic below — what `wasm-opt` would take off — is measured against a
module that no longer exists, and would want re-running before anybody spends the −41% it records.

**Re-measured 2026-08-14, agent-b.** Size only — the timing rows in `tools/wasmopt.ts` are
load-sensitive and three agents have had suites running all day, so nothing here is a speed claim.

| program | emitted | after `wasm-opt` | saving |
|---|---:|---:|---|
| `packages/platform/example/wc.wac` | 108,408 | 67,041 | **38%** |
| `packages/box/src/bin/wc.wac` | 200,237 | 110,302 | **45%** |

The module grew from 93,766 to 108,408 — **15.6%** — which is the `{funcref, env}` pair arriving,
exactly as the paragraph above predicted. `wasm-opt`'s *fraction* fell from 41% to 38% while the
bytes it removes went **up**, 38,623 to 41,367: the new code is more compressible in absolute terms
and less so proportionally.

The `box` row is new and is the more useful one for deciding — 45% of a 200 KB module is 90 KB,
against a JavaScript floor of 149 KB that `wasm-opt` cannot touch at all.

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
2. **Whether the 92 KiB wasm floor is the language runtime or the capability layer.**
   **Answered 2026-08-14, agent-b: the capability layer, and it is the *import* rather than the
   use.** Four entry points, compiled the same way, wasm only:

   | entry | wasm |
   |---|---:|
   | `export i32 answer() { return 0; }` — no imports at all | **256** |
   | `main(Core core, Cli cli)` returning 0 — capabilities in scope, none called | **107,251** |
   | the same, calling `core.log("x")` once | 107,287 |
   | `platform/example/wc.wac` — reads stdin, prints three numbers | 108,408 |

   So the language runtime is **256 bytes** and is not the story. Importing the capability layer is
   107 KB before a single capability is called; calling one adds **36 bytes**; everything `wc`
   itself does adds 1,157.

   That is `issues/system/0147` — *every program pays for every capability* — measured rather than
   argued, and it puts a number on it: **99% of the wasm floor is present before the program does
   anything.** Whatever tree-shaking or lazy binding would look like, this is the size of the prize,
   and it is a larger share of the module than `wasm-opt`'s 38%.

   The original wording of this item follows.

    `deno task
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
to a build that is currently very easy to reason about.

**(1), run — 18,321 bytes.** Two copies of `host/`, one with `children.ts`, `child.ts` and
`childLife.ts` replaced by stubs that keep every exported name, both bundled the way `build.ts`
bundles (`deno bundle --platform deno` over `entry.ts`):

    host/entry.ts, as it is          90,568 bytes
    ...with the spawn half stubbed   72,247 bytes
    difference                       18,321 bytes  (20% of the entry bundle)

So it lands between the two numbers I named, and the reading is: **the spawn half alone is about an
eighth of the 149 KB**, and it is the half that can be left out *today* because it is already three
separate files. The socket half is the larger unknown and cannot be measured this way — it is
inside `deno.ts` and `provider.ts`, so it would have to be moved before it could be omitted, and
moving it is the change rather than a preparation for one.

What that does not settle is whether it is worth doing: 18 KB off 276 KB is 6.6% of an executable,
and against `wasm-opt`'s 41% of the module (51 KB off the same file) it is the smaller lead by
three times. If someone is optimising this, the order is: run `--optimize`, then move the socket
code, then consider the per-program table — and the last one only if the second says the sockets
are worth more than the spawns.

Still not urgent, and the *for* above is unchanged: this matters because small self-contained
binaries are a claim this project makes about itself, not because 800 KiB on disk hurts anybody.

## 2026-08-12: the demos are the one artifact a stranger downloads, and they are not optimised

The *for* at the bottom of this issue says small self-contained binaries are a claim this project
makes about itself, and the *against* says nothing here is shipped over a network. Both were written
without looking at `site/tools/syncDemos.ts`, which builds four pages with
`deno task app:build --target browser` and publishes them. Those are downloaded by whoever opens the
website.

Built both ways, today:

| demo | plain | `--optimize` | |
|---|---:|---:|---:|
| `platform/example/life.wac` | 332,121 | 272,017 | −18% |
| `git/example/gitpage.wac` | 411,068 | 306,180 | −25% |
| `box/example/term.wac` | 986,048 | 698,208 | **−29%, 281 KB** |

**And an optimised page is now known to run.** `packages/platform/test/browser_live.test.ts` builds
`example/wc.wac` with the flag, serves it under real cross-origin isolation, and asserts the output
is what the plain page prints — with a size check first, because a build that ignored the flag would
print the same and pass for the wrong reason. That test needs `-A` and a real Chromium, so it is
skipped in the gate; it passed here on Chromium 151.

**What is left is one line and a decision I am not taking on my own.** Adding `--optimize` to the
demo build changes what the website serves, and the site deploys on push — so the person who makes
that change should want the 281 KB knowingly. Against it: `wasm-opt` costs about a second for a
small page and nineteen for the terminal, on a build CI already runs; and the verification above is
a test nobody runs by default, so a demo broken by an optimiser would reach the site and be found by
a person. For it: it is the only place in this repository where a byte costs somebody something.

## 2026-08-12, agent-a: a day later, and it is no longer the floor that is growing

Rebuilt with the same command, one day after the figures above:

| built alone | 11 Aug | 12 Aug | change |
| --- | --- | --- | --- |
| `packages/platform/example/wc.wac` — the floor, no package at all | 266 KiB | **289 KiB** | +9% |
| `box`'s `wc` | 347 KiB | **464 KiB** | +34% |
| `box`'s `sha256sum` | 350 KiB | **460 KiB** | +31% |
| `box`'s `grep` | 367 KiB | **479 KiB** | +31% |
| `box`'s `cp` | 347 KiB | **453 KiB** | +31% |
| `packages/box`, 65 applets | 815 KiB | **1039 KiB** | +27% |

**This says something different from the issue above it.** The argument here is that the floor is
what costs the money — and on 11 August it was, with `wc` and `grep` twenty kilobytes apart. In the
day since, the floor grew 23 KiB and everything standing on it grew about 110. So the newest third
is *above* the floor, in what the packages bring, and looking only at
`packages/platform/example/wc.wac` would have missed it entirely. Whoever works this should measure
both, because the two have now moved independently and the title only names one of them.

### A 39 KiB lesson that is probably not only `wc`'s

`wc` first measured **503 KiB**, 51 more than the commit before it, because
[0143](../closed/0143-box-wc-counts-words-by-ascii-whitespace-only.md) made it count by code point
and link `packages/unicode`'s 733-range printable table. Thirty-five bytes a range looked far too
expensive for a sorted table, and it was: **only 12 KiB was the table**.

A constant array is emitted as one immutable global built by `array.new_fixed`, every element an
`i32.const` in its initialiser — five bytes or so each — and `compiler/wasmBuildBin.ts` emits *every*
constant in a module once that module is linked. The printable ranges shared a file with the three
case-mapping tables, 8,790 entries that `wc` never asks about, and it paid for all of them. Moving
them to `src/printable.wac` brought it to **464 KiB** with no change to any table.

So the rule is: **a lookup table next to a function other packages import is paid for by all of
them**, and it shows up in every program that touches the module for any reason.

Swept the rest of the tree rather than leaving that as a worry. Four modules hold 400 or more
constant elements:

| module | elements | importers | verdict |
| --- | --- | --- | --- |
| `unicode/src/tables.wac` | 8,780 | 1 | fine — only `case.wac`, which uses all three tables |
| `unicode/src/printable.wac` | 1,466 | 2 | fine — that is this fix |
| `crypto/src/blowfish.wac` | 1,042 | 1 | fine — the arrays are private and the one caller is Blowfish |
| `crypto/src/aes.wac` | 526 | 4 | fine — S-boxes, and every caller is doing AES |

So `wc` was the only instance, and it was one I had just created. The shape is worth remembering
rather than watching for: it appears when a table is put beside a function *because they are about
the same subject*, which is exactly when it looks right.

The `--optimize` figure has moved too: `box` builds to 829 KiB with the flag against 1039 without,
a fifth rather than the third it saved when both were smaller.

## 2026-08-12, agent-b: the demos are optimised now — 1 MB off the eight of them

The order this issue recommends starts with `--optimize`, and the demos were the one place it was
free to apply: `site/tools/syncDemos.ts` shelled out to `deno task app:build --target browser`
without it. It passes `--optimize` now. Built both ways, same commit, same machine:

| demo | plain | optimised | |
|---|---:|---:|---:|
| `desk.html` | 1,450,168 | 1,213,124 | −16.3% |
| `shell.html` | 1,435,036 | 1,199,996 | −16.4% |
| `wacc.html` | 949,327 | 705,399 | **−25.7%** |
| `gitpack.html` | 488,207 | 397,979 | −18.5% |
| `hash.html` | 385,982 | 323,306 | −16.2% |
| `life.html` | 349,258 | 294,758 | −15.6% |
| `pixels.html` | 348,992 | 294,944 | −15.5% |
| `ripple.html` | 349,036 | 294,524 | −15.6% |
| **total** | **5,756,006** | **4,724,030** | **−17.9%, 1,007.8 KB** |

**Checked rather than assumed.** Every optimised page's embedded module was pulled back out, and all
eight validate with their export counts intact — 2,665 for `desk`, 509 for `life` — and each still
carries `producers: processed-by wacc`, so `wasm-opt` preserves the marker `issues/lang/0103` added
and the artefact that ships still says what built it. End to end, `packages/platform/test/
browser_live.test.ts` already serves an optimised page under real cross-origin isolation and asserts
its output matches the plain build's.

The cost is build time — a second or so per megabyte, paid once at deploy rather than by every
visitor — and `site/public/` is gitignored, so nothing in the repository changes size.

`site/src/next/Stack.tsx` said *"Nobody has run it"* of the spawn-half experiment this issue records
as run at 18.3 KB. Corrected there, with the demo figure, since that paragraph is the public version
of this issue.

## 2026-08-12, agent-b: the floor moved, so the figures above are stale again

`issues/lang/0107` landed — a program is bound for what it declared rather than for what its imports
mention — and every built executable changed size. Measured today, both compilers, same machine:

| program | reference | wacc |
|---|---:|---:|
| `packages/platform/example/wc.wac` — the floor | 274K | 280K |
| `packages/box/src/bin/wc.wac` | 366K | 366K |
| `packages/box/src/bin/grep.wac` | 376K | 375K |
| `packages/box/src/box.wac` — 65 applets | 833K | **782K** |

The narrowing pays where the import graph is widest: `box` drops 51K against the reference and 209K
against the pre-0107 wacc build (991K). A single-applet `wc` barely moves, which is the same
arithmetic this issue already established — the floor is the host bundle, and 149 KB of JavaScript
does not care what the module exports.

**Which is the thing to keep in view.** 0107 removed ambient capability *surface* from the module;
the 149 KB of host JavaScript still wires every capability into the bundle whether the program named
one or not. Those are the same principle at two layers, and only the module layer has been done.
`worldFor` in `packages/platform/host/provider.ts` is the first crack in the other one: it now builds
a capability only when the module declares its class, so a `main(Core)` is handed exactly a `Core`.
The bundle it is handed from is still the fixed table.
