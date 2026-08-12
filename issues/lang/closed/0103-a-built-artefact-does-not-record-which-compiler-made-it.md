# 0103 — a built artefact does not record which compiler made it

- **Status:** closed, 2026-08-12 by agent-b
- **Fixed in:** a9917736 (criteria 1 and 3) and 58dbbb5b (criterion 2)
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-11, rewritten twice on 2026-08-12, narrowed again 2026-08-12
- **Kind:** missing feature
- **Symptom:** not implemented

## Closed 2026-08-12: the marker landed

Both compilers now write the standard `producers` custom section — `processed-by wacc` and
`processed-by wac-reference` — so a module says which one made it, and `wasm-objdump` reads it
without being taught anything. **Both, and different**, which is the property that matters: a marker
on one compiler only would make absence mean "the other one", when absence also means "built before
this landed". `packages/platform/test/producer.test.ts` builds the same program under both settings
of `WAC_APP_FROM` and reads the marker back.

The third spelling noted below (`WAC_APP_FROM` beside `WAC_WASM_FROM` and `WAC_BIND_FROM`) is still
three spellings, and still deliberate: they select different stages.

## Narrowed a third time: two of the three criteria below are now met

`a9917736` landed `WAC_APP_FROM` in `packages/platform/build.ts`. `deno task app:build` compiles
with wacc unless that says `reference`, so criterion 1 is done and criterion 3 holds — the seed
still builds wacc, which is why the flag stays. Verified by building `packages/box/src/box.wac`
both ways: both run, and `wc` and `sha256sum` give identical output.

**Criterion 2 is what is left, and it is unmet.** Nothing in either artefact says which compiler
produced it. Both binaries were searched for a marker and the only string matching `wacc` is
identical in the two of them — so the answer to "what built this demo page" is still "whatever the
environment was when someone ran the command", which is the thing this criterion existed to stop.
That matters more now than when it was written, because the default changed underneath: a page
built before the flip and one built after are indistinguishable, and `issues/lang/0107` records a
21% size difference between them that someone will eventually try to explain from the artefact.

The flag is also a third spelling — `WAC_APP_FROM` beside `WAC_WASM_FROM` and `WAC_BIND_FROM` —
where criterion 1 asked for one. That is a smaller thing and may well be the right answer, since
the three select different stages; noted rather than reopened.
- **The direction:** [`design/lang/0003`](../../../design/lang/0003-the-spec-targets-wacc-and-the-reference-becomes-a-seed.md),
  whose state of play calls this *toolchain off the reference* — the third of its five steps. The
  argument for it lives there; this is the actionable part.

## What was missing, and what happened to it

**This section is kept because it is what the issue was for, and it has been answered.** It read:
`packages/platform/build.ts` is the one that ships, `deno task app:build` goes through it, so every
browser demo and every built program is the reference's output, with no environment variable that
changes it — `WAC_WASM_FROM` and `WAC_BIND_FROM` reach `harness/wacBind.ts` and not this.

That is fixed. `build.ts` now checks `WAC_APP_FROM` in three places, and the import at line 16 that
this issue quoted is still there because the reference is still reachable *by choice*, which was
always the intent. What is left is only the marker, above.

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
