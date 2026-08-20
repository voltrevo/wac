# wac

A C-family language for WebAssembly GC, and the systems stack written in it. See
[README.md](README.md) for the layout, [spec/](spec/) for the language definition, and
[packages/README.md](packages/README.md) for how to run things.

**This repository was two repositories until 2026-08-09.** If you have a checkout of `wac` or
`wac-mono` from before then, it cannot fetch this history — see [MERGE.md](MERGE.md), which is the
first thing to read if anything about the layout surprises you.

To learn the language itself, read [spec/tour.wac](spec/tour.wac) first — the whole of wac in one
annotated file that compiles and self-tests. It is much faster than reading `spec/spec/*.md`, and is
the right starting point before writing or reviewing any wac code.

## wac is unstable by choice

`spec/tour.wac` says it in its header and it governs more than the language: **there are no users and
no legacy to support.** Nothing here has to keep working for someone outside this repository.

So **when nothing needs a thing, delete it.** Not deprecate it, not keep it behind a flag, not keep it
"as a convenience" or because a test happens to read it — change the test. A second copy of anything
is a copy that drifts, and git remembers what was deleted.

This applies to code, tasks, tests, files written beside other files, and whole subsystems. Two
producers of one artefact is one producer too many. A differential that exists only to prove the old
thing still agrees with the new one goes when the old thing stops being used — keeping it makes the
retiree an oracle, which is the arrangement rather than evidence about it.

**If you find yourself proposing to keep something, say what would break, and check that it is not
just a test you could edit.** That question is the whole rule.

Breaking changes are logged in `~/notes/living/wac/breaking-changes.md` — check there first if a
program that used to compile has stopped.

## Where things are

    spec/          the language: definition, tour, cli documentation
    compiler/      the compiler, in TypeScript — was `atoms/wac/`
    packages/      the packages written in wac, including `wacc`, the compiler ported to wac
    native/        the host with no JavaScript in it: Rust on wasmtime
    harness/       the test harness the packages share
    site/          the website — the only npm subtree; everything else is Deno and Rust
    tools/         repo-wide tooling
    docs/          cross-cutting detail with no home in spec/ — overflow, constant time,
                   the engine features a module needs, how to run things
    design/lang/   design/system/
    issues/lang/   issues/system/

`issues` and `design` are split by category rather than provenance: both trees numbered from 0001
and 79 numbers collide. A reference to "wac 0076" means `issues/lang/`, and "wac-mono 0103" means
`issues/system/`. New issues continue whichever sequence they belong to.

## Running things

    deno task test                                    the suite
    deno task docs                                    the doc checks — a wac phase, then Deno's
    deno task map --check                             MAP.md is generated; staleness is a failure
    deno task seed                                    rebuild the compiler inside the `wac` binary
    deno task seed:bootstrap                          ...from a clone with no binary yet
    deno task wac:install                             build it and put it on PATH — $WAC_HOME
    deno task wac:build -o ./wac                      ...or just build one, installing nothing
    deno task wac:uninstall [--keep-cache]            and take it away again
    deno test -A --unstable-net packages/<name>/      one package, by hand
    deno test -A --unstable-sloppy-imports --no-check site/tools/site.test.ts

**`deno task wac:install` is the supported way to *have* the command** — `design/lang/0009` D1. It
builds the seed (fixpoint-checked), installs `bin/wac`, `cache/git/`, `env` and `install.json5`
under `$WAC_HOME` (default `$HOME/.wac`), and adds one marked line to whichever of `.bashrc`,
`.zshrc` and `.profile` already exist. Running it again is how you upgrade: the line is replaced
only if it points somewhere else, and a profile that does not exist is not created. `wac:uninstall`
removes exactly those things and never a manifest, a lockfile, a source file or a build product.

**`deno task seed` after touching `packages/wacc/` — or after *pulling* someone else's change to it.**

**It no longer uses Deno.** `deno task seed` is now `wac build` — the binary compiling its own
compiler — followed by `cargo build`. It is a fixed point: the compiler the binary produces, used to
build the compiler again, is byte-identical — and since 2026-08-17 the command **checks** that
rather than asserting it, and puts the previous seed back rather than keep one that is not
(`tools/seed.sh`, `design/lang/0009` D2). `deno task` is only the task runner here; nothing in
that command needs a JavaScript host.

**It builds all three payloads, and costs about 34s.** The binary carries a compiler, a shell and a
fetcher — `wac build`/`run`/`test`, `wac sh`, `wac update` — and until 2026-08-20 this script wrote
only the first, so the supported route produced a `wac` answering `unknown command 'sh'` and a red
suite for anyone who ran `wac update` (`issues/system/0216a`). Of the 34s, the fixpoint is about 13s
and the other two payloads are 12.4s and 3.9s plus a `cargo build`.

**And it is the one to reach for when an unrelated file stops compiling.** A `wacc` change from
another agent can be one the *current* seed cannot compile, and the symptom is not "your seed is
old" — it is an ordinary file failing to emit with a message about lambdas or about a construct that
was fine yesterday. `deno task seed` cannot recover from that, because it needs the seed to rebuild
the seed. `seed:bootstrap` can, because it starts from the reference compiler.

The Deno path is `deno task seed:bootstrap`, and it is still the one that works from **nothing**: the
seed is gitignored, so a fresh clone has no binary to build with and `cargo build` cannot start
without one. Run it once, then `deno task seed` from then on.

**Plain `seed:bootstrap` is the escape hatch when a wacc change has made wacc unable to build
itself**, because it builds wacc with the *reference* and the app with wacc — so the binary that
false-alarms is out of the loop. It is needed more often than it sounds: a new checker rule that
reports on `packages/fs/src/proc.wac` cannot build its own successor, since that file is in the seed
app's graph, and the symptom is a seed build failing on a file you did not touch.

**`WAC_APP_FROM=reference` in front of it no longer works**, and used to be the answer here. It asks
the reference to compile the *app*, and the app imports `packages/platform`, whose `Pending<T>.then`
is a lambda — so the reference now answers with a parse error at `platform.wac:278` rather than a
seed. Not a regression to fix: it is what "the reference has no lambdas" means, arriving in the one
place that had been reaching past it.

The `wac` binary carries a *prebuilt* compiler —
`native/v8/seed/wacc.wasm`, gitignored, one per agent — so `wac build`, `wac run` and `wac test` keep
compiling with whatever that file is until it is rebuilt. `cargo build` does not do it: the seed is an
input to the build, not an output of it. A seed two days behind produced a coverage report over
`packages/std` that named real files and real lines and was 40% short, and the shape of the evidence
pointed at the profiler rather than the compiler (`issues/system/0160`). `tools/seedFresh.test.ts`
fails when the seed is older than the sources, which is how you will usually find out.

The *pull* half is easy to miss, because nothing you did made it stale: this is a shared repository and
another agent's commit to `packages/wacc/src` ages your seed the moment you merge it. So the rule is
about the file's mtime rather than about your own edits — `git pull` before a gate run and the gate
fails on the seed, which is exactly what happened twice in one day. Rebuild after a merge that touches
that directory, and before running anything that goes through the `wac` binary.

**`--unstable-net` when you run tests by hand.** `deno task test` passes it for you, so it is easy to
not know about until a package fails with `Deno.listenDatagram is not a function` or
`Deno.QuicEndpoint is not a constructor` — messages about a missing API rather than about a flag.
`packages/quic` and `packages/platform`'s datagram tests need it; nothing else notices it, so it costs
nothing to pass always. `tools/mutate.ts` lacked it for a day and quietly stopped measuring whole
packages — `issues/system/0005`.

The site needs its own two flags — `site/src` is a vite project whose
extensionless imports Deno's resolver refuses. Its TypeScript is checked by `npx tsc -b` in `site/`,
which is the checker that agrees with the bundler building it. `site/` is excluded from the
repo-wide Deno walks for the same reason.

**A script under `site/` that reaches `harness/` needs `--import-map deno.json`.** `site/package.json`
puts that subtree in an npm resolution scope, so the bare `wac/` specifier — mapped to `./compiler/`
at the root — is looked up as an npm package and fails with `Import "wac/wacLex.ts" not a dependency`.
The same file run from the repo root is fine, which is what makes it confusing. `issues/system/0146`
is the deploy this cost: the published playground quietly compiled with the reference for a while,
because the page falls back when the asset is missing and nothing said it was.

**Anyone may change the compiler.** It used to have one owner and a rule that sent everyone else to
the issues directory; that is no longer the case. If you are building something *in* wac and hit a
compiler bug or need a language feature, fixing it is ordinary work.

File an issue when the blocker is a *decision* rather than the work — a change that would make the
shared test suite red for everyone, or one where two reasonable answers exist and picking wrong is
expensive to undo. A reproduction is still worth more than a patch when you are not going to write
the patch.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before touching `compiler/` — it defines the atom rules,
the pure-TypeScript conventions and the testing discipline that directory follows.
