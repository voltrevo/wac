# wacboot

An experiment, not a product: **how big is the hand-written root of a bootstrap ladder for
[wac](https://github.com/wac-lang/wac), and is a ladder cheaper than the 19,499-line TypeScript
reference compiler it would replace?**

The question is a number, and this repository exists to produce it rather than to argue about it.

**It works, and it lands where wac's own bootstrap lands.** The ladder compiles
`packages/wacc/src` — 37,873 lines of real wac — into a wasm module the engine accepts, and that
module compiles wac's own source again. All 252 of wac's `spec/cases` come out exactly as their
expectations say, and the two *wacc builds* produce byte-identical output for all 296 of the
corpus's entry points — which is a statement about the compiler wac-L5 built, not about wac-L5.
What wac-L5 itself compiles is `packages/wacc/src` and `core`, and that is on purpose: see
**What wac-L5 is not** below. There is no historical wasm anywhere in the chain: an assembler written twice from a
written format, an interpreter, four compilers, and then the real compiler reproducing itself.

**And it is the same wacc wac's own TypeScript bootstrap reaches, byte for byte.** The first rungs
differ and must — `wac-L5(S)` is 661,626 bytes and `reference(S)` is 884,803, two different
compilers compiling one source. But both results are *wacc*, so both compile `S` the same way, and
the second rung is 681,417 bytes on either path. The fixed point belongs to wacc's source rather
than to whatever compiled it first, which is what makes this a replacement for the reference rather
than a second opinion.

Three commands say so, and each is a test rather than a claim:

    deno test -A ts/                          # 221 tests, fifteen seconds
    deno run -A ts/spec_cases.ts              # 252 of wac's spec cases, through the built wacc
    deno run -A ts/corpus_differential.ts     # the whole corpus, two compilers, compared
    deno run -A ts/same_fixed_point.ts        # and the same fixed point as wac's own bootstrap

## What wac-L5 is not

**It is the minimum that compiles wacc, and not a wac compiler.** That is the whole design: the
ladder exists to reach `packages/wacc/src`, and every feature beyond what those 37,873 lines use is
a feature the rung below has to pay for too. Pointed at the wider corpus, 81 of 296 entry points
compile and validate.

The shortcuts, so nobody has to discover them:

- **`import` is ignored.** The driver flattens the module graph and wac-L5 skips the line, because
  resolving a path is a file read and no wac-L4 program can do one — wacc does it in `files.wac`.
  So there is no module system here, and the flattener does the linking, including renaming the
  private declarations of two modules that chose the same name.
- **`export` is honoured for functions and nothing else.** Structs, enums and globals ignore it,
  since there are no modules for a name to be private to. `main` is exported whatever it says.
- **A module-level `const` is refused**, and refused badly: `const` is not consumed at the top
  level, so `const u32[] K = …` is read as a global named `u32` and `K` is lost, which surfaces as
  an unresolved name wherever it is used. 251 declarations in the corpus are written this way and
  **none in wacc or `core`**, which is exactly why it went unnoticed. Doing it properly needs a
  `start` section and a function per initialiser, because wac's initialiser is an expression and
  wasm's global takes a constant.
- **`const` everywhere else is read and dropped** — `const this`, const locals, const parameters.
  Harmless: `const` is a permission, and violating one is an error this rung does not diagnose.
- **`?` is dropped** except where it decides a sized array's default element.
- **There is no type checker**, which is the one omission that is not a shortcut — see below.

## The answer to the question

**The ladder is 9,834 lines against the reference's 19,499** — but the line count is the less
interesting half, because the two numbers are not the same kind of thing.

    what a human must read to trust it
      wac-L0 assembler, one of the two           832 lines   (the other is the check, not the trust)
      wac-L1 interpreter, hand-written         1,804 lines
      the flattener, in ts/l5.ts                 191 lines
                                               -----------
                                               2,827 lines

    what is derived from that, and checked by running it
      wac-L2 ... wac-L5                        5,986 lines
      the second assembler                     1,212 lines

    what produces no artefact at all
      the instruments                          1,209 lines
      the tests                                1,512 lines

**The flattener is in the first column and it took a while to notice.** wac-L5 ignores `import`,
so something has to do the linking, and that something is 191 lines of TypeScript that resolves
specifiers, concatenates modules and *renames the colliding private declarations of two of them*.
A bug there produces a wrong program quietly, which is the definition of code that has to be
trusted. It is the cost of the shortcut, and leaving it out of the count was flattering.

The reference's 19,499 lines are all in the first column: every one of them is trusted because
somebody read it. Here, 2,827 are — and one of those three files is checked against a second
implementation of the same written format, so even the root has a witness.

That is the case for a ladder, and it is a different case from "fewer lines".

## The ladder

Every rung is a language, and every rung's compiler is written in the rung below. **wac-L0 is the
only one whose implementation lives outside the ladder** — which is why it is implemented *twice*,
in TypeScript and in Rust, required to agree byte for byte. L0 is trusted by two readings agreeing;
everything above it is trusted by derivation.

| | adds | its implementation is written in | size |
|---|---|---|---|
| **wac-L0** | wasm as text: one instruction per line, every index named, structs, arrays, packed bytes | TypeScript **and** Rust, outside the ladder | 405 + 693 lines |
| **wac-L1** | s-expressions, closures, a heap — an interpreter, not a compiler | **hand-written wac-L0** | 1,630 instructions |
| **wac-L2** | i32, memory, functions, `while`, string literals | wac-L1 | 200 lines |
| **wac-L3** | C-family syntax, globals, scopes, shadowing | wac-L2 | 452 lines |
| **wac-L4** | structs, arrays, `enum`/`match`, methods, `u8[]` strings, **wasm GC** | wac-L3 | 1,005 lines |
| **wac-L5** | wac itself — *all of `core/` and all of `wacc/src`* | wac-L4 | 3,779 lines |

Only `wac` survives as a language name; the rungs are numbered, because they look alike and are not
alike. Writing `==` where L1 wants `=`, or `//` where it wants `;`, is a mistake the old names
invited and the numbers do not.

Files say the same thing: `boot/l4.l3` is **the L4 compiler, written in L3**.

**wac-L5 is a language we are handed, not one we choose.** It is whatever `packages/wacc/src` is
written in: full wac minus the nine omissions `compiler/README.md` documents, and *with* generics.
Its compiler is the last program in the chain, and compiling `packages/wacc/src` with it produces
`wacc.wasm` — after which wac is self-hosting, as it already is today.

**Every stage exists.** Real wac syntax, its type system, generics by monomorphisation,
and enough of the surface that **wacc** compiles. Structs with `const this` methods,
enums with comma-separated variants, `match` as both a statement and an expression, arrays, `u8[]`,
reference globals — compiled through six languages and two interpreters.

    enum Option {
      Some(i32 v), None
      bool isSome(const this) {
        return match (this) { case Some(_): true, case None: false };
      }
    }

which is the shape `core/option.wac` is actually written in. `spec/l5.md` has the four stages and
what each is measured to cost.

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

**And the ladder runs under two hosts.** `ts/` drives every rung through Deno; `rust-ladder/`
drives the same rungs through V8 embedded in Rust, and `ts/hosts_agree_test.ts` checks the wac-L0
they produce is identical. That is a different claim from the two assemblers agreeing: that
differential covers *reading* a format, this one covers *running* five compilers, where the
differences an engine can introduce are the interesting ones. The one line of JavaScript in the
Rust host is `new WebAssembly.Instance`, because that is a JS constructor and V8's C++ embedding
API exposes no equivalent.

**And L0 is written twice on purpose.** The differential is the only check a bootstrap root can
have, and it is also the thing wac's own ladder would lose by retiring its reference compiler —
which `design/lang/0003` calls the instrument behind most of this year's defects. Worth practising.

## What is here

    spec/l0.md      the assembly format: line-oriented, one instruction per line, no folding
    ts/             the L0 assembler in TypeScript, the drivers, and the instruments
    rust/           the L0 assembler in Rust — no dependencies, deliberately
    rust-ladder/    the same ladder driven from Rust, on V8
    boot/           every rung's compiler, each written in the rung below
    drivers/        wac programs that give a host a way to ask a built compiler something
    tests/l0/       modules in .l0, and what they should answer

The instruments are worth naming, because each was built for a failure the one before it could not
see:

    ts/against_real_wac.ts     an entry point through wac-L5 itself: refused, or assembled, or
                               validated — with the function count beside the byte count, because a
                               file of nothing but generic declarations emits nothing and validates
    ts/first_refusal.ts        what wac-L5 would not read, which function it is in, and how many
                               *distinct* refusals there are rather than how many times the
                               commonest one appears
    ts/validate_real_wac.ts    what it read and emitted wrongly — the engine reports a byte offset
                               and nothing else, so the assembler hands back a map to a wac-L0 line
    ts/run_real_wac.ts         what it emitted that traps, with the frames named through that map
    ts/ask_wacc.ts             one program through the built wacc, *run* — because `f` being
                               exported is not `f` being right
    ts/spec_cases.ts           all 252 of wac's spec cases, each against its own expectation
    ts/selfhost.ts             the built wacc building wacc, and the two compared
    ts/corpus_differential.ts  the same, over every package in the repo

**Two assemblers on purpose.** The format exists so that no step of the bootstrap needs a binary
nobody can read, and the way to be sure the format is that simple is to implement it twice and
require the two to agree byte for byte. That differential is also the thing wac's own ladder would
lose by retiring its reference compiler, so it is worth practising here.

## Status

**Every rung works, and the ladder closes.**

`boot/l1.l0` is a 1,630-instruction s-expression interpreter, hand-written, and the last
hand-written parser in the chain. `boot/l2.l1` is a compiler in 298 lines of it; `boot/l3.l2` a
compiler in 583 lines of *that*; `boot/l4.l3` 1,326 lines emitting wasm GC; and `boot/l5.l4` — the
compiler for wac itself — 3,779 lines of wac-L4.

Cold, the whole chain builds in under two seconds, and building wacc with it takes a second more.

    wac-L0 assembler, written twice        832 lines TypeScript, 1,212 Rust
      -> wac-L1 interpreter                1,630 instructions, hand-written
        -> wac-L2 -> wac-L3 -> wac-L4 -> wac-L5
          -> wacc                          661,626 bytes, from 37,873 lines of wac
            -> wacc again                  681,417 bytes, in three quarters of a second
              -> and those two agree byte for byte on all 296 corpus entry points

**No type checker, and none missing.** wasm validation is one, and it is total: every wac-level
type error is refused before the program runs, by the engine or by the compiler's own refusal
marker. What wac-L5 does check is what wasm cannot see — that a name resolves, that a method
exists, that a `case` names a variant.

`NOTES.md` has the numbers and the bugs, and the bugs are the more useful half: six of them were
found only by *running* what the built compiler produced, which is the difference between a module
that validates and a compiler that works.
