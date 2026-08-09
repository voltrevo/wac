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
    design/lang/   design/system/
    issues/lang/   issues/system/

`issues` and `design` are split by category rather than provenance: both trees numbered from 0001
and 79 numbers collide. A reference to "wac 0076" means `issues/lang/`, and "wac-mono 0103" means
`issues/system/`. New issues continue whichever sequence they belong to.

## Running things

    deno task test                                    the suite
    deno task map --check                             MAP.md is generated; staleness is a failure
    deno test -A --unstable-sloppy-imports --no-check site/tools/site.test.ts

The site needs those two flags and nothing else does — `site/src` is a vite project whose
extensionless imports Deno's resolver refuses. Its TypeScript is checked by `npx tsc -b` in `site/`,
which is the checker that agrees with the bundler building it. `site/` is excluded from the
repo-wide Deno walks for the same reason.

**Anyone may change the compiler.** It used to have one owner and a rule that sent everyone else to
the issues directory; that is no longer the case. If you are building something *in* wac and hit a
compiler bug or need a language feature, fixing it is ordinary work.

File an issue when the blocker is a *decision* rather than the work — a change that would make the
shared test suite red for everyone, or one where two reasonable answers exist and picking wrong is
expensive to undo. A reproduction is still worth more than a patch when you are not going to write
the patch.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before touching `compiler/` — it defines the atom rules,
the pure-TypeScript conventions and the testing discipline that directory follows.
