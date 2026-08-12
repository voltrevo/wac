# 0003 — the spec targets wacc, and the reference becomes a seed

- **Status:** active
- **Opened:** 2026-08-12
- **Written by:** agent-b, from a decision with the operator

## The decision

**The specification describes wacc.** New language features — JSX syntax is the first named one — are
built in `packages/wacc` and not in `compiler/`. The reference compiler becomes a **subset with
stated omissions**, kept for one job: producing the first `wacc.wasm` from a cold checkout.

The reference still changes, for two reasons and no others:

1. a big enough correctness fix that leaving it wrong would mislead whoever reads it as the second
   opinion, while the two still overlap;
2. a feature **wacc's own sources** need, because those sources have to keep compiling with it.

Everything else lands in wacc alone.

## Why this is a real change and not a rename

The differential has been the instrument for every rung of the ladder: tokens compared token for
token, nodes node for node, diagnostics with their positions, answers program for program, and
`tools/mutate` deciding whether a refusal is *correct* by asking the other compiler. All of that is
now valid **only on the shared subset**. A wacc-only feature has no second implementation to disagree
with, so the oracle that has caught most of this year's defects does not reach it.

What reaches it instead:

- **`spec/`, and its `[§wac-…]` tags** — `compiler/wacSpec.test.ts` runs the blocks the spec marks and
  holds the claims true against one compiler, not two. This is why the spec has to be written *first*
  for a new feature rather than describing what already works: for JSX it must say what the syntax
  desugars *to*, because that is the contract there is nothing else to check against.
- **`spec/cases`** — whole programs with their expectation at the top. This was a supplement to the
  differential; it is now the primary instrument for anything the reference does not have.
- **the package suites, on wacc-emitted code** — 34 of 34 with the whole binding from wacc, which is
  behavioural evidence for code that exists rather than for rules.
- **the self-host fixpoint** — still meaningful, and still only says wacc agrees with itself.

## What has to change with it

**1. wacc's own sources are bootstrap-constrained.** `packages/wacc/src/**` may use only what the
reference implements, because the reference is what compiles them into the seed. No JSX in the
compiler's own source — or a two-stage bootstrap, where a seed that already understands the feature
builds the next one, which is what other self-hosting compilers do and is a decision to take
deliberately rather than by accident. The check exists already and is not new work: the harness
compiles `packages/wacc/src/api.wac` with the reference on every suite run, so a violation is red the
same day. What was missing is that anyone had said so.

**2. `spec/cases` needs to say when a case is wacc-only.** `compiler/wacCases.test.ts` asserts *"the
reference meets every one of them"*, on the stated grounds that a case the reference fails is a case
whose expectation is in doubt. That reasoning inverts for a wacc-only feature. The corpus needs a
marker — one more line in the header, beside `expect:` — and a count that goes up on purpose, or the
first JSX case turns the ladder red and collects an ad-hoc exception.

**3. The shared subset has to be written down.** Not as prose that drifts: a list of what both
implement, what is wacc-only, and what the reference keeps solely to build the seed. Without it,
"the reference disagrees" stops meaning anything — and that signal caught five real defects on
2026-08-11 alone, in both directions.

**4. Everything that compiles through the reference has a deadline.** `harness/wacBind.ts`,
`tools/coverage.ts`, `harness/ctTrace.ts`, `site/src/snippets.ts` and the rest call `wacCompile`, and
none of them can compile a file using a wacc-only feature. `WAC_BIND_FROM=wacc` already binds every
package with wacc's own metadata and generator (34 of 34, 1,663 tests), so the switch exists; what is
left is deciding when it becomes the default rather than the opt-in.

**5. A stack trace has to be readable without the reference.** `issues/lang/0101` — wacc emits no name
section, so a trap is `wasm-function[147]`. While both compilers could build everything, a confusing
trace had a fallback: build it with the reference and read that one. For a wacc-only program there is
no such build. This is why the name section comes first.

## The order

1. **The name section** (`issues/lang/0101`) — the debugger for everything after it.
2. **The wacc-only marker** in `spec/cases`, and the shared-subset list, before the first feature
   needs them rather than after.
3. **The toolchain off the reference** — `WAC_BIND_FROM=wacc` as the default, and the tools that call
   `wacCompile` moved or marked as oracles that keep it on purpose.
4. **The unified binary** — wasmtime plus an embedded seed, `wac build` and `wac run`, with the
   criterion that it reproduces its own seed byte for byte.
5. **Strip the reference** to what compiles `packages/wacc/src/**`, with the omissions stated rather
   than discovered.

## State of play

| step | state |
|---|---|
| the name section | not started — `issues/lang/0101` |
| wacc-only marker and the shared-subset list | not started |
| toolchain off the reference | `WAC_BIND_FROM=wacc` exists and is measured at 34 of 34; not the default |
| unified binary | not started; the wasmtime host runs `sh` and sixty applets already |
| reference stripped | not started |
