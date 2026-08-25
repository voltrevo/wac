# 0257c — `wacc` the compiler has become `wac` the command

- **Status:** open
- **Reported by:** the operator, 2026-08-25 — recorded by agent-c
- **Kind:** decision, already ruled
- **Symptom:** the compiler package owns the shell-less command surface, and the hosted build "cannot"
  do things it should

## The ruling

Two sentences from the operator, and the second sharpens the first:

> the Deno/Node version of wac can't do things except run wacc. this is wrong. `wac` *contains* the
> compiler, plus more stuff. each version of the wac unified binary should do all the stuff.

> this also gives me a related concern that wacc has grown to include things that it shouldn't.

**Both are about one structural mistake.** There is no `wac` entry in this repository. The seed, the
native binary and every hosted build are made from packages/wacc/example/wacc.wac — the *compiler's*
example — so the compiler's CLI is the unified command, and the seed artefact is even called
`wacc.wasm`. `tools/seedFresh.test.ts` says it in passing: "the seed is built from
packages/wacc/example/wacc.wac — whose closure is `src/`, yes, but also the example itself".

That produced the wrong answer I gave twice, in `docs/your-own-project.md` and in `issues/system/0230a`:
that `sh` and `update` are the native binary's alone "because a hosted `wac` is built from `wacc.wac`
alone, so there is nothing for `wac sh` to start". That is backwards. It is not a fact about hosts, it
is a consequence of building the command out of the compiler. **Both of those sentences are wrong and
need correcting wherever they were written.**

## What is in there that is not the compiler

packages/wacc/example/wacc.wac is 2,460 lines and 65 top-level functions. The compiler's own
commands are `check`, `compile`, `build` and `bindgen`. Everything below is the *command*:

- `run` — build to a temporary file, start it, relay its streams and status.
- `wac <prog.wasm>` — run a built artefact under the grants its manifest declares.
- `test` — the whole runner: `testFilesIn`/`walkTests`/`sortedNames` (discovery), `testsInSource` and
  `aggregateSource` (one module per directory), `runNamed`/`Tally`/`sayTally` (calling and counting),
  `--filter`, `--ignore`, `--verbose`, and `sigsWithCounters`.
- The coverage report — `sayCoverage`, `countersOf`.
- Dispatch and the usage text for all of it.

Most of that arrived during `issues/system/0230a` steps 4 and 5, this month, by me. The issue asked
for the subcommands to live in "the wac program"; I put them in the compiler because the compiler's
example was the only program there was, and did not stop to ask whether that was what "the wac
program" meant.

## What it should be

    packages/wacc/     the compiler. `src/` is its API; its example is a compiler CLI --
                       check, compile, build, bindgen -- and nothing else.
    packages/wac/      the unified command. Imports wacc's API, `packages/sh`, `packages/wacpkg`,
                       and owns run, test, sh, update, artefact execution, dispatch and usage.

Then "each version of the wac unified binary does all the stuff" is true by construction rather than
by a payload arrangement, and `sh` and `update` stop being native-only: both are already ordinary wac
programs with thin `main`s — `packages/sh/src/sh.wac` calls `shellMain(core, cli, sh, 0)` where the
last argument is *where in argv to start*, which is exactly what in-process dispatch needs, and
`packages/wacpkg/src/fetch.wac` needs its `main` body lifted into a function taking a directory
and a `$WAC_HOME`.

## Where the line goes, and `run` is already on the right side of it

The operator, refining the above: *"intercepting makes sense for efficiently running programs, then
everything else should go through a regular wac program rather than being implemented on the host."*

So a host may implement **running a module** — that is the engine doing engine work — and must not
implement the **command surface**. That is a sharper rule than "one dispatch path everywhere", and it
puts `run` on the *right* side, which I had wrong: `build_module` in `native/v8/src/main.rs` calls
`run_seed(&build)`, so the native compiles **through the wac program** already and only instantiates
in Rust. The interception is "run this module in this process, with the real streams", and the
in-process part is exactly what a spawn-and-relay cannot give a program that wants a terminal.

Under that rule:

| | |
|---|---|
| `wac prog.wasm`, the instantiate half of `run` | **stays** a host's — running a module is its job |
| `validate` | **stays** — it answers whether *this engine* accepts a module, so three answers is it working |
| `test` | **moves.** A whole second implementation in Rust: the walk, the per-directory aggregate, the runner, the coverage table. The wac program has all of it. This is most of what the differential exists to police |
| `covdump`, `tracestat`, `ctcompare` | **move.** They only read counters, which `issues/system/0243c` made reachable. What still blocks them is that they are handed modules carrying no manifest and `Cli.load` refuses those |
| `sh`, `update` | **move**, and they are not host implementations at all — just separate payloads. In the one program, every host has them |

## What it touches, which is why this is written down before it is done

`tools/seed.sh` (`ENTRY=`), `tools/push.sh`, `tools/seedFresh.test.ts`, `packages/platform/build.ts`,
`native/v8/build.rs` (the three embedded payloads and the `wacc.wasm` name),
`packages/wacc/test/wac/commandparity_test.wac` (`ENTRY`), `docs/your-own-project.md`, and
`issues/system/0230a`. The seed is built from this entry, so a half-finished move is a checkout that
cannot rebuild itself — `deno task seed:bootstrap` is the way back, and is worth knowing before
starting rather than after.

## Order

1. Correct the two wrong sentences first — they are pushed and they mislead. (Cheap, no build.)
2. Move the command's code out of the example into modules something can import.
3. Add `packages/wac/src/wac.wac` and repoint the build at it, one consumer at a time.
4. `sh` and `update` join it, which is the thing the operator asked for and the reason the rest matters.

## Step 4 is blocked by a compiler limit — agent-c, 2026-08-25

`sh` and `update` dispatched from `wac.wac` is nine lines, and it does not build.

    wacc: cannot emit packages/wac/src/wac.wac — the emitter ran out of room for functions

**Why it is bigger than it looks.** `wac sh` has to be what the native ships, which is
`packages/box/example/boxsh.wac` — the shell *with box's sixty-five applets wired in*. So dispatching
it in-process pulls `packages/sh` and `packages/box` into the command's graph, and `wac update` adds
`packages/wacpkg`. The command went from **44 files to 218**, and `Env`'s function table is a fixed
`string[4096]`.

It declines rather than truncating, which is `issues/lang/0158`'s rule working exactly as intended.

**Raising it is not enough, and that is the interesting part.** 4096 → 16384 changes nothing on its
own, because the compiler doing the compiling is the *seed*, and the seed still has the old number
baked in. `deno task seed:bootstrap` is the documented way out of "wacc cannot build itself" — and it
fails the same way, because with the entry now being the command, "build wacc with the reference and
the app with wacc" has wacc building a 218-file program either way.

So the order is: make the table grow instead of being sized, get that into a seed, then dispatch. The
caps want to be `Vec`s — `funcs`, `funcReturns`, `funcParamAt`, `funcParamCount` are four parallel
arrays with a hand-rolled cursor, and `withoutIgnored` and the test walk have already been through
this conversion. Filed separately.

**What landed anyway**, because it is independently right: `packages/wacpkg/example/fetch.wac` is
`packages/wacpkg/src/fetch.wac`, and its `main` is a wrapper around `fetchAll(core, cli, dir, wacHome)`
— the shape step 4 needs, and the move `issues/system/0258c` recommended waiting for a better reason
to make. This was the better reason.

## The first limit is lifted; there is a second one behind it, and it does not report

The function table is `string[4096]` and friends — **seven parallel arrays and two cursors**, found by
matching the *type signature* of `Env`'s fields against the constructor's argument list, after raising
a different group of `string[4096]`s by eye and watching the build fail unchanged. Raised to 16384
(and `funcParamTypes` to 65536), the seed rebuilds and is a fixed point, and the dispatch gets past it.

**Then it traps.**

    wac: packages/wac/src/wac.wac trapped

No message, which by `issues/lang/0254c`'s reading means an *engine* trap — a bounds check or a null
dereference — rather than a `trap "…"`. So there is a second fixed-size table on this path with no
`ranOut` guard on it: the emitter has caps that decline politely and caps that fall over, and a
218-file program finds both.

That is the next thing to do and it is a compiler debugging job, not a dispatch one. The order stands:
make these tables grow, get that into a seed, then dispatch.

## The second limit was two of the eight arrays, and the guard bounded the cursor by one of them

**`funcCount` indexes eight arrays and `addFunc` checked one.** Six were raised together because they
sit in one block in `Env.create()` and were found by matching that block's type signature; `funcRecv`
and `funcMethodGeneric` are declared *ninety fields later* in the struct, so they were not in the
block, stayed at 4096, and the cursor walked off their ends at 4097. `collectInstances` writes
`funcRecv[funcCount - 1]` with no check of its own, so the trap landed three frames below anything
that mentions a table.

    RuntimeError: array element access out of bounds
        at emit$collectInstances
        at emit$collectDeclarations
        at emit$frontOfRaw → frontOf → buildLinked → api$buildFilesIn

**Getting that stack is the transferable part.** A trap with no message is not a dead end just because
`0254c` says the message is gone: the *host* decides how much of it survives. The native binary
catches it and prints `wac: … trapped`; `wacland` cannot compile at all in this checkout; but
`harness/waccBuild.ts` runs wacc **in-process under Deno**, where the trap is an ordinary JS exception
and V8 keeps the wasm frames with their names. Twenty lines of Deno turned "somewhere in a hundred and
fifty fields" into one function. Do that first next time, rather than reading the struct.

Static analysis had already said the opposite, confidently: every cursor in `emit.wac` is guarded, all
twenty-four of them. That was true and useless — the bug is not a missing guard, it is a guard whose
bound is one of the eight things the cursor indexes. `addFunc` now checks all eight, so a future drift
declines with a sentence instead, and `packages/wacc/test/wac/envtables_test.wac` asserts the eight
lengths agree, which fails in a millisecond and names the array.

**Step 4 builds.** 218 files, 1,656,793 bytes, and `wac sh -c 'echo …'` answers from the one program.

## Unifying the command unifies its grants, and that is the part to watch

`wac update` clones over the network, so the one program's manifest is the **union** of what its
subcommands need — `tools/seed.sh` now builds the seed with `--allow-net` and every `wac build`,
`wac check` and `wac test` carries it. Three payloads meant three manifests and each command reached
only what it needed; one program cannot have that for free.

**What buys it back is narrowing inside the program**, and `packages/wac/src/grants.wac` is the
mechanism: forty fields, pass on what was asked for and refuse the rest with `FAULT_NOT_GRANTED`,
which is the code the hosts themselves use. `wac sh` uses it and is byte-identical to the payload it
replaces — sealed by default, `--allow-read` reaching the same file, the same refusal text. **The
compiler's own subcommands do not use it yet and hold more than they use.** That is the remaining
least-privilege work and it is not hard, just wide: `cli` is threaded through the whole file, so it
is a rename rather than a decision.

The narrowing has one property `run_shell` had to check for: it cannot widen. What it passes on is
the capability *this program* was handed, so `wac sh --allow-net` from a `wac` that was never granted
net gets nothing. The ceiling enforces itself instead of being compared against a manifest.

**Two things this cost, both worth keeping:**

- `openInput("")` and `openOutput("")` are standard input and output, not paths, and no grant covers
  them — `std/platform.wac` says the read grant is "`readFile`, `stat`, `readDir` and `openInput` *on
  a path*". Refusing them broke every pipeline in a sealed session: `seq 1 5 | wc -l` answered
  `wc: : Not granted to this application`, a message about a filesystem, about standard input.
- A sealed session was first given `Fs.inMemory` with a `/bin` and `/tmp`, which is
  `packages/box/src/bin/sealedsh.wac`'s much nicer world. It broke pipelines a second way: an applet
  reading standard input asks for the path `""`, and `Fs.onHost` knows that convention while
  `Fs.inMemory` does not. Worth fixing in `packages/fs`; not worth `wac sh` differing from the
  shipped one to get it.

**Two ordering facts worth keeping**, because each cost a five-minute build:

- Raising a cap and adding the dispatch in one go changes nothing. Round 1 compiles with the seed
  *already installed*, which still has the old number.
- Removing the dispatch is not enough to shrink the graph — the **imports** pull it in. 218 files
  stayed 218 until the five import lines went too.

## Step 4 is done — 2026-08-25

The binary carried three payloads and carries one. `sh` and `update` are dispatched inside the
program, `native/v8/build.rs` embeds only the compiler, `run_shell` and `update_command` are gone from
`native/v8/src/main.rs`, and `tools/seed.sh` has no `payload()`. The two usage lines the host printed
under `if SHELL.is_some()` are in the program's own `usage()`, where they are true on every host
rather than on whichever binary happened to carry the module.

    binary            70,201,352 -> 68,889,736 bytes
    seed/             wacc.wasm, sh.wasm, update.wasm -> wacc.wasm
    seed              one payload, no `payload()`, and nothing to forget building

**What verified it was an existing test.** `tools/wac/sh_test.wac` spawns whichever binary is on this
machine and checks `wac sh` sealed and granted — the front page's own two pipelines, plus that a
refused write says *not granted* rather than a filesystem error. It passed against the payload and
passes against the program, which is the whole claim. `commandparity_test.wac` is green over its 34
invocations and three hosts, and `packages/wacpkg/test/wac/update_test.wac` over the fetcher.

**The differential got slower and that is real**: parity was about 56s and is 83.7s wall / 97.4s CPU,
because each host now builds a 219-file program rather than a 44-file one. Three hosts × 34
invocations is where it lands.

`issues/system/0258c` closed as a consequence rather than by being fixed — `boxsh.wac` is not compiled
into anything shipped any more, so an `example/` directory is where it belongs.

**What is left is the least-privilege half**, written up above: one program means one manifest, so
`--allow-net` is now held by every `wac build`. `packages/wac/src/grants.wac` is the mechanism that
buys it back and only `sh` uses it. Filing that separately rather than leaving it in here.
