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
    deno test -A --unstable-net packages/<name>/      one package, by hand
    deno test -A --unstable-sloppy-imports --no-check site/tools/site.test.ts

**`deno task seed` after touching `packages/wacc/` — or after *pulling* someone else's change to it.**

**It no longer uses Deno.** `deno task seed` is now `wac build` — the binary compiling its own
compiler — followed by `cargo build`. It is a fixed point: the compiler the binary produces, used to
build the compiler again, is byte-identical. `deno task` is only the task runner here; nothing in
that command needs a JavaScript host.

The Deno path is `deno task seed:bootstrap`, and it is still the one that works from **nothing**: the
seed is gitignored, so a fresh clone has no binary to build with and `cargo build` cannot start
without one. Run it once, then `deno task seed` from then on. `WAC_APP_FROM=reference` in front of it
compiles the seed with the *reference* compiler rather than wacc, which is the escape hatch if a
wacc change has made wacc unable to build itself.

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
