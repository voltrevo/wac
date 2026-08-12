# 0103 — wacc is not the default compiler or toolchain

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-11, rewritten 2026-08-12
- **Kind:** missing feature
- **Symptom:** not implemented

**This issue's first version was wrong, and the correction is the useful part.** It said wacc emits
no JavaScript bindings and that "the swap has never happened". Both were false when it was filed:
`WAC_BIND_FROM=wacc` had landed in `harness/wacBind.ts` an hour and a half earlier, in a commit that
was already in my checkout. I read the file, corrected a stale comment in it, and did not notice the
function below that comment. Kept rather than deleted because an issue that was wrong is worth
leaving legible.

## What is actually true

Both halves swap, and each is opt-in and separate:

- `WAC_WASM_FROM=wacc` — the **code** is wacc's, the interface metadata the reference's.
- `WAC_BIND_FROM=wacc` — the **description and the generator** are wacc's too:
  `exportSigsFiles`, `bindTypesFiles`, and `packages/wacc/tools/waccBindgen.ts`.

Set both and the reference is not in the room. `packages/wacc/README.md` records 34 of 34 packages
passing under each, and it holds on a spot check: `packages/url`'s 27 tests pass with both flags set.

Two flags rather than one on purpose — when it breaks, whether the bytes or the description was at
fault is the first thing you want to know.

## What is missing

**The default.** Every path that is not opted in still reaches for the reference:

- `harness/wacBind.ts` defaults both to `"reference"`.
- `packages/platform/build.ts` imports `wacCompile` from `wac/wacCompile.ts` directly, so
  `deno task app:build` — every browser demo, every built program — is the reference's output. There
  is no flag on that path at all.

So "wacc is the toolchain" is true of what the suite *can* do and false of what anything does by
default.

## What "done" would mean

Not one switch. At least:

1. **`build.ts` can use wacc at all** — it has no equivalent of `WAC_WASM_FROM` today, and the demo
   pages are the most visible thing this would change.
2. **The defaults invert**, with the reference reachable by flag rather than by default.
3. **The bootstrap keeps working**, because the reference compiling wacc is the one job it must not
   lose — `design/lang/0002` assumes it, and the fixpoint test is built on it.
4. **Something states which compiler produced a given artefact**, or the next person debugging a
   demo page cannot tell what compiled it.

The oracle for each step is the one that already exists: every package's own suite, run with the
flags set, which is what makes this a sequence of measurable steps rather than a flag day.

## Notes

The reference is bootstrap-bound by instruction, so this is not "port more features" — it is moving
the default across a line the suite says has already been crossed.
