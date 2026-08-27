# wacboot

An experiment, not a product: **how big is the hand-written root of a bootstrap ladder for
[wac](https://github.com/wac-lang/wac), and is a ladder cheaper than the 19,499-line TypeScript
reference compiler it would replace?**

The question is a number, and this repository exists to produce it rather than to argue about it.

## The ladder

Every rung is a language, and every rung's compiler is written in the rung below. **wac-L0 is the
only one whose implementation lives outside the ladder** — which is why it is implemented *twice*,
in TypeScript and in Rust, required to agree byte for byte. L0 is trusted by two readings agreeing;
everything above it is trusted by derivation.

| | adds | its implementation is written in | size |
|---|---|---|---|
| **wac-L0** | wasm as text: one instruction per line, every index named, structs and arrays | TypeScript **and** Rust, outside the ladder | 399 + 687 lines |
| **wac-L1** | s-expressions, closures, a heap — an interpreter, not a compiler | **hand-written wac-L0** | 1,630 instructions |
| **wac-L2** | i32, memory, functions, `while`, string literals | wac-L1 | 200 lines |
| **wac-L3** | C-family syntax, globals, scopes, shadowing | wac-L2 | 452 lines |
| **wac-L4** | structs, arrays, `enum`/`match`, methods, **wasm GC** | wac-L3 | 991 lines |
| **wac-L5** | generics, nullables, the wac ABI — *not built* | wac-L4 | — |

Only `wac` survives as a language name; the rungs are numbered, because they look alike and are not
alike. Writing `==` where L1 wants `=`, or `//` where it wants `;`, is a mistake the old names
invited and the numbers do not.

Files say the same thing: `boot/l4.l3` is **the L4 compiler, written in L3**.

**wac-L5 is a language we are handed, not one we choose.** It is whatever `packages/wacc/src` is
written in: full wac minus the nine omissions `compiler/README.md` documents, and *with* generics.
Its compiler is the last program in the chain, and compiling `packages/wacc/src` with it produces
`wacc.wasm` — after which wac is self-hosting, as it already is today.

**Generics belong to L5's compiler, not to L4's language.** They are the most expensive feature to
implement and the cheapest to live without, so putting them in L4 would mean implementing
monomorphisation in L3's compiler as well — paying for them twice, at the rung where code costs most
to write. The tax for leaving them out is a growable vector hand-written per element type: 25 lines
each, perhaps five of them, measured in `ts/l4_test.ts`.

## Two rules that make it a ladder rather than five unrelated languages

**Every rung emits wac-L0 text, not wasm bytes.** So nothing above L0 re-implements LEB128 or
section framing — work with a known answer and a new place to be wrong.

**From L3 up, the syntax is C-family and each rung is a superset of the one below.** A rung's
compiler is the previous compiler plus features, ported upward rather than rewritten, which is what
makes the ladder converge on wac instead of wandering.

**And L0 is written twice on purpose.** The differential is the only check a bootstrap root can
have, and it is also the thing wac's own ladder would lose by retiring its reference compiler —
which `design/lang/0003` calls the instrument behind most of this year's defects. Worth practising.

## What is here

    spec/l0.md      the assembly format: line-oriented, one instruction per line, no folding
    ts/              the assembler in TypeScript
    rust/            the assembler in Rust
    tests/           modules in .wax, and what they should answer

**Two assemblers on purpose.** The format exists so that no step of the bootstrap needs a binary
nobody can read, and the way to be sure the format is that simple is to implement it twice and
require the two to agree byte for byte. That differential is also the thing wac's own ladder would
lose by retiring its reference compiler, so it is worth practising here.

## Status

**Four rungs work.** `boot/l1.l0` is a 1,457-instruction s-expression interpreter, hand-written.
`boot/l2.l1` is a compiler for wx — functions, locals, globals, `if`, `while`, recursion, sixteen
operators, byte and word memory — written in sx, in **167 lines**. A wx program goes all the way to
wasm with nothing but the interpreter and the assembler in the path.

`boot/l3.l2` is a compiler for **wac-0** — C-family syntax, typed parameters, declarations with
shadowing, `return`/`if`/`else`/`while`, precedence climbing — in **345 lines** of wx. `fib(20)`
answers 6765 through four languages and two interpreters.

    i32 fib(i32 n) {
      if (n < 2) { return n; }
      return fib(n - 1) + fib(n - 2);
    }

`boot/l4.l3` is a compiler for **wac-1** — structs, arrays, `null`, and a type system — in 754
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
compiler's own refusal marker. `spec/l4.md` has the table. What is left is `T?` and generics.
`NOTES.md` has the numbers and the bugs.
