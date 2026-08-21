# 0228a — a fresh checkout cannot follow the install documentation to the end

- **Status:** closed
- **Fixed in:** this commit
- **Closed by:** agent-a, 2026-08-20
- **Reported by:** voltrevo, as GitHub issue 21; transcribed and verified by agent-a
- **Date:** 2026-08-20
- **Kind:** bug
- **Symptom:** no error — the documented path stops without saying why

## Where this came from

An outsider followed `docs/your-own-project.md` from a fresh clone, on Linux x86-64 with Deno 2.9.5,
Node 24.19.0 and **no cargo installed**, at wac commit `416cef2e`. Filed upstream as GitHub issue 21.
Tracked here because that is where work happens; GitHub is not the source of truth.

Their summary is the part worth keeping in front of anyone working on this:

> Once reached, the compiler itself was the least troublesome part: fast compilation, simple syntax, a
> 4 KB standalone pure module, and an ordinary callable main. The main problems were all in getting
> from a fresh checkout to the documented `wac` command.

So none of this is about the language. All of it is about the first twenty minutes.

## Verified here, item by item

### 1. Cargo was required and undocumented — **fixed**

`docs/your-own-project.md` said *"it needs a checkout of this repository and Deno"*. It needs cargo
too: the seed is a wasm module the `wac` binary carries, so building it means building the binary, and
`native/v8` is Rust.

### 2. The failure was silent — **fixed**

Both cargo call sites in `tools/seed.sh` were

```sh
(cd native/v8 && cargo build --release >/dev/null 2>&1)
```

`set -euo pipefail` acted on the status and the message went to `/dev/null`, so a missing cargo aborted
the script after about six seconds with nothing said at all — which the reporter read as a hang. That
is exactly right: there is no output to read it as anything else.

`tools/seed.sh` now checks `command -v cargo` **before doing any work** and says which program is
missing and that nothing has been changed; and `cargoBuild` shows the last 25 lines of a failed build,
saying that the seed module is installed while the binary beside it is not rebuilt from it. Canaried
three ways: cargo absent, cargo present with a deliberate type error in `main.rs`, and an ordinary run.

*Worth recording as a near miss.* Earlier the same day I gave `tools/seed.sh` a `buildRound` that
checks the status of the **wacc** build and restores the previous seed when it fails. The cargo build
two lines away kept discarding both its status message and its output. One of two sibling build steps
fixed, the other left — and it took an outsider to find the one I had just been reading.

### 3. `deno task seed:bootstrap` prefetches npm packages — **open**

Reported: before bootstrap completed, Deno downloaded Playwright, ethers, JSON5, Binaryen, `ws` and
type packages, many unrelated to compiling anything, and on an unreliable connection this stopped the
bootstrap. `bash tools/seed.sh --bootstrap` directly did not.

Not diagnosed here. The task itself is only `bash tools/seed.sh --bootstrap`, so the fetching is
`deno task`'s and not the script's — a starting point is that `npm:` specifiers are reachable from
`harness/wacFiles.ts` (json5), `tools/wasmopt.ts` (binaryen, ethers) and several `*live*.test.ts`
(playwright), and that Deno 2 installs from a `package.json` it finds. `site/` is the only npm subtree.

**This is the item to take first.** It is the one that can stop a bootstrap outright, it costs
bandwidth on every fresh clone, and the fix is plausibly a task that does not go through `deno`.

### 4. The Deno-hosted fallback assumes the repository is the working directory — **open**

The reporter used `compiler/` directly after the install failed, and the driver assumed the wac
checkout was `cwd`. Since that fallback is what somebody reaches for *when the documented path has
failed*, it is worth either supporting or documenting as unsupported — see item 6.

### 5. `@/` imports failed from an external project — **open**

`import { … } from "@/src/stats.wac"` answered **"an import of a file that was not supplied"**.

That message is `linkFailure`'s in `packages/wacc/src/emit.wac`, and `issues/lang/0157` records what is
wrong with it: it carries no position and no file name, and it is one of two causes inferred from a
sentinel. So an outsider hitting a project-root resolution problem is told something true and unusable.
Whether `@/` genuinely fails outside this repository or resolved to the wrong root is not established
here; that is the first thing to find out.

### 6. Raw diagnostics carried TypeScript stack traces — **open**

Core diagnostics were clear and were followed by full exception stacks. The reference compiler is a
Deno program, so this is the fallback path showing its host.

### 7. Binaryen was fetched for a Deno build without `--optimize` — **open**

Bundling eagerly resolved the optional optimisation import. Same family as item 3 and probably the same
fix: an optional dependency that is resolved unconditionally is not optional.

## Their suggested priority, unchanged

1. Check for Cargo and document it as a prerequisite — **done**
2. Do not suppress the actionable Cargo failure message — **done**
3. Prevent `seed:bootstrap` from prefetching unrelated npm dependencies
4. Add a lightweight bootstrap phase / progress output
5. Optionally provide a documented Deno-only developer fallback

4 is not filed as an item above because it is a judgement about output rather than a defect: a
bootstrap that says which of its stages it is in would have made items 2 and 3 self-describing.

## All seven fixed — agent-a, 2026-08-20

Each verified from an external project in a directory outside this repository, with a `wac.json5`, a
`@/src/stats.wac` import, and a `main.wac` whose `f()` answers 4. Both compilers now build it and both
answer 4.

### 3. The npm prefetch — it is `deno.lock`, and it is twelve packages

Reproduced with a fresh `DENO_DIR`: running **any** `deno task` — even `map --check`, which only runs
the binary — fetches **12 npm packages**: `binaryen`, `ethers`, `playwright`, `json5`, `@types`,
`aes-js`, `@noble`, `@adraffy` and more. `deno task` restores the root `deno.lock` before running
anything, and that lockfile carries every npm dependency in the tree — including *two* Binaryen
versions, which is why the report says "Binaryen versions" in the plural.

Neither documented step needs any of it: `tools/install.ts` has **zero** npm in its import graph and
type-checks with an empty cache. `deno task --no-lock` fetches nothing and still works; `bash
tools/seed.sh --bootstrap` never involves Deno's resolver at all. `docs/your-own-project.md` documents
both forms and says why. The lockfile itself is left alone — pruning it is a separate decision, and the
tasks are correct as they stand for anyone with a warm cache.

### 4. The working-directory assumption — four literals

`harness/wacBind.ts` and `harness/waccBuild.ts` named the *compiler's own* sources by relative path —
`packages/wacc/src/api.wac`, `packages/wacc/src`, `packages/wacc/tools` — and `packages/platform/
native.ts` had a fourth as a constant. `harness/programs.ts` already exports a `ROOT` derived from
`import.meta.url`; all four use it now, and the constant is a `new URL(…, import.meta.url)`.

### 5. `@/` from an external project — the same cause as item 4, and I got this wrong first

**Corrected 2026-08-20, later the same day.** This section originally said the project root never
reached wacc, and that threading it was the fix. That was wrong, and the roots machinery it describes
has been removed.

The real cause is item 4. With `WACC_API` still spelled relatively, the Deno-hosted path could not read
the compiler's own `api.wac`, and what came out of *that* was **"an import of a file that was not
supplied"** — a sentence about the user's import, produced by a failure to read the compiler's. One
cause wearing two faces: I fixed the `NotFound`, saw the second message, and attributed it to a
different mechanism. Fixing `WACC_API` fixed both.

**What settled it was a canary that could tell the two apart, and my first one could not.** The test
project had `main.wac` at the project root, so `@/src/stats.wac` and `./src/stats.wac` are the same
path and no amount of root information changes the answer. A second project with the entry in `app/`
— so the two genuinely differ — built with the roots removed; and so did the same project with an
absolute entry from a third directory, where the graph's base is neither the repo nor the project.
Three removals, three successes: the roots were not load-bearing.

So `buildFilesRooted`, `emitFilesCoveredRooted` and `resFor` are gone from `api.wac`, the `roots`
parameter is out of `waccArtifacts`, `native.ts` and `build.ts`, and `tools/benchCompile.ts` is back to
timing what it timed before. What remains of that afternoon is one thing worth keeping, below.

### 5a. `emitFilesCoveredIn` accepted a `Res` and ignored it

Found while chasing the above, and true regardless of it. Its body was **character-for-character**
`emitFilesCovered`'s — `return emitLinkedCovered(paths, sources, entry)`, with the `res` parameter
dropped — under a doc comment reading *"with the project root each file sits in — `design/lang/0009`
D7"*. A documented promise the body did not keep.

`emit.wac` now exports `emitLinkedCoveredIn`, which passes the `Res` to `emitLinkedWith2` — a function
that has taken one all along. Counted across the family: **2 of the 8 `Res`-taking entry points in
`api.wac` ignored theirs.** The other is `diagnoseGraphIn`, whose 39-line body mentions `res` zero
times, so it is identical to `diagnoseGraph`; filed separately as `issues/lang/0175a` because this
issue is closed.

### 6. TypeScript stacks — a compiler reports, it does not throw

`native.ts`'s entry now catches, prints the message, and exits 1. `WAC_STACK=1` restores the stack for
somebody debugging the compiler rather than their program. Before: a missing file printed *nothing but*
a ten-frame stack.

### 7. Binaryen fetched without `--optimize` — a statically analysable dynamic import

`await import("npm:binaryen@131.0.0")` is dynamic, but Deno adds a statically analysable dynamic import
to the module graph and loads it up front — so every build of every target downloaded a wasm optimiser
whether or not it was asked for. Confirmed with a fresh `DENO_DIR` **and** `--no-lock`, so the lockfile
was not the cause. The specifier is assembled from a `BINARYEN_VERSION` constant now, which Deno cannot
resolve ahead of the branch.

Measured, cold cache, `--target deno`:

    without --optimize    npm fetched: @esbuild            (was: @esbuild binaryen)
    with --optimize       npm fetched: @esbuild binaryen   111K, wasm-opt — still works

### Their suggestion 4: progress output

`tools/seed.sh` says which stage it is in, on stderr so stdout stays the one parseable line:

    seed: round 1: compiling wacc with the seed we have
    seed: round 2 of at most 4: compiling wacc with the previous round's wacc
    seed: fixed point reached; building the other two payloads (wac sh, wac update)
    seed: linking the binary (cargo build --release)

### Their suggestion 5: a documented Deno-only fallback

Now that items 4, 5 and 6 are fixed it is a real option, and `docs/your-own-project.md` has it — with
the caveat that it is a developer fallback rather than the supported route.

### One caution for whoever tests installers

`deno task wac:install` edits `~/.bashrc`, `~/.zshrc` and `~/.profile` **even when `WAC_HOME` points at
a temporary directory**. Verifying it end-to-end left three marked lines pointing at a temp path that
was about to be deleted; `wac:uninstall` with the same `WAC_HOME` removes exactly those three. Worth a
thought about whether a `WAC_HOME` outside `$HOME` should touch profiles at all.
