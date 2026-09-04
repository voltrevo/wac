# 0329a — wac-L5 accepts a module-level variable and `wacc` does not, and three ladder drivers use one

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** design question
- **Symptom:** the three files the ladder is driven by cannot be compiled by the compiler the ladder builds

## Reproduction

```wac
// bootstrap/drivers/emit_and_run.wac, line 9 — a module-level mutable variable
u8[] built;

export i32 build() {
  built = emit("export i32 answer() { return 6 * 7; }".toBytes());
  return built.len();
}
```

Expected: one language, and this either is or is not in it.

Actual: `wac-L5` compiles it as part of the ladder. `wacc` has no top-level case for it —
`packages/wacc/src/parse.wac`'s declaration loop is `import`, `struct`, `enum`, `const`, function and
an error, with nothing between — so the token stream falls into `parseFuncDecl` and fails.
`spec/spec/grammar.md` agrees with `wacc`: `program = { import | struct_decl | enum_decl | func_decl
| const_decl }`, and `spec/spec/variables.md` documents module-level `const` and no mutable form.

## How it was found, and why nothing had found it

Running the spec's own grammar over every `.wac` in the repository, 2026-09-04, with
`tools/specparse.ts`. **Of 1,578 files it refuses ten**: seven are `spec/cases` programs written to be
refused, and the other three are

    bootstrap/drivers/emit_and_run.wac:9:11    no rule reaches ';'
    bootstrap/drivers/selfhost.wac:11:11       no rule reaches ';'
    bootstrap/drivers/spec_cases.wac:16:11     no rule reaches ';'

all at the same column, all the same construct. `selfhost.wac` has seven of them and
`spec_cases.wac` nine, including `i32 nfile = 0;`, so it is not one stray line.

Nothing had found it because **the constraint the ladder checks is one-directional**. `packages/wacc`
must be compilable by wac-L5, and that is checked on every build — `harness/ladderRun.ts` dies if
*"wac-L5 refused N thing(s) in wacc's own source"*. The reverse, that wac-L5 accepts nothing wacc
does not, is checked by nothing, and the only files that would exercise it are these three.

They are also the only files that will never be compiled the other way, by construction:
`ladderRun.ts:67` concatenates the driver onto wacc's source and hands the pair to `l5ToL0`, so the
driver rides through L5 and reaches no other compiler. `bootstrap/rust-ladder/src/main.rs`,
`harness/waccFromLadder.ts` and `bootstrap/ts/corpus_differential.ts` all do the same.

## Why it is worth a decision rather than a patch

`emit_and_run.wac`'s own header calls itself *"the oracle for the whole ladder"*. The oracle is
written in a dialect the product cannot read, and its comment says so without noticing:

> The result is held in a global between the two calls, which is also the only thing here that is not
> a plain function.

Two answers, and they are expensive in different directions.

**Add it to `wacc` and to the spec.** A module-level mutable variable is a real feature with a real
cost — a wasm global, initialisation order, and a question about whether it is exported. It also
weakens *"a program gets what it is handed"*, which is why nobody has proposed it. But then the
drivers are ordinary programs and the ladder has one language.

**Take it out of the drivers.** The globals exist because the wacc that wac-L5 builds emits no
bindgen, so the host drives it a byte at a time through exported functions with no way to pass an
array — the state has to live somewhere between two calls. Removing it means finding another place
for that state in three files whose whole purpose is to be simple enough to trust.

Related: `vision/QUESTIONS.md` has *a declaration with no initialiser* as an open question, on five
uses in the proposal's own pages, recorded as *"either an eleventh addition nobody wrote down or five
examples that elided an initialiser for brevity"*. It is neither: the construct is in the tree, in
the ladder, and has been compiling for as long as the drivers have.

## Notes

Not a spec bug. `spec/spec/grammar.md` and `packages/wacc/src/parse.wac` agree with each other, which
is the opposite of `0320a` and `0326a` — where the grammar was behind the parser. Here the grammar is
right and there is a fourth party.
