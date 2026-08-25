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
`packages/wacpkg/example/fetch.wac` needs its `main` body lifted into a function taking a directory
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
