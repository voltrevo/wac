# 0103 — `app:build` has no way to use wacc, so every built program is the reference's

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-11, rewritten twice on 2026-08-12
- **Kind:** missing feature
- **Symptom:** not implemented
- **The direction:** [`design/lang/0003`](../../../design/lang/0003-the-spec-targets-wacc-and-the-reference-becomes-a-seed.md),
  whose state of play calls this *toolchain off the reference* — the third of its five steps. The
  argument for it lives there; this is the actionable part.

## What is actually missing

**Narrowed twice, and this is what is left.** Binding is wacc by default now, and
`issues/lang/0105` tracks the five tools that still call `wacCompile` directly. Neither covers
`packages/platform/build.ts`, which is the one that ships:

    packages/platform/build.ts:16   import { wacCompile } from "wac/wacCompile.ts";

`deno task app:build` goes through it, so **every browser demo on the website and every built program
is the reference's output**, and there is no environment variable that changes it — `WAC_WASM_FROM`
and `WAC_BIND_FROM` reach `harness/wacBind.ts` and not this. A program using a wacc-only feature
cannot be built at all, which is the thing that starts to bite the moment JSX lands.

## What "done" would mean

1. **`build.ts` can use wacc**, by the same flag as the harness so there is one spelling.
2. **A built artefact records which compiler produced it**, or the next person debugging a demo page
   cannot tell what built it.
3. **The bootstrap keeps working** — the reference compiling `packages/wacc/src` is the job it must
   not lose, and `design/lang/0003` makes that a rule.

The oracle is the one that exists: the demo pages, rebuilt, and the site's own suite.

## Notes

**`issues/lang/0105` cites this issue as "blocked by 0103 — the glue is TypeScript".** That was this
issue's first version and it was wrong; wacc's bindgen exists and binds 34 of 34. Whatever blocks
`site/src/snippets.ts` is worth re-deciding rather than inheriting from a sentence that has been
retracted.

**This issue was wrong when first filed, and the error is worth leaving legible.** It claimed wacc
emitted no JavaScript bindings and that "the swap has never happened" — both false at the time, from
a checkout that already contained `WAC_BIND_FROM`. I had read `harness/wacBind.ts` that session and
corrected a stale comment sitting directly above the function that does it, then watched the file
auto-merge and checked only that my edit had survived — verifying the text was still present rather
than still true.
