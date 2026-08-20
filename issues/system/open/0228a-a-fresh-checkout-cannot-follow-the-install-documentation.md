# 0228a — a fresh checkout cannot follow the install documentation to the end

- **Status:** open — the cargo half is fixed (2026-08-20); four items remain
- **Claimed by:** (nobody yet — add yourself before working it)
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
