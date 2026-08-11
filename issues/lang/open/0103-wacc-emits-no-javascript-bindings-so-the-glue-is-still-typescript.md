# 0103 — wacc emits no JavaScript bindings, so the glue is still TypeScript beside it

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-11
- **Kind:** missing feature
- **Symptom:** not implemented

**wacc only. The reference is not to grow this** — it is moving toward bootstrap-only, and a second
implementation of something already written once there is the wrong direction.

## What exists today, so nobody re-discovers it

`waccx bindgen` works, and this is not a request for it. The split is:

- **the compiler answers what it alone knows** — `exportSigsFiles`, `bindTypesLinked` in
  `packages/wacc/src/api.wac`. Which functions are exported, what they take and return, which named
  struct and enum types cross, which callbacks go each way.
- **turning that into text is TypeScript** — `packages/wacc/tools/waccBindgen.ts`, 443 lines, beside
  `waccx`. Its own header explains the split as "turning that into text is text".

Its coverage is wider than that header says: `supported()` admits scalars, `string`, the bulk arrays,
named types, and callbacks in *and* out. What it declines is a funcref nested inside another
signature — a callback that itself takes one — because the dispatcher would have to hand JavaScript a
WasmGC reference, which JavaScript cannot hold. The reference's `wacBindgen.ts` is 1,011 lines and
covers everything.

## What is missing

**wacc cannot produce the glue itself.** A wacc built for any host still needs a TypeScript file from
this repository beside it to be callable from JavaScript, so the toolchain is not self-contained and
the *emitter* is the only half that is.

Two consequences, and the second is the one that matters:

- `deno task app:build --target browser` and every page demo route through the reference's bindgen.
  A wac program compiled by wacc cannot be put in a page without the reference in the path.
- **The swap has never happened.** `harness/wacBind.ts` takes wacc's *code* and keeps the
  reference's interface metadata — deliberately, so what the suite measures is the emitter and
  nothing else. So a green run says wacc's code is right, not that it could have produced the
  bindings. The website states this as the thing standing between wacc and being the compiler of
  record, and it is still true.

## What "done" would mean

`waccx bindgen` writing the same glue with no TypeScript in the path, and then
`harness/wacBind.ts` gaining a mode that uses wacc's bindings *as well as* its code — the existing
mode kept, because the two answer different questions and losing the narrower one would make a
regression in the emitter indistinguishable from a regression in the bindgen.

The oracle is direct and already sitting there: the reference's `wacBindgen.ts` emits glue for the
same module, so the two outputs can be compared, and the tests each package already has can be run
against a module bound by wacc's glue. Byte-identical output is *not* the bar — the two need not
agree on formatting — but "every package's own suite passes against wacc's bindings" is exactly the
bar the emitter half already meets, and it is measurable the day the first signature crosses.

## Notes

Worth deciding early, because it shapes the work: whether the generator lives in wac inside
`packages/wacc/src` (self-contained, and it is string building, which wac does), or stays a tool and
merely stops being the reference's. The first is what makes the toolchain need nothing from here; the
second is a smaller change that fixes neither consequence above.

There is a second reason to want this now, and it is a direction rather than a document yet: markup
syntax for authoring web applications in wac is under discussion. If anything like it lands, the glue
between a wac module and a page stops being an occasional convenience and becomes the thing every
application in the language stands on — and it would be built on whichever bindgen is the real one.
