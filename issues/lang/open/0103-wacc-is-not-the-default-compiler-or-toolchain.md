# 0103 — wacc is not the default compiler or toolchain

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

Not the capability. Both halves already swap, opt-in and separately:

- `WAC_WASM_FROM=wacc` — the code is wacc's, the interface metadata the reference's.
- `WAC_BIND_FROM=wacc` — the description and the generator are wacc's too.

Set both and the reference is not in the room; `packages/wacc/README.md` records 34 of 34 packages
under each, and `packages/url`'s 27 tests pass that way on a spot check.

**What is missing is the default**, and one path with no flag at all:

- `harness/wacBind.ts` defaults both to `"reference"`.
- `packages/platform/build.ts` imports `wacCompile` from `wac/wacCompile.ts` directly. So every
  `deno task app:build` — every browser demo on the website — is the reference's output, and there is
  no environment variable that changes it.

## What "done" would mean

1. **`build.ts` can use wacc at all.** It has no equivalent of `WAC_WASM_FROM`, and the demo pages
   are the most visible thing this changes.
2. **The defaults invert**, with the reference reachable by flag rather than by default.
3. **The bootstrap keeps working.** The reference compiling `packages/wacc/src` is the one job it
   must not lose — `design/lang/0003` makes that a rule, and the fixpoint test rests on it.
4. **Something records which compiler produced an artefact**, or the next person debugging a demo
   page cannot tell what built it.

Each step has the oracle that already exists: every package's own suite, run with the flags set.
That is what makes this a sequence rather than a flag day.

## Notes

**This issue was wrong when first filed, and the error is worth leaving legible.** It claimed wacc
emitted no JavaScript bindings and that "the swap has never happened" — both false at the time, from
a checkout that already contained `WAC_BIND_FROM`. I had read `harness/wacBind.ts` that session and
corrected a stale comment sitting directly above the function that does it, then watched the file
auto-merge and checked only that my edit had survived — verifying the text was still present rather
than still true.
