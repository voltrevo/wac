# 0296 — put all four hosts on PATH as `wac-<host>`, with `wac` the v8 one

- **Status:** open — decided by the operator 2026-08-30, not yet built
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-30
- **Kind:** missing feature
- **Symptom:** not implemented

## What is wanted

Developing in this repository, all four hosts are on PATH:

    wac-v8  wac-wasmtime  wac-nodejs  wac-deno       and  wac == wac-v8

A test that wants a host names it and shells out. Nothing builds a program *for* a host.

## It works today, measured

The claim `bootstrap.sh` already makes — *"Every host produces the same `wac`, because the command is
`packages/wac/src/wac.wac` — a wac program the host carries. What differs is the engine underneath it"* —
extends to applications, and that had never been exercised. One artefact, built by the v8-hosted `wac`,
run by a deno-hosted one:

    $ ./native/v8/target/release/wac app probe.wac -o probe --allow-net
    $ wac-deno app-run probe        # built by wac-v8
    listened ok
    $ wac-v8   app-run probe
    listened ok

So `wac app`'s output is host-independent, and **"a program for host X" was never a build variant** — it
is one artefact and a choice of runner.

## What it settles

**`issues/system/0295c` becomes a two-line differential.** That bug — both Rust hosts reporting an
unnameable path as absent — survived because the numbering exists four times and the two checks compare
different pairs: `faults_agree.test.ts` does TypeScript against wac, `hostfaults_test.wac` does the two
Rust hosts against each other. Nobody compared a JavaScript host's *answer* with a Rust host's. With the
hosts on PATH:

    $ wac-v8   app-run box stat "$name"
    stat: cannot statx '…': No such file or directory
    $ wac-deno app-run box stat "$name"
    stat: cannot statx '…': cannot be named on this host

**`packages/platform/build.ts`'s `deno` and `node` targets lose their last argument.** `design/system/0009`
resolved that they go for user programs and kept them for the five host-comparison tests, on the grounds
that *"those targets are what the tests compare"*. They are not: those tests want a runner. The browser
target stays, because a page has no PATH to find a `wac` on.

**`harness/buildApp.ts` stops needing its hack.** It prepends `native/v8/target/release` to PATH at import
time, as a side effect, so the artefact's `command -v wac` finds this tree's build. With the hosts on PATH
deliberately, that line is the environment being right rather than a module arranging it, and what remains
is a subprocess call.

**`packages/box/test/node_shell.test.ts`** reaches the Node-hosted path through a second *builder*; it
becomes `wac-nodejs app-run`.

## What has to be decided

- **Which are built, and when.** Two need cargo (v8, wasmtime) and two do not (deno, nodejs, ~45 s each per
  `0009`). The wasmtime host is already built on request rather than by default, and
  `nativeHostWhyNot()` in `packages/wactest/src/built.wac` is the existing shape for a test to skip with a
  reason — that extends to all four rather than needing anything new.
- **Where they live and who puts them on PATH.** `bootstrap.sh` writes one binary today. Four means a
  directory the repo owns and a line in the environment, and it should be the same directory `wac self
  install` uses so a developer and a user are not different cases.
- **What `wac` is.** A symlink to `wac-v8` is the simple answer and matches the current default.

## Not to be confused with

`bootstrap.sh --host <h>` already builds any of the four. This issue is not about building them — it is
about all of them being *present and named* while developing, so a cross-host question is a shell command
rather than a build configuration.
