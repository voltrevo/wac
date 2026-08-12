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
4. **The unified binary** — **on V8, not wasmtime.** `deno compile` of the wac compiler program is a
   single file that compiles wacc's own sources in **1.02s**; the wasmtime binary, with an embedded
   seed and the right collector, takes **3.36s**. Both work and both are one file; the engine is the
   only difference. wasmtime is shelved as the *target* — see below — and stays as a host.
5. **Strip the reference** to what compiles `packages/wacc/src/**`, with the omissions stated rather
   than discovered.

## State of play

| step | state |
|---|---|
| the name section | **done** — imports, the module's own functions and every bind helper, `issues/lang/0101` |
| wacc-only marker and the shared-subset list | **done** — `// only: wacc` in a case header, counted by the reference's runner; the subset is [compiler/README.md](../../compiler/README.md), empty today |
| toolchain off the reference | **binding is wacc by default**; five direct `wacCompile` callers left, two of them deliberate — `issues/lang/0105` |
| unified binary (V8) | `deno compile` of `example/wacc.wac` — one 106 MB file, 1.02s to compile wacc's sources. Nothing new was needed for it |
| unified binary (wasmtime, shelved) | **the compiler already runs on wasmtime with no JavaScript** — `wacland` running `example/wacc.wac` compiles `src/api.wac` to a byte-identical module, in 4.5s against Deno's 1.1s — it was 12.3s until the host stopped taking wasmtime's default collector (`issues/system/0138`). The payload exists: `packages/wacc/example/wacc.wac` is the compiler as a wac program — `check` and `compile`, its own import walk, byte-identical output to the TypeScript CLI including on wacc's own sources. **and the binary exists**: `native/` embeds a seed and dispatches to it, so one file compiles wacc's own sources byte-identically with no JavaScript, in 3.2s. It cannot yet rebuild the seed it carries — `packages/platform/native.ts` writes the manifest with the reference, and a wacc-built module numbers its callbacks differently (`issues/lang/0105`) |
| reference stripped | not started |

## 2026-08-12: wasmtime is shelved as the target, and kept as a host

A decision with the operator, on measurements rather than taste.

`wacc` compiling itself: **1.0s on V8, 3.4s on wasmtime** — and that is *after* fixing the collector
default, which had it at 12.3s (`issues/system/0138`). The residual is unexplained and is allocation
throughput rather than the collector: with collection switched off entirely it does not move.

`deno compile` turns the same wac program into one 106 MB file that runs at the V8 number. So the
single-binary goal does not need wasmtime, and pursuing wasmtime *as the way there* was buying a 3.4x
slowdown for a smaller binary.

**Shelved as a target, not deleted as a host.** design/system/0001 makes four hosts a portability
requirement, and wasmtime is the only one with no JavaScript in it — its value is being the outside
opinion, since agreement between browser, Deno and Node is weak evidence that the interface is
portable. `native/` keeps its tests, keeps its seed support, and keeps being built; nobody should
spend time making it fast unless the 106 MB starts to hurt.

**What "V8 directly" could still mean.** Embedding V8 through `rusty_v8` would give a Rust host with
no JavaScript layer, which is what `native/` is today minus the engine. Two things to know before
anyone starts: the guest is pure wasm either way — V8's *wasm* is what runs a wac program, and JS is
only ever host glue — so the gain is the host layer rather than the program; and V8's instantiation
API is reachable from Rust but its imports and instances are JS objects, so a thin glue layer is
unavoidable rather than optional. It is worth doing when the JS host is the thing in the way. It is
not worth doing to make wac programs faster, because they are already running on V8's wasm engine.
