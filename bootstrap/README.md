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

**Two rungs work.** `boot/sx.wax` is a 1,457-instruction s-expression interpreter, hand-written.
`boot/wx.sx` is a compiler for wx — functions, locals, globals, `if`, `while`, recursion, sixteen
operators, byte and word memory — written in sx, in **167 lines**. A wx program goes all the way to
wasm with nothing but the interpreter and the assembler in the path.

That second figure is the case for the ladder: a rung is cheap when the rung below it is a decent
language. **The open question is L2**, wac's own syntax, written in wx. `NOTES.md` has the numbers,
what wx would want first, and the four bugs — one of which no amount of reading would have found.
