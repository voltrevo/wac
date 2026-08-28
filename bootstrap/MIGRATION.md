# Migration — wacboot into wac

**A living document**, in the shape `PLAN.md` uses: items carry a status, and they move between
sections rather than being deleted, so the reasoning stays next to the decision.

Status is one of **agreed** (decided, not started), **doing**, **done**, **open** (needs a
decision), or **parked** (deliberately not now, with a reason).

---

## Summary

wacboot moves into wac with its history, and the 35,249-line TypeScript compiler is deleted. The
ladder becomes the way wac is bootstrapped.

Getting wac from source becomes one script: `bootstrap.sh` at the repo root, `--host {rust,deno,
nodejs}`, defaulting to rust and to installing. It works inside a clone or piped from curl, checks
what it needs before it starts, and reaches no network for the JavaScript hosts.

Installing becomes `wac self install` and `wac self uninstall`, subcommands rather than a task, and
they install the artefact that was just built rather than building another one.

Three things are deliberately **not** changing this pass: `wac app`, which already produces one
artefact that runs on every host; the browser application target; and the application builder that
serves it. Deleting the TypeScript compiler removes the last independent check on wacc being right,
which is accepted rather than solved.

---

## What moves, and what goes

**Agreed.** wacboot's history is preserved into wac. The ladder's five rungs, its assembler, its
flattener, its hosts and its tests come across; `PLAN.md` and this file come with them.

**Agreed.** `compiler/` is deleted — 35,249 lines of TypeScript, imported by 36 files of which 15
are tests. `deno.json`'s `"wac/": "./compiler/"` mapping goes with it.

---

## `bootstrap.sh` — **agreed**

One script at the repo root. Not three native entry points: `npm run build`, `deno task build` and
`cargo build --release` were considered and rejected, because cargo cannot express *build the
ladder, run it, then build the runtime from its output* without a `build.rs`, and a `build.rs`
compiles its dependencies separately from the crate's — so V8 would be built twice. A shell script
sequences the same three steps in the open, with V8 built once, and needs no `build.rs` at all.

    bootstrap.sh [--host rust|deno|nodejs] [-o PATH] [--no-profile]

- **Defaults to `--host rust`**, the only host whose output is a single self-contained file.
- **Defaults to installing.** `-o PATH` builds and installs nothing.
- **Checks before it starts**: that the host toolchain is present, and — when installing — that the
  shell profile is writable. The profile check exists because of a recorded incident where an
  unwritable `.bashrc` aborted an install *after* the binary, cache, `env` and `install.json5` were
  in place, reported failure over a working installation, and re-running could not help.
  `--no-profile` stays, so a container with no writable profile can still install.
- **Runs the fixed-point check before installing**, with no flag to skip it. Installing a subtly
  wrong compiler is the worst outcome available here and the check costs about a second.
- **Works with no clone.** Piped from curl it checks for git, shallow-clones to a temp directory,
  and removes it on the way out.

**The sharp edges, all in the curl case.** The script must never read stdin, because stdin *is* the
script — every decision comes from a flag, which the upfront-error design already satisfies.
Arguments arrive as `curl … | sh -s -- --host deno`, and `sh --host deno` silently does something
else. Cleanup belongs in a `trap`, not a line at the end, or a failed build leaves a full clone in
`/tmp`. And `-o` must be resolved to an absolute path *before* changing into the clone.

**Open — which ref the curl path clones.** The script arrives from one URL and would clone HEAD;
those can disagree. It should pin to the ref it was published at, and print the commit it built.

---

## `wac self install` / `wac self uninstall` — **agreed**

Today install is a *task* (`wac task wac:install`) and uninstall is already a subcommand. Both
become `self` subcommands, and the task is deleted.

**`self`, rather than plain `install`.** `wac`'s subcommands are `app audit bindgen build check
covdump ctcompare help run sh task test tracestat uninstall update validate`. `install` is free, but
`wac update` is the *package* updater — a bare `update` means the project you are in, and it reads
`wac.json5`. So the namespace already mixes project verbs with toolchain verbs, and a plain `wac
install` would land on that fault line and take the name wacpkg will want.

**What install means changes.** From "build a seed, then install it" to "install the artefact I
already am". That is the better meaning and it is what the three-host story needs, since each host
has already built its artefact by the time install runs. The build half moves into `bootstrap.sh`.

**The running program learns its own path** — a small widening of the capability surface, added
straightforwardly rather than as a design note. `Cli`/`Core` gains it; the native host answers from
`current_exe`, the JavaScript hosts from their own entry path.

### The circular advice, which is a live bug — **agreed**

`app.wac` generates this into every built application:

    command -v wac >/dev/null 2>&1 || {
      echo "$0: needs the wac command on PATH — wac task wac:install" >&2

It fires exactly when `wac` is not on PATH, and the remedy is a `wac` subcommand. At the one moment
the message appears, the advice cannot be followed. Renaming the string to `wac self install` would
fix the staleness and keep the bug.

The preamble should name something runnable *without* wac — the bootstrap URL — and say no more.
That line is generated *into* the artefact, so every application built before the change carries
the old advice for as long as it exists; a stable URL is a much better thing to bake into a
long-lived file than a command in another subsystem, which has now changed spelling twice.

The phrase appears in twelve places: `app.wac`, twice in `wac.wac`, `platform/build.ts`,
`spec/cli/wac.md`, `CLAUDE.md`, the website's roadmap, and four lines of `tools/install.ts`'s own
header. The generated one gets a URL; the rest become `wac self install`, since they are documenting
the toolchain to somebody who already has it.

---

## The JavaScript-hosted wac — **agreed**

It already exists and is already one file: `--target deno|node` builds "a JavaScript file with a
shebang, and nothing that runs it needs to know which". The wasm is base64 inside it, which is the
right encoding and not a choice — a Node or Deno file is parsed as JavaScript end to end, so raw
bytes cannot simply be appended the way `wac app`'s shell preamble appends them.

**What changes is that the bootstrap stops using a bundler.** Today the hosted install shells out to
`deno bundle`, which fetches `@esbuild/<platform>` from npm the first time; one recorded run sat
silent for about 74 seconds before failing on that fetch.

The bundler is doing two jobs — stripping TypeScript types and resolving an arbitrary module graph —
and the bootstrap has neither problem. Its input is a *fixed* host bridge rather than glue generated
per application, and wacboot's `js/` is already plain JavaScript with JSDoc types and `deno check` as
a lint rather than a build step. Fixed input with no types needs concatenation in a known order, not
a bundler.

**This removes esbuild from the bootstrap only.** Application builds still go through
`packages/platform/build.ts` and still fetch on a cold cache. That is the separate project below.

---

## Not changing this pass

**`wac app` — parked, because it is already right.** It takes no host and needs none: measured on
2026-08-26 it "writes byte-identical artefacts on all three" hosts, and `commandparity_test.wac`
holds 52 invocations to the same answer. The artefact is a `#!/bin/sh` preamble, a NUL, then the raw
wasm, and it runs wherever `wac` is on PATH regardless of which host that wac is. It shells out to
nothing; `setExecutable` is its only capability. A `--host` flag was proposed here and withdrawn —
there is nothing to unify.

**Executables that run without wac — parked, a non-goal.** `wac app`'s artefact requires `wac` on
PATH. `build.ts` also produced standalone bundles that do not. Not preserved.

**The browser application target — parked, and it will change later.** Deleting it would remove
about 1,500 lines of runtime (`host/browser.ts` 1,021, `host/entryBrowser.ts` 465) and about 1,850
of tests (`browser_live.test.ts` 853, `browser.test.ts` 637, `raster/test/live.test.ts` 217, part of
`sinks.test.ts`), and with them the ability to run a wac application in a browser at all.

It costs nothing to keep. `build.ts` already defaults to **wacc** — the TypeScript compiler is an
opt-in differential behind `WAC_APP_FROM=reference` — so removing the compiler is deleting an
else-branch and two imports, not a port.

**Two things that share the word "browser" and are not this.** wacboot's ladder-in-a-page —
acceptance criterion 3, `hosts/browser.js` and `web/index.html` — references nothing under
`platform/host` and is untouched. And `packages/raster` is a pixel buffer and the drawing on it;
the browser was one place to show the buffer, not the point.

---

## The oracles this removes — **agreed, and accepted**

Deleting the TypeScript compiler removes three independent checks, all at once:

1. **`W1 == X1`.** The fixed point is currently proved against the reference. What remains is
   round-0 against round-1 self-consistency, which by construction cannot catch a bug that is stable
   under self-application.
2. **Fifteen TypeScript tests** that use the reference as the answer.
3. **`WAC_APP_FROM=reference`** — build an application both ways and compare.

Accepted rather than solved. The one thing asked of the removal commit: **pin what the two sides
last agreed on** — the wacc hash and the app artefacts — so that "these were identical on this date"
survives the deletion even though the ability to re-run it does not.

---

## Order

1. `bootstrap.sh`, against the repositories as they stand — it is the piece everything else needs
   and it can be written and tested before anything moves.
2. `wac self install` / `wac self uninstall`, the task deleted, the circular advice repaired.
3. The move: wacboot's history into wac.
4. `compiler/` deleted, with the last agreed hashes pinned in the commit.

Steps 1 and 2 are independent of the move and do not need it to have happened.
