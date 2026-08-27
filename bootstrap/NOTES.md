# What has been measured

## The numbers

Two rungs exist and both work.

    boot/sx.wax          1,457 instructions   the root, hand-written
    boot/wx.sx             167 lines          a compiler for wx, written in sx

**The second number is the interesting one.** A compiler that handles functions, calls, locals,
globals, `if`, `while`, assignment, recursion, sixteen operators and byte and word memory access is
**167 lines**, because it emits `.wax` text rather than wasm bytes and because sx's reader is its
parser. That is the case for the ladder in one figure: each rung is cheap when the rung below it is
a decent language.

The root grew by 300 instructions to support it — `do`, `set!`, `/`, `%`, `peek`, `poke`, `alloc`,
`sym-len`, `sym-byte`, `sym?`, `nil?`, and a lookup that answers the binding rather than the value.

The original stage-one figure, for comparison:

    boot/sx.wax          1,157 instructions   before wx needed anything of it

For comparison, the thing a ladder would replace:

    wac's compiler/      19,499 lines of TypeScript

and the tooling this experiment needed to get there:

    spec/wax.md          156 lines      the format
    ts/assemble.ts       463 lines      the assembler
    rust/src/lib.rs      770 lines      the assembler again, so the two can disagree

**1,157 lines is under the 1,500 I guessed the root had to stay below**, and that was the number the
experiment existed to produce. A line of `.wax` is one wasm instruction, so this is about what a
300–400 line C program would be; the expansion factor for writing in assembly is roughly three.

## What sx actually is

Enough of a Lisp to write programs in, and it is tested by running 26 of them (`ts/sx_test.ts`):

- fixnums, symbols interned into one list, pairs, and a one-bit tag telling immediates from objects;
- a reader for atoms, negative numbers and nested lists;
- `quote`, `if`, `fn`, `def`, and application;
- closures that capture their environment, with a global fallback so recursion works;
- `+ - * < = car cdr cons pair?`;
- a bump allocator that grows the memory rather than running out.

`(def fib (fn (n) (if (< n 2) n (+ (fib (- n 1)) (fib (- n 2)))))) (fib 15)` answers 610.

## What the second rung proved, and what it cost

`ts/wx_test.ts` runs ten wx programs through the whole ladder — nothing stubbed, no step skipped.
`(fib 20)` answers 6765; a `while` inside a `while` counts to 12; `store8`/`load8` move bytes.

Four bugs, and three of them say something.

**sx had no `do`.** A function body is a single expression, so until this there was no way for a
function to both act and answer. It was invisible while sx only evaluated arithmetic.

**I wrote 33 of the compiler's equality tests as `==`.** That is wx's spelling; sx spells it `=`.
The two languages are both s-expressions and look alike, and the compiler is written in one and
about the other, so every line has to be read twice. This will get worse at L2, not better.

**`comp-while` kept its two labels in globals**, and `def` in sx binds globally — so a `while`
inside a `while` rebound the outer one's labels, and the outer `br`, emitted *after* the body,
branched into the inner loop. The generated assembly looks entirely reasonable. A test found it; no
amount of reading would have.

**A missing parenthesis in a 28-way `if` chain did not fail.** The reader simply swallowed the
expression that followed the file, so the program ran and answered a plausible number. That is the
real cost of s-expression syntax at a rung with no diagnostics: unbalanced input is not an error,
it is a different program.

## What sx is not, and what that costs

Missing, and each would have to exist before a compiler could be written in it:

- **byte output.** sx answers an `i32` and cannot emit anything. A compiler needs to write a wasm
  module, so this is the one genuinely required addition: an imported `putc`, a primitive, and a way
  to hold bytes. Perhaps 60 lines.
- **strings**, as distinct from symbols. A compiler needs literals and names it did not intern.
- **`let`**, and more list utilities. Both are writable *in sx* once `fn` exists, so they cost source
  in the next rung rather than lines in the root.
- **tail calls.** Recursion consumes the wasm stack, so a long list is a deep stack. A bootstrap can
  raise the stack limit, but a compiler looping over a large file may hit it.
- **any error reporting at all.** A malformed program traps, and a trap in wasm has no message.

Call it **~1,400 lines** for a root a compiler could be written against. That is the honest figure to
plan with, and it is still an order of magnitude under the reference.

## The two bugs, because they say what writing this is like

**An `if` given a result type whose else-arm produces nothing.** Made twice. wasm reports it as
*expected 1 element on the stack for fallthru* against a function **index**, so finding it means
counting `func` lines. A map from byte offsets back to source lines is the obvious next tool.

**The tag bit needs an alignment invariant, and the allocator was not keeping it.** An object's
value is its address plus one, so addresses must be even. A symbol allocates `12 + len` bytes, so an
odd-length name leaves the heap odd, the next object's value comes out even, and `$is_fix` calls it a
fixnum. `$alloc` now rounds up to a word.

**Stage one could not have caught it.** It read `(1 2 (3 4) 5)` — a program with no symbols in it, so
every allocation was a 12-byte pair and the heap stayed aligned by luck. The bug appeared the moment
the evaluator interned `+`. A staged test that passes tells you the stage passed and nothing else.

## What this does not settle

L1 exists and cost 167 lines. **The open question is now L2: a compiler for wac's C-family syntax,
written in wx.** That one has to lex and parse real text, keep a symbol table, and emit for structs
and generics — and it is the rung that has to compile `packages/wacc/src`.

Two things wx would want first, and both are cheap:

- **string literals**, in wx and in sx's reader. A lexer needs keyword tables, and building them a
  byte at a time from arithmetic is the kind of code that hides a typo for a week.
- **a `data` directive**, so those tables are in the module rather than constructed at startup.

wx deliberately has no scopes — local names are unique per function — and that is fine for 167 lines
and questionable for three thousand. It is the first thing I would expect to have to add.

Two other things stay unanswered and should not be forgotten:

- **retiring the reference retires the differential**, which `design/lang/0003` calls the instrument
  that has caught most of this year's defects in wac. A last rung that genuinely implements the
  subset wacc is written in could take that role; a minimum-viable one could not.
- **an interpreted rung is slow**, and how slow has not been measured. It runs once per cold
  checkout, so the bar is patience rather than performance — but `fib 15` is not evidence about
  compiling 37,000 lines.
