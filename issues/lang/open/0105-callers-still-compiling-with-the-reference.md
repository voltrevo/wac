# 0105 — the callers that still compile with the reference (the bundlers are done)

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-12
- **Kind:** task
- **Symptom:** not implemented

Step 3 of
[design/lang/0003](../../../design/lang/0003-the-spec-targets-wacc-and-the-reference-becomes-a-seed.md).
`harness/wacBind.ts` binds with wacc by default now, so a package gets wacc's code, wacc's
description of its interface and wacc's generator. These call `wacCompile` directly and so still go
through the reference — which means none of them can handle a file using a feature only wacc has.

**Corrected 2026-08-12.** The first version of this issue said "five", from a `grep` I truncated with
`head -14` and did not notice. It is **25 files**. The shape of the answer is unchanged and the
priority is sharper, because two of the ones I missed are the bundlers, and they are what stands
between the `wac` binary and reproducing its own seed.

    harness/{wacCoverage,wacTestRun}.ts
    packages/{tor/test/entries.test,wactest/test/assert.test,zstd/bench/corpus}.ts
    packages/wacc/tools/specCases.ts
    site/src/editor/{wac-compile,wac-lint}.ts   site/tools/{site.test,siteDeadline}.ts
    tools/{bindcheck,check,coverage,emitgen,fuzz,fuzzBoundary,mutate,programs.test,size,
           syncBootstrap,validate}.ts

`tools/{wasmopt,size}.ts` are done: both *measure* what a build produces, so pointing them at the
reference reported bytes nobody runs and a compiler nobody invokes. Figures they printed before
2026-08-12 are the reference's and are not comparable — the compiler changed, not the program.

`harness/wacBind.ts` binds with wacc by default, and `packages/platform/{build,native}.ts` build
with it too. The rest sort into the three kinds below.

## The bundlers, which is where this bites

`packages/platform/native.ts:95` and `packages/platform/build.ts` compile with the reference and then
write a **manifest** describing what they compiled — the callback signatures, the structs, the
exports. The `wac` binary embeds that pair, and the pair has to agree with itself:

```
$ cp wacc-built-by-wacc.wasm native/seed/wacc.wasm && cargo build --release
$ ./wacland check x.wac
Error: no $bind$fnref_32
```

The manifest says 43 callback signatures because the *reference* found 43; wacc's module numbers them
differently — it finds 51 — so a wacc-built module against a reference-built manifest is a module
missing a function the host asks for by name.

**Both bundlers are done, 2026-08-12.** `build.ts` compiles applications with wacc by default
(`issues/lang/0106`), and `native.ts` now builds its manifest from `bindTypesFiles`,
`exportSigsFiles` and the module's own export list. The wasmtime host's 16 tests pass against
wacc-built artifacts, and `packages/platform/test/native_manifest.test.ts` holds the property the
host actually depends on: every funcref field names a signature the manifest has a dispatcher for.

One thing that mapping had to solve. The emitter collapses `Pending<u8[]?>` into `Pending<u8[]>` —
a nullable reference and a reference are the same wasm type — but `native/src/main.rs` asks for
`Pending<u8[]?>` **by name**. The `A` lines already record the second spelling, so the manifest
carries both names pointing at one type, which is what is true: the same type, reachable two ways.
Emitter identity is not boundary identity, and the manifest is where the difference belongs.

| caller | what it uses the compiler for | move? |
|---|---|---|
| `harness/wacCoverage.ts` | `{ coverage: true }`, then reads the counters | **works, off by default** — `WAC_COV_FROM=wacc`; see below |
| `tools/coverage.ts` | the same, as a command | with the above |
| `harness/wacTestRun.ts` | compiles a `.wac` test file, optionally with coverage | **done** — wacc by default, `WAC_TEST_FROM=reference` back |
| `tools/wasmopt.ts` | bytes to hand to `wasm-opt` | **done** — and it had to be, since it measures what a build ships |
| `harness/ctTrace.ts` | `{ ctTrace: true }` | **done** — wacc by default, `WAC_CT_FROM=reference` back |
| `tools/fuzzBoundary.ts` | the reference's own bindgen | **no, deliberately** — see below |
| `site/src/snippets.ts` | compiles snippets for the site | blocked by `0103` — the glue is TypeScript |

## Coverage works on wacc; the ledgers are what is not ready

`WAC_COV_FROM=wacc` switches `instrument()` over and everything on the compiler's side is there —
`__cov_init/_len/_get` are exported, the generator writes wrappers for them, and `covTableFiles`
names the file and the line that file's own editor shows. That last part was wrong until now: the
table carried `index, line, col, kind` and no file at all, so every point was attributed to the
entry at a line of the *linked blob*. `packages/json` read as 621 points in `json.wac` and none in
`parse.wac`, `stringify.wac` or `value.wac`. `packages/wacc/test/covTable.test.ts` holds it.

What blocks the default is the `NOT_COVERED` ledgers. Each `cov.ts` names the branches its tests
deliberately do not drive, and those names are calibrated against one compiler's branch points. The
two compilers do not instrument the same set:

| file | reference | wacc |
| --- | ---: | ---: |
| `packages/json/src/parse.wac` | 156 | 171 |
| `packages/json/src/stringify.wac` | 74 | 51 |
| `packages/json/test/wac/json_test.wac` | 50 | 6 |

and in `packages/fs` six branches wacc instruments are unaccounted for, at real lines in real
source:

    packages/fs/src/fs.wac:519    if (at.len() > bestLen) {
    packages/fs/src/fs.wac:1282   if (m.at == "/proc") {
    packages/fs/src/fs.wac:1288   if (tail == "/status") { return SYNTH_STATUS(); }
    packages/fs/src/path.wac:34   } else if (name != "." && n < 64) {
    packages/fs/src/wire.wac:70   if (this.why == "") { this.why = "a length above two gigabytes…"; }
    packages/fs/src/wire.wac:94   if (this.why == "") { this.why = why; }

Whether each is driven or accounted for is a question about `packages/fs`'s tests, and the reason
text is the whole value of that ledger — so it belongs to whoever knows the answer rather than to
whoever moved the harness. Until then the switch exists and the default does not change.

## What is left, and why each one is where it is

Every remaining caller now has a reason rather than a queue position:

| caller | why it still calls the reference |
| --- | --- |
| `harness/ctTrace.ts` | **done, 2026-08-12** — wacc has trace mode now, and it found one thing the reference records that wacc did not: `and-rhs` |
| `tools/fuzzBoundary.ts` | it fuzzes **the reference's** bindgen on purpose; pointing both sides at one generator leaves the marshalling with a single witness |
| `packages/wacc/tools/specCases.ts` | it does not compile anything — it copies the spec suite and points its one `wacCompile` import at a shim that records what it was handed |
| `packages/zstd/bench/corpus.ts` | it wants *a* real binary as a compression sample, not *the* shipped one; switching would move recorded ratios for nothing |
| `tools/coverage.ts` | works on wacc (`WAC_COV_FROM=wacc`) and waits on the `NOT_COVERED` ledgers, which belong to each package |
| `tools/programs.test.ts` | **done** — it guards what a build does, so it has to ask the compiler a build uses |
| `site/src/snippets.ts`, `site/tools/*` | blocked by `issues/lang/0103` — the glue is TypeScript the page has to load |
| `packages/platform/{build,native}.ts` | both compile with wacc by default; the reference is the escape hatch, and it stays |

So this issue is no longer a list of moves. What is left is one deliberate duplication, one
blocked-on-0103, and one waiting on ledgers nobody here should rewrite. The gap is closed.

## The two that should keep it

`tools/fuzzBoundary.ts` fuzzes the boundary **the reference's bindgen writes**; the wacc side of that
question is `packages/wacc/test/bindgen.test.ts`. Pointing both at one generator would leave the
marshalling with a single witness, which is the failure mode the file's own header says cost the most.
It is marked in the source.

## The gap, closed 2026-08-12

`harness/ctTrace.ts` wanted `{ ctTrace: true }` and wacc had no equivalent — the one item here that
was a *feature* rather than a port. wacc has it now: `emitFilesTraced` and `traceTableFiles`, the
same journal read through the same three accessors, with `WAC_CT_FROM=reference` to go back.

Two things worth keeping from doing it:

- **wacc did not instrument the right-hand side of a short circuit.** The reference records
  `and-rhs`/`or-rhs`; wacc had no point there at all, so a secret deciding whether `b` runs in
  `a && b` was invisible to a trace *and* `a && b` read as covered when only `a` had ever been true.
  Both compilers now report 1 `and-rhs` point in `packages/crypto/src/aes.wac`, which is how the gap
  was found: comparing the two tables point-kind by point-kind rather than trusting a green run.
- **The tables still differ, correctly.** wacc emits an `else` point for an `if` without one — 9 of
  them in `aes.wac` — because a coverage reader wants the path that was not taken. A trace is
  compared against another trace from the same module, so the numbering never has to agree.

## Why this matters more than it looks

Each of these is a place where the answer to "can wacc build this repository by itself" is still
*no*, and each will fail in the same way on the day a package uses JSX: not with a diagnostic, but
with the reference refusing to parse a file it was never taught. The coverage three are the same
change three times over and should be done together.
