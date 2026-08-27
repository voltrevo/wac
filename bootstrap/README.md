# wacboot

An experiment, not a product: **how big is the hand-written root of a bootstrap ladder for
[wac](https://github.com/wac-lang/wac), and is a ladder cheaper than the 19,499-line TypeScript
reference compiler it would replace?**

The question is a number, and this repository exists to produce it rather than to argue about it.

## The idea being tested

Today a cold `wac` checkout builds its first `wacc.wasm` with `compiler/`, a TypeScript compiler for
a subset of wac. That is the last large piece of TypeScript on the language's critical path, and
`design/lang/0003` in the wac repository has already demoted it to one job. A ladder would replace it:

1. a **hand-written root** in a format that converts to wasm by inspection — not a compiler but an
   *interpreter*, for a language whose syntax is trivial to read;
2. one or two **intermediates**, each written in the language of the rung below and frozen once it
   works;
3. **wacc**, whose own sources are pinned to the features the last rung provides — the same
   discipline they are under today with the reference.

The interpreter-not-compiler choice is the point of the experiment. A hand-written *compiler* has to
encode wasm; an interpreter only has to walk a tree, and bootstrap speed is irrelevant because it
runs once per cold checkout.

## What is here

    spec/wax.md      the assembly format: line-oriented, one instruction per line, no folding
    ts/              the assembler in TypeScript
    rust/            the assembler in Rust
    tests/           modules in .wax, and what they should answer

**Two assemblers on purpose.** The format exists so that no step of the bootstrap needs a binary
nobody can read, and the way to be sure the format is that simple is to implement it twice and
require the two to agree byte for byte. That differential is also the thing wac's own ladder would
lose by retiring its reference compiler, so it is worth practising here.

## Status

The root exists and works: `boot/sx.wax` is a 1,157-instruction s-expression interpreter with a
reader, interned symbols, closures, recursion and a growing heap, and 26 programs are run against it
as tests. That is under the 1,500 lines the experiment set as the bar.

**The next measurement is the rung above** — a compiler, written in sx, emitting `.wax`. The case for
a ladder rests on that one, not on this one. `NOTES.md` has the figures, what sx still lacks, and
the two bugs, one of which a passing earlier stage could not have caught.
