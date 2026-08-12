# compiler — the reference, and what it is for now

The wac compiler in TypeScript: lexer to WasmGC emitter, no dependencies. It was the compiler. As of
2026-08-12 it is **the seed**: its job is to produce the first `wacc.wasm` from a cold checkout, and
the specification describes [`packages/wacc`](../packages/wacc) instead. The decision and its reasons
are [design/lang/0003](../design/lang/0003-the-spec-targets-wacc-and-the-reference-becomes-a-seed.md);
[CONTRIBUTING.md](../CONTRIBUTING.md) still governs how the code here is written.

## When this compiler changes

Two reasons, and no others:

1. **A large correctness fix.** While the two overlap, this one is the second opinion — the
   differential compares them token for token, node for node, diagnostic for diagnostic and answer
   for answer, and a wrong reference makes that instrument lie. Five real defects were found that way
   on 2026-08-11 alone, in both directions.
2. **A feature `packages/wacc/src/**` needs.** Those sources have to keep compiling *here*, because
   that is what produces the seed. That constraint runs the other way too, and is the one rule to
   remember when working in wacc: **wacc's own sources may use only what this compiler implements.**

Everything else — JSX first — lands in wacc alone.

## The shared subset, and the omissions

There is **one omission**, and this table is where it is written down — a reader has to be able to
tell "the reference disagrees" (a defect, still the fastest signal this project has) from "the
reference does not have that" (deliberate).

| feature | reference | wacc | notes |
|---|---|---|---|
| `Node` and `Attr` in `core` | no | yes | the tree JSX builds. `design/lang/0004`, `spec/cases/0120` |
| JSX expressions | no | yes | `<div class="a">{kid}</div>` builds that tree. `spec/cases/0121`–`0123` |

The rest of the language is shared, and the differential covers all of it.

Two mechanisms keep this honest rather than aspirational:

- **`// only: wacc`** in a `spec/cases` header takes a case off the reference's runner, which prints
  how many it was not asked — so the subset shrinking is visible on every run rather than inferred
  from a table somebody forgot.
- **The harness compiles `packages/wacc/src/api.wac` with this compiler on every suite run**, so a
  wacc-only feature used inside wacc's own sources goes red the same day rather than at the next cold
  bootstrap.

## What "stripped to the seed" would mean

The end state in design/lang/0003 is this compiler reduced to what compiles `packages/wacc/src/**`
and nothing more. That is measurable — it is a subset defined by a corpus of ten files — but it is
not urgent, and doing it early would cost the second opinion above while the two still overlap almost
entirely. The order there puts it last for that reason.
