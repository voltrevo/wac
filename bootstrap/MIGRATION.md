# Migration — wacboot into wac

**A living document**, in the shape `bootstrap/PLAN.md` uses: items carry a status, and they move between
sections rather than being deleted, so the reasoning stays next to the decision.

Status is one of **agreed** (decided, not started), **doing**, **done**, **open** (needs a
decision), or **parked** (deliberately not now, with a reason).

---

## Summary

**Done, 2026-08-28.** wacboot moved into wac with its history and the TypeScript compiler is
deleted — 35,352 lines. The ladder is how wac is bootstrapped: five rungs whose lowest is
hand-written wasm assembly text, `./bootstrap.sh` from a cold checkout, and no seed binary in the
repository to start from.

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
flattener, its hosts and its tests come across; `bootstrap/PLAN.md` and this file come with them.

**Agreed.** `compiler/` is deleted — 35,249 lines of TypeScript, imported by 36 files of which 15
are tests. `deno.json`'s `"wac/": "./compiler/"` mapping goes with it.

---

## `bootstrap.sh` — **done for `--host rust`**

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
- **Checks the compiler it built before installing**, with no flag to skip it, because installing a
  subtly wrong compiler is the worst outcome available here.

  **It is a weaker check than this section first promised, and the difference is worth stating.**
  What it does: the new binary parses and type-checks wacc's own source — twenty-four files, the
  largest input there is — and must report no diagnostics. 853 ms. What it does *not* do is compare
  `W1` against `X1`: that needs wacc built twice and the bytes compared, and the Rust ladder has no
  mode for it — `bootstrap/ts/selfhost.ts` does it through a driver, in TypeScript. So the suite
  makes the fixed-point claim and the script makes the weaker one. Giving the ladder a self-check
  mode would let the script make it too, and is the obvious next thing here.
- **Works with no clone.** Piped from curl it checks for git, shallow-clones to a temp directory,
  and removes it on the way out.

**The sharp edges, all in the curl case.** The script must never read stdin, because stdin *is* the
script — every decision comes from a flag, which the upfront-error design already satisfies.
Arguments arrive as `curl … | sh -s -- --host deno`, and `sh --host deno` silently does something
else. Cleanup belongs in a `trap`, not a line at the end, or a failed build leaves a full clone in
`/tmp`. And `-o` must be resolved to an absolute path *before* changing into the clone.

**Which ref the curl path clones — agreed: `master`.** The script arrives from one URL and clones
another, so the two can in principle disagree; pinning to a published ref is the eventual answer and
`master` is the default for now. It prints the commit it built, which is what makes a disagreement
visible rather than silent.

---

## `wac self install` / `wac self uninstall` — **done**

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

**It takes `--from PATH`, and the capability is deferred.** The plan was for the running program to
learn its own path — agreed as a straightforward addition. On writing it the cost turned out larger
than "straightforward": `Cli` lives in `std/platform.wac`, whose text is carried inside
`packages/wacc/src/coretext.wac`, so adding a field changes the compiler's bytes and the seed's —
and that file also carries a live ASCII-only hazard (`issues/lang/0253a`). That is a lot of blast
radius for a convenience whose only caller, `bootstrap.sh`, already knows the path because it just
built the file. Deferred rather than decided against; `--from` is what ships.

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
acceptance criterion 3, `bootstrap/hosts/browser.js` and `bootstrap/web/index.html` — references nothing under
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
last agreed on**, so that "these were identical on this date" survives the deletion even though the
ability to re-run it does not.

### The last agreed fixed point

Measured on commit `246ed978`, against wacc's 23 source files and 40,241 lines:

    W0  wacc built by wac-L5          696,449 bytes
    X0  wacc built by the reference   932,512 bytes
    W1  wacc built by W0              742,168 bytes
    X1  wacc built by X0              742,168 bytes

    W1 == W2   our ladder is at its fixed point      true
    X1 == X2   the reference is at its fixed point   true
    W1 == X1   the two fixed points are the same     true

    sha256  3fef5aae8784f4cc96891a38b3426b7a26811b30ccd8de9983590f78c7fd1a2d

ts/same_fixed_point.ts prints that hash now rather than only the verdict, so the claim is
checkable against a rebuild rather than being a sentence somebody wrote. After `compiler/` goes,
`X1` cannot be computed at all — the hash is what remains.

**A discrepancy found while gathering it, worth knowing about.** Two paths in this bootstrap disagree
about whether to *supply* the builtin modules as files. `same_fixed_point.ts` walks only relative
imports, so wacc serves `core/` and `std/` from `coretext.wac` and W1 is 742,168 bytes. `fileSet` —
and `file_set` in the Rust host — resolve them from disk and pass them in, and the same build is
740,818. Both produce a working compiler and the ladder's `wac.wac` build matches wac's own byte for
byte either way, so nothing is broken; but two file sets that differ by 1,350 bytes of compiler is a
difference somebody should choose deliberately rather than inherit.

---

## Found during the move

**The move alone did not put the ladder under wac's gate.** Discovery matches `*.test.ts` and
`*_test.wac`; wacboot named its tests `*_test.ts`, which is neither, so 237 tests sat in the
repository untouched — the exact gap the move was for. Renamed, and `browser.test.ts` now declares
`// test-lane: exclusive` because it is flaky only under contention and wac's lane already has the
mechanism for that.

**Three stale references surfaced**, all older than the move and none of them caused by it:
`rust/src/lib.rs` pointed at a spec file that never existed; `native/v8/build.rs` documents building
the seed with a task that has never been in the registry, and which is not how it is built; and
bootstrap/ts/same_fixed_point.ts had to be added to tools/wac/referencecallers_test.wac's
sanctioned list, which is the right answer — that file exists to compare the ladder against the
reference, and it goes in the same commit that deletes the reference.

The general shape: wacboot had no guards and wac has several, so the move ran the ladder's prose
past checks it had never faced. **wac's task-name guard reads markdown and not `.rs`**, which is why
`build.rs`'s stale line survived and the `.md` that quoted it did not.

## The manifest, which no host should be writing — **done**

`bootstrap.sh --host deno|nodejs` looked blocked: the JavaScript hosts take `-o` and `--l0` only,
with no `--with-wacc` and no manifest writer. The obvious reading is that they need one.

They do not. The Rust host asks wacc for the `exportSigs` and `bindTypes` wires and then **formats
the manifest JSON itself**, in `rust-ladder/src/manifest.rs` — while wacc already exports
`manifestOf(wasm, wire, sigs, entry, wasmName, grants)` and `withManifestSection(wasm, manifest)`,
which is that job. So there are two implementations of one format, and `ts/manifest.test.ts` exists
to police the drift between them.

The answer is a deletion rather than a third copy: every host drives wacc's own two functions
through the byte-at-a-time driver, the way `drivers/spec_cases.wac` already drives everything else.

**Done, and checked the only way worth checking.** `drv_seal` asks wacc; the Deno and Node hosts
gained `--with-wacc`, and all three hosts write the wac command **byte for byte identically** —
1,797,342 bytes, manifest section and all. Rust 9s, Deno 14s, Node 17s.

`manifest.rs` is deleted: 600 lines against 37 added, plus `bind_table` and the three methods whose
only job was fetching the wires. And the deletion found a difference the byte comparison had not —
`drv_seal` used the file set's *key* for the manifest's `entry`, where wac's own build records the
path as written. The two coincide in every comparison I had run and do not in
`ts/manifest.test.ts`, which compiles from an absolute temp path. Three names now, because they are
three things.

## What a JavaScript-hosted `wac` still needs — **open, and larger than I said**

Building the *module* is done. Running it is not, and I gave a figure for this earlier that was
wrong by an order of magnitude.

A JS-hosted wac is a single file that instantiates the module and hands it the capabilities it
asks for. That bridge is `packages/platform/host/` — not the two entry points I counted (359 + 315
lines) but the whole of it: marshalling, the operation table, child processes, scheduling, the
queue, faults, layout, the providers, and the per-runtime halves. **8,521 lines of TypeScript**,
excluding the browser-only files and the tests.

It cannot be shipped as TypeScript in one file without a bundler, which is the thing being removed,
and Node cannot run TypeScript at all without a flag. So `--host deno` and `--host nodejs` need that
bridge as plain JavaScript before `bootstrap.sh` can finish them, and that is a project rather than
a step. Until then the script says so instead of pretending: it builds nothing and names the reason.

**This does not block `--host rust`**, which is complete, nor deleting `compiler/`. It does block
deleting `tools/install.ts`, which is currently the only thing that can build a JS-hosted command.

## Order

1. **The move**: wacboot's history into wac, under `bootstrap/`.
2. **`bootstrap.sh`**, which needs the merged layout to exist.
3. **`wac self install` / `wac self uninstall`**, the task deleted, the circular advice repaired.
4. **`compiler/` deleted**, with the last agreed hashes pinned in the commit.

**This is not the order first written here, and the first one was wrong.** It had `bootstrap.sh`
first, on the claim that it and the install rename were independent of the move. Neither is:

- `bootstrap.sh` builds the ladder from inside a *wac* clone, and the ladder is in wacboot. Written
  before the move it would be written against `../wac` — a layout that is about to stop existing —
  and a script tested against the wrong layout is not tested.
- `wac self install` becomes install-only, with the build half moving to `bootstrap.sh`. Deleting
  `wac task wac:install` before that script exists would leave no way to build the thing at all.

The rename of `uninstall` and the repair of the circular advice really are independent, but they are
small and belong with the rest of step 3 rather than alone in front of it.

**`bootstrap/` is the destination**, matching the script's name. Chosen rather than specified; it
holds the rungs, the assembler, the flattener, the hosts and the ladder's own tests.

---

## Step 4 in progress: what still reaches the reference — 2026-08-28

Step 4 is "delete `compiler/`", and the work is the callers. It started at 36 files and is at 13.
The groups below are what is left, in the order they are being taken.

### Done

**The whole wac lane.** No `_test.wac` compiles or runs anything with the reference any more.

| what | how it ended up |
|---|---|
| `lexcodes_test` | asks wacc's own `lexMessage` table, which is the one a reader's diagnostic comes from |
| `jsxlex_test` | asserts the language directly: those programs lex, and none of them lexes as JSX |
| `emit_test` | keeps its 222-call corpus, loses the value comparison; a call must still compile, type and run |
| `typecheck_test`, `rung3_probe` | the caught/quiet lists were always authored; two grids state their rule; the cast grid reads `spec/spec/casts.md` |
| `corpuscheck_test` | the reference only decorated a failure message and never touched the verdict |
| `projectspec_test` | both halves asserted the same written-down answer, so one comes out |
| `stdspec_test` | its fourth case was about the reference's own refusal message |
| `bootstrap`/`fixpoint`/`selfhost` `emit_test` | repointed to `harness/ladderRun.ts` — the ladder is the second implementation now |
| the site | the playground, the editor, the linter, the bindgen tab, the runner and the bootstrap demo |

**The five deleted rung-3 grids are the real loss.** The operator, slot, reference-cast, unary and
member grids asserted exact agreement across about 3,700 cells in both directions, and a 15×15×15
operator matrix is not something to invent. Positions go too, everywhere: a diagnostic that drifts
to the wrong line now passes where it used to fail.

**Two things were gained rather than lost**, both because the spec is a better oracle than a second
implementation:

- `spec/spec/casts.md`'s lossless table said **"Complete"** and gave 4 of 12 rows. Four were written
  in a later section and four — `bool` to `i64`, `u64`, `f32`, `f64` — were documented nowhere at
  all while compiling fine. `[§wac-lossless-unsigned-4qmt8xv]`.
- The spec's `// error:` fences had nothing checking them once `wacSpec.test.ts` went, so
  `specfences_test` checks them now: 11 whole programs the document says are rejected.

### The last agreement with the reference — pinned 2026-08-28, on `1ea52134`

The plan asks the removal commit to record what the two sides last agreed on, because the ability
to re-run it does not survive the deletion. Measured by bootstrap/ts/same_fixed_point.ts:

```
W0  wacc by wac-L5            696,682 bytes
X0  wacc by the reference     933,140 bytes
W1  wacc by W0                742,828 bytes
X1  wacc by X0                742,828 bytes

W1 == W2  (the ladder is at its fixed point)      true
X1 == X2  (the reference is at its fixed point)   true
W1 == X1  (the two fixed points are the same)     true

sha256  3817847b3d99b79dd98c68666a80524d6d4dc39568a3e6dc122e23840960fceb
```

`W0` and `X0` differ and must — they are wacc's source compiled by two entirely different
compilers. That they converge on one `wacc.wasm` after a single further round is the claim, and it
is the whole of what the reference was still for.

### Done — 2026-08-28

`compiler/` is deleted: 32 files, 35,352 lines, with bootstrap/ts/same_fixed_point.ts and its
test. `deno.json` has no `imports` block, because the `wac/` mapping was the only entry in it.

**The from-nothing path is verified rather than assumed.** `bash tools/seed.sh --bootstrap` builds
wacc from source through the ladder and reaches its fixed point at 1,814,475 bytes — that is the
first command in a fresh checkout, and it is what the reference used to do.

What broke on deletion and what it became:

| what | why it pointed there | now |
|---|---|---|
| tools/wac/referencecallers_test.wac | it policed which files could reach the reference | deleted with the thing it policed |
| tools/genCore.ts | generated `core`'s declarations into *both* compilers so they could not drift | one output, and ported to `tools/wac/gencore.wac` on 2026-08-30 |
| tools/wac/genCore_test.wac | asserted the omission that made two embeddings worth having | that difference has nowhere to be; renamed `tools/wac/gencore_test.wac` |
| `selfhostemit_test`'s cache key | walked `compiler/` to date stage A | walks `bootstrap/`; it had gone quiet and the test just got slower |
| `site/tools/site.test.ts` | measured `compiler/`'s line count against the front page | measures wacc |
| the front page | "the seed — building wacc is the only job it has left" | wac is self-hosted and there is no seed |
| `links_test`'s roots | listed `compiler/` | lists `bootstrap/`, and immediately found two stale paths there |
| `CLAUDE.md`, `README.md`, `CONTRIBUTING.md` | the layout, the bootstrap escape hatch, and an entire methodology for a deleted directory | rewritten |

189 backticked paths across 113 files, and seven markdown links, named files that no longer exist.
Unbackticked rather than deleted: the sentences are about history and are still true, they had just
stopped naming a path.

### What the rest turned into

Every tool that reached the reference asks wacc now, and repointing them was not busywork — three
found bugs on the day they were pointed at the compiler that ships:

- **`tools/fuzz.ts`** → `issues/lang/0281b`: `as~` to `i32` wraps instead of clamping when its
  operand is a constant. Two of the first forty programs.
- **`tools/fuzzBoundary.ts`** → `issues/lang/0282b`: wacc's bindgen emits neither `>>> 0` nor
  `BigInt.asUintN`, so every `u32`/`u64` above the signed range reaches JavaScript negative. The
  spec states the rule; the reference implements it; this is `issues/lang/closed/0039` reappearing
  in the implementation nothing was checking.
- **`tools/mutate`** → the mutation generator had been placing mutations from a mis-lexed token
  stream on every file containing a lambda, because the reference lexes `=>` as `=` and `>`.

`harness/wacBind`, `wacCoverage` and `wacTestRun` each had an environment variable selecting the
reference, with wacc already the default; all three are gone, and so is the second copy of the
bootstrap that `wacBind` carried. `harness/wacFiles.ts` asks wacc for the resolution rules — which
needed four of them exposed on `api.wac`, a real gap — but **not** for the import scan, because
`files_oracle.ts` is the oracle for `files.wac`'s own walk and would otherwise compare wacc with
wacc and pass forever.

### Found and fixed on the way

`wac test A B` ran only `A` and reported success over it; `wac check ok.wac broken.wac` printed "no
diagnostics" and exited 0 without opening the second file. `build` and `audit` too. Extra paths are
refused now — `run` and `bindgen` keep theirs, which mean something.

### Left

| group | files | the question |
|---|---|---|
| the import walk | `harness/wacFiles.ts` | `bootstrap/js/flatten.js` does the same walk in JavaScript and is load-bearing for the bootstrap, so it cannot drift unnoticed. |
| the spec corpus | packages/wacc/tools/specCases.ts | extracts the spec's own programs with the reference's answers, which is what makes them an oracle — `issues/lang/0105`. |
| the wapy printer | `packages/wacc/test/wac/wapyroundtrip_test.wac` | renders wac to wapy so wacc can read it back. The one thing the reference has and wacc has not. |
| the tools | `tools/fuzz.ts`, `tools/fuzzBoundary.ts` | the fuzzer is repointed; `fuzzBoundary` fuzzes the reference's *own* bindgen, which is a different question. |
| mutation | `tools/mutate.ts`, `tools/mutate/operators.ts` | needs **tokens**, and deliberately not a regex. Agreed: a wac program, not a subcommand. |
| the sanctioned one | bootstrap/ts/same_fixed_point.ts | the `W1 == X1` comparison. It exists to compare against the reference and is the evidence for deleting it. Goes in the final commit. |

### Found on the way, and fixed

`wac test A B` ran only `A` and reported success over it; `wac check ok.wac broken.wac` printed "no
diagnostics" and exited 0 without opening the second file. `build` and `audit` too. A caller passing
a list got a green run covering a fraction of it, which reads exactly like a real one. Extra paths
are refused now. `run` and `bindgen` are untouched — their trailing positionals mean something.
