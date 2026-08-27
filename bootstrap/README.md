# wacboot

An experiment, not a product: **how big is the hand-written root of a bootstrap ladder for
[wac](https://github.com/wac-lang/wac), and is a ladder cheaper than the 19,499-line TypeScript
reference compiler it would replace?**

The question is a number, and this repository exists to produce it rather than to argue about it.

## The ladder

Each rung is written in the rung below. Only L0 is written by hand, and only L0 is trusted by
reading rather than by derivation.

| | language | what it adds | its compiler is written in | size |
|---|---|---|---|---|
| **L0** | `sx` | s-expressions, closures, a heap | **hand-written `.wax`** | 1,630 instructions |
| **L1** | `wx` | i32, memory, functions, `while`, literals | sx | 200 lines |
| **L2** | `wac-0` | C-family syntax, globals, scopes | wx | 452 lines |
| **L3** | `wac-1` | structs, arrays, `enum`/`match`, methods, **wasm GC** | wac-0 | 991 lines |
| **L4** | `wac-2` | generics, nullables, the wac ABI — *not built* | wac-1 | — |

**L4 is the language `packages/wacc/src` is written in**: full wac minus the nine omissions
`compiler/README.md` documents, and *with* generics. Its compiler — `wacc0` — is the last program in
the chain, and compiling `packages/wacc/src` with it produces `wacc.wasm`, after which wac is
self-hosting as it already is today.

**Generics live in L4's compiler, not in L3's language.** They are the most expensive feature to
implement and the cheapest to live without, so putting them in wac-1 would mean implementing
monomorphisation in wac-0's compiler as well — paying for them twice, at the rung where code costs
most to write. The tax for leaving them out is a growable vector hand-written per element type: 25
lines each, perhaps five of them, measured in `ts/wac1_test.ts`.

## Underneath it: `.wax`

Not a rung. It is the assembly text every rung emits — line-oriented, one instruction per line,
every label and index named — and it exists so that no step of the bootstrap needs a binary nobody
can read. LEB128, section framing and index assignment are written **twice**, in TypeScript and in
Rust, and the two are required to agree byte for byte on every module in the repository.

That differential is also the thing wac's own ladder would lose by retiring its reference compiler,
which `design/lang/0003` calls the instrument behind most of this year's defects. It is worth
practising here.

## Two rules that make it a ladder rather than three unrelated languages

**Every rung emits `.wax` text, not wasm bytes.** So nothing above the assembler re-implements
LEB128 or section framing — work with a known answer and a new place to be wrong.

**From L2 up, the syntax is C-family and each rung is a superset of the one below.** A rung's
compiler is the previous compiler plus features, ported upward rather than rewritten, which is what
makes the ladder converge on wac instead of wandering.

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

...and `enum` with payloads, `match`, and methods:

    enum Expr { Num(i32 v); Add(Expr a, Expr b); Neg(Expr a); }

    i32 eval(Expr e) {
      match (e) {
        case Num(v): { return v; }
        case Add(a, b): { return eval(a) + eval(b); }
        case Neg(a): { return 0 - eval(a); }
      }
      return 0;
    }

which is the shape wac's own compiler is written in.

**There is deliberately no type checker**, and none is missing: wasm validation is one, and it is
total — every wac-level type error is refused before the program runs, by the engine or by the
compiler's own refusal marker. `spec/wac1.md` has the table. What is left is `T?` and generics.
`NOTES.md` has the numbers and the bugs.
