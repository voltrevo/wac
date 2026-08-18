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

**The seed is source and stays source**, which is what makes rule 2 permanent rather than a stage.
No `.wasm` is checked in — `git ls-files "*.wasm"` finds nothing — so a cold checkout has no route
to a working `wacc` except through this compiler. That is the arrangement, not an interim before
somebody commits a binary: `native/src/main.rs` can embed a `seed/wacc.wasm` under `cfg(wac_seed)`,
but it *builds* one, and the repository ships none.

So the rule above has no expiry date, and it cuts both ways. **A feature wacc's own sources come to
need is a feature this compiler acquires** — that is not a favour to the reference, it is what keeps
the checkout able to build itself. The table below is therefore also the list of things wacc's
sources may not use, however much wacc itself supports them.

## The shared subset, and the omissions

There are **seven omissions**, and this table is where they are written down — a reader has to be
able to tell "the reference disagrees" (a defect, still the fastest signal this project has) from
"the reference does not have that" (deliberate).

It said *one* until 2026-08-12, when the table had seven rows. That is the drift this table exists to
prevent, arriving in the sentence above it: five JSX rows, the bit methods and an omitted nullable
field all landed after the count was written, and each was added correctly to the table by whoever
landed it. **A count beside a list is a second copy of the list**, and it goes stale the way every
second copy does.

| feature | reference | wacc | notes |
|---|---|---|---|
| `Node` and `Attr` in `core` | no | yes | the tree JSX builds. `design/lang/0004`, `spec/cases/0120`; the omission is `core/jsx.wac` not being in this compiler's list in `tools/genCore.ts` |
| JSX expressions | no | yes | `<p>hello <b>{kid}</b></p>` builds that tree, text and all. `spec/cases/0121`–`0124` |
| JSX text as text | no | yes | a lexer mode, so `it's here` between tags is text. `spec/cases/0130` |
| JSX components | no | yes | a tag naming a struct is `Card { … }.render(kids)`. `design/lang/0005`, `spec/cases/0131`–`0134` |
| JSX fragments | no | yes | `<>…</>` is `Node.Fragment(kids)`; `core`'s tree has the variant. `design/lang/0006`, `spec/cases/0135` |
| an integer's five bit methods | no | yes | `x.leadingZeros()`, `.rotateLeft(n)` and three more — ten MVP opcodes with no other spelling. `issues/lang/0069`, `spec/cases/0139` |
| an omitted nullable field | no | yes | `P { … }` may leave out a `T?` field, which is then null — the first divergence outside JSX. `design/lang/0007`, `spec/cases/0136` |

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

Stripped is still **a compiler that runs**, not a binary that is trusted. The smallest this can get
is the subset that builds wacc's sources; it does not get to zero, because something has to turn
text into the first module and this is the only thing that does.
