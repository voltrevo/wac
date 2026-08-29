# 0146 — a script under `site/` cannot use the `wac/` import map, so the wacc asset was never built

- **Status:** open — the deploy step is fixed and a bad asset is now refused; the root cause is a decision
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-13
- **Kind:** build
- **Symptom:** compile error

`site/tools/syncWacc.ts` writes `site/public/wacc-api.js`, the file that lets the playground compile
with wacc instead of the reference. Run as the deploy workflow ran it, it fails:

```
$ deno run -A site/tools/syncWacc.ts
error: Import "wac/wacLex.ts" not a dependency
    at file:///…/harness/wacFiles.ts:14:24
```

**`site/package.json` puts that subtree in an npm resolution scope**, so the bare `wac/` specifier —
mapped to `./compiler/` in the root `deno.json` — is looked up as an npm package instead. Hence
*"not a dependency"* rather than *"not found"*, which is the message that identifies it.

Isolated rather than inferred. The same import, in a two-line script:

```
$ deno run -A probe.ts               # at the repo root
imported from repo root: ok function

$ deno run -A site/tools/probe.ts    # identical, moved under site/
error: Import "wac/wacLex.ts" not a dependency
```

`site/tools/syncMap.ts` and `syncDemos.ts` both run clean, because neither reaches a module that
uses the bare specifier. `syncWacc.ts` is the only one that does, which is why this went unnoticed.

## What it cost

The deploy built no `wacc-api.js`, and `site/src/editor/wac-compile.ts` is written to fall back to
the reference when the asset is absent — deliberately, so a plain checkout still works. So the
published playground silently used the reference compiler, which is the exact thing `2c9dd3d3` was
written to stop. A fallback that is correct for a checkout is a silent wrong answer for a deploy.

Locally, `deno run -A --import-map deno.json site/tools/syncWacc.ts` succeeds and writes 447 KB.
`.github/workflows/pages.yml` carries that flag now, with the reason beside it.

**What is not verified:** the workflow itself. The command it ran fails here on this Deno and the
flag fixes it here; nobody has watched a deploy. If CI's Deno resolved it some other way then the
step was passing and the asset was being built, and this issue is only about the local trap.

## What "done" would mean

1. A decision on the root cause rather than the call site. `harness/wacFiles.ts` uses the bare
   specifier on purpose — `packages/wacc/test/corpus.ts` records that the relative form broke every
   mutation run, since `tools/mutate.ts` stages the tree into a temp directory — so switching it to
   `../compiler/` is not obviously right and may just move the breakage.
2. ~~Something that fails loudly when the asset is missing at *deploy* time~~ — **done,
   2026-08-13**, though not where this expected. The loud half already existed: a script that throws
   fails its workflow step. What was unguarded is the *quiet* half — an asset written successfully
   that the page cannot use, which falls back exactly as a missing one does. `syncWacc.ts` now
   refuses to write unless the glue names the five entry points `WaccModule` calls **and** is large
   enough to hold the module, because a size floor alone passes an asset with every function renamed
   and a name check alone passes one with no compiler in it. Checked before the write, so a bad build
   leaves a working asset alone. `site/tools/site.test.ts` drives both halves.

   What this still does not do is notice a deploy that *skipped* the step. That is a property of the
   workflow rather than of the script, and it is bundled with (1).
3. ~~One sentence about scripts under `site/` and bare specifiers~~ — **done**, in the root
   `CLAUDE.md` beside the paragraph about the site's other two flags, because `site/README.md` does
   not exist and a lone file for one sentence is worth less than putting it where the neighbouring
   fact already is.

## The root cause is gone, and item 1 has nothing left to decide — agent-b, 2026-08-29

Item 1 asks for a decision about `harness/wacFiles.ts` using the bare `wac/` specifier on purpose.
Three things have happened since:

- **`harness/wacFiles.ts` no longer uses it.** Its imports are relative — `./waccBuild.ts`.
- **The alias itself is gone.** `deno.json`'s `imports` is now `{}`, and `compiler/`, which `wac/`
  mapped to, was deleted with the TypeScript reference on 2026-08-28.
- **So the failure now reproduces everywhere rather than only under `site/`**, which is the clearest
  possible evidence that the mapping is not there to be shadowed:

      $ deno eval 'console.log(import.meta.resolve("wac/"))'
      TypeError: Import "wac/" not a dependency

  the same sentence this issue was filed about, from the repository root.

**One orphan is left over, and deleting it costs more than it looks.** `packages/wacc/test/corpus.ts`
still resolves through the alias at line 26 and would fail at runtime the moment anything ran it.
Nothing does: no task, no workflow, no importer — `packages/wacc/test/wac/corpus_probe.wac` replaced
it and says so on its first line.

I removed it, and `tools/wac/links_test.wac` refused: **seven** places cite that path in backticks,
including `design/lang/0009`, `packages/wacc/src/path.wac` and `tools/siblingpath.test.ts`, which
also builds the path as a value. So it is dead as *code* and alive as a *landmark*, and the deletion
is seven edits to documents that are mostly historical record. It is restored, and that trade belongs
with whoever closes this rather than to a passing tidy-up. Its reasoning is quoted here so the
argument survives either way:

> The relative form was `../../../../wac/spec/tour.wac` from this file, which is right in a real
> side-by-side checkout and wrong everywhere else — and "everywhere else" turned out to include every
> mutation run. `tools/mutate.ts` stages `packages` and `harness` into a temp directory and rewrites
> the `wac/` alias to an absolute path, so the compiler resolves and the sibling checkout does not.
> The corpus therefore lost its richest file in exactly the runs that decide whether a test is worth
> anything, and said so only in the output of a *passing* test, which nobody reads: `startsLower` was
> reported as surviving for weeks while the real suite killed it.

That hazard is still real and still worth knowing — a corpus that quietly loses its richest file
reports a passing test — but it is now a fact about `tools/mutate.ts` and relative paths, not an
argument for an alias that no longer exists.

**Closing this is `agent-c`'s**, since the remaining item is theirs and I have only removed its
subject.

