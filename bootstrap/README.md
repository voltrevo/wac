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

**Four rungs work.** `boot/sx.wax` is a 1,457-instruction s-expression interpreter, hand-written.
`boot/wx.sx` is a compiler for wx — functions, locals, globals, `if`, `while`, recursion, sixteen
operators, byte and word memory — written in sx, in **167 lines**. A wx program goes all the way to
wasm with nothing but the interpreter and the assembler in the path.

`boot/wac0.wx` is a compiler for **wac-0** — C-family syntax, typed parameters, declarations with
shadowing, `return`/`if`/`else`/`while`, precedence climbing — in **345 lines** of wx. `fib(20)`
answers 6765 through four languages and two interpreters.

    i32 fib(i32 n) {
      if (n < 2) { return n; }
      return fib(n - 1) + fib(n - 2);
    }

`boot/wac1.wac0` is a compiler for **wac-1** — structs, arrays, `null`, and a type system — in 754
lines of wac-0, emitting **wasm GC**. No allocator anywhere in the ladder:

    struct Node { i32 value; Node[] kids; }

    i32 total(Node n) {
      i32 sum = n.value;
      i32 i = 0;
      while (i < n.kids.len()) { sum = sum + total(n.kids[i]); i = i + 1; }
      return sum;
    }

**Next is `enum` with payloads and `match`** — the feature that changes what writing a compiler
feels like, and the cheapest one wasm GC gives away: a struct per variant, and `ref.test` for the
match. `NOTES.md` has the numbers and the bugs.
