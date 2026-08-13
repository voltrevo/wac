# 0146 — a script under `site/` cannot use the `wac/` import map, so the wacc asset was never built

- **Status:** open — the deploy step is fixed; the trap that caused it is not
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
2. Something that fails loudly when the asset is missing at *deploy* time, as opposed to falling
   back. The fallback is right for a checkout and wrong for a publish, and one flag decides which.
3. Whichever way it goes, one sentence in `site/README.md` about scripts under `site/` and bare
   specifiers, because the next script to reach `harness/` will hit this again.
