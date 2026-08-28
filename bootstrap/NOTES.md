# What has been measured

## The numbers

Four rungs exist and all four work.

    boot/l1.l0          1,630 instructions   the root, hand-written
    boot/l2.l1             200 lines          a compiler for L2, written in wac-L1
    boot/l3.l2           452 lines          a compiler for wac-L3, written in wac-L2
    boot/l4.l3         993 lines          a compiler for wac-L4, written in wac-L3

**wac-L4 is the first rung with a type system**, and the first that emits **wasm GC** — structs and
arrays are engine types, so there is no allocator, no layout arithmetic and no `free` anywhere in
the ladder. `struct Node { i32 value; Node[] kids; }` walks its own tree through five languages and
two interpreters.

It has `enum` with payloads, `match`, and methods:

    enum Expr { Num(i32 v); Add(Expr a, Expr b); Neg(Expr a); }

    i32 eval(Expr e) {
      match (e) {
        case Num(v): { return v; }
        case Add(a, b): { return eval(a) + eval(b); }
        case Neg(a): { return 0 - eval(a); }
      }
      return 0;
    }

993 lines is the largest rung by far and the first that is not obviously cheap. The type system is
most of it: every expression answers a type index, because `p.x` has to know which struct to read
from and a local of struct type has to be declared `refnull $s1` rather than `i32`. wac-L3's compiler
never had to know what an expression *was*.

**Enums cost almost nothing on top of that**, which is the argument for GC made concrete. An enum is
`struct { i32 tag; anyref payload }` with a nameless struct per variant, so it needs no subtyping —
which `.l0` does not have — and a `match` is an integer compare and a `ref.cast`, both of which the
engine does. A method is a function whose name is its owner's and its own, joined; `p.sum()`
resolves at compile time to `call $Point_sum`, because there is no subtyping to make it ambiguous.

**wac-L3 is where the ladder starts looking like wac** — C-family syntax, functions with typed
parameters, `i32` declarations with real shadowing, `return`/`if`/`else`/`while`, precedence
climbing, `//` comments. `fib(20)` answers 6765 through four languages and two interpreters, with
nothing in the path that was not built here.

**345 lines**, and it is that small for two reasons. It emits `.l0` text, so the assembler that is
already written twice does the encoding. And it has **no syntax tree**: a recursive-descent parser
emits as it reads, which suits wasm exactly, because precedence climbing puts operands before
operators and that is the order a stack machine wants. An AST would have been a tree to allocate and
a set of node kinds to encode by hand, in a language with no structs.

The one thing a single pass cannot give is wasm's demand that locals be declared before the body,
and they are only known once the body has been read. So a body is emitted into a scratch buffer and
the header is written in front of it afterwards — nine lines, against a whole second walk.

**The second number is the interesting one.** A compiler that handles functions, calls, locals,
globals, `if`, `while`, assignment, recursion, sixteen operators and byte and word memory access is
**167 lines**, because it emits `.l0` text rather than wasm bytes and because L1's reader is its
parser. That is the case for the ladder in one figure: each rung is cheap when the rung below it is
a decent language.

The root grew by 300 instructions to support it — `do`, `set!`, `/`, `%`, `peek`, `poke`, `alloc`,
`sym-len`, `sym-byte`, `sym?`, `nil?`, and a lookup that answers the binding rather than the value.

The original stage-one figure, for comparison:

    boot/l1.l0          1,157 instructions   before L2 needed anything of it
    boot/l1.l0          1,457 instructions   before wac-L3 needed strings and `//`
    boot/l3.l2           345 lines          before wac-L4 needed `&` and `|`

For comparison, the thing a ladder would replace:

    wac's compiler/      19,499 lines of TypeScript

and the tooling this experiment needed to get there:

    spec/l0.md          156 lines      the format
    ts/assemble.ts       463 lines      the assembler
    rust/src/lib.rs      770 lines      the assembler again, so the two can disagree

**The root came in under the 1,500 lines I guessed it had to stay below**, and finished at 1,457
with everything the second rung asked of it. A line of `.l0` is one wasm instruction, so that is
about what a 400-line C program would be; the expansion factor for writing in assembly is roughly
three.

## What L1 actually is

Enough of a Lisp to write programs in, and it is tested by running 26 of them (`bootstrap/ts/l1_test.ts`):

- fixnums, symbols interned into one list, pairs, and a one-bit tag telling immediates from objects;
- a reader for atoms, negative numbers and nested lists;
- `quote`, `if`, `fn`, `def`, and application;
- closures that capture their environment, with a global fallback so recursion works;
- `+ - * < = car cdr cons pair?`;
- a bump allocator that grows the memory rather than running out.

`(def fib (fn (n) (if (< n 2) n (+ (fib (- n 1)) (fib (- n 2)))))) (fib 15)` answers 610.

## Does L1 earn its place?

The whole ladder from cold, nothing cached:

    assemble + compile L1 (hand-written)           9 ms
    L1 runs the L2 compiler on L3's compiler     314 ms
    assemble + compile L3's compiler               6 ms
    L3 compiles L4's compiler                      3 ms
    assemble + compile L4's compiler               8 ms
    L4 compiles a program                          1 ms
                                                 341 ms

**Interpretation is about a hundred times slower and it does not matter**: 314 ms for 452 lines
interpreted, against 3 ms for 1,003 lines compiled. One stage, a third of a second, once per cold
checkout. (An earlier reading of mine said interpreted and compiled were the same speed. That
measurement included building the whole chain, so it was mostly measuring the chain.)

And L1's 1,630 instructions divide like this:

    the reader                 353
    symbols                    138
    objects                     78
    allocation + fixnums        59      -- 628 of substrate
    the evaluator              785
    starting up                145      -- 930 of interpreter
    the demonstration           68

**628 of those you would write anyway.** Any s-expression program written by hand in L0 — including a
hand-written L2 compiler — needs the same reader, the same heap and the same interned symbols. The
interpreter proper is the other ~930, and what it buys is that L2's compiler is **200 lines of Lisp**
rather than assembly.

Written directly in L0, L2's compiler would be those same 628 instructions plus 200 lines of dense
Lisp expanded into assembly — one to two thousand more. So the hand-written budget is break-even at
best, for a single-purpose program instead of a general-purpose interpreter.

**The real reason L1 is there is the reader.** 353 instructions, and they are the last parser anyone
has to write by hand: every rung above receives a tree.

## Which makes L2 the rung worth questioning, not L1

L2 buys a *compiled* language to write L3's compiler in. At these sizes that is worth 3 ms against
700 ms, which is nothing — so its real justification is that writing a C-family lexer and a
recursive-descent parser in a Lisp with no arrays, no structs and no local mutation is unpleasant.
Tokens would be a list walked by a global cursor.

That is a fair reason and a soft one. L2 is 200 lines and a spec, and it could be dropped by writing
L3's compiler in L1 directly. It is not being dropped, because it exists and works and each rung is
one more place a mistake is caught early — but it should be described as a convenience rung rather
than a necessary one, and now it is.

## What the second rung proved, and what it cost

`bootstrap/ts/l2_test.ts` runs ten wx programs through the whole ladder — nothing stubbed, no step skipped.
`(fib 20)` answers 6765; a `while` inside a `while` counts to 12; `store8`/`load8` move bytes.

Four bugs, and three of them say something.

**sx had no `do`.** A function body is a single expression, so until this there was no way for a
function to both act and answer. It was invisible while L1 only evaluated arithmetic.

**I wrote 33 of the compiler's equality tests as `==`.** That is wx's spelling; sx spells it `=`.
The two languages are both s-expressions and look alike, and the compiler is written in one and
about the other, so every line has to be read twice. This will get worse at L2, not better.

**`comp-while` kept its two labels in globals**, and `def` in wac-L1 binds globally — so a `while`
inside a `while` rebound the outer one's labels, and the outer `br`, emitted *after* the body,
branched into the inner loop. The generated assembly looks entirely reasonable. A test found it; no
amount of reading would have.

**A missing parenthesis in a 28-way `if` chain did not fail.** The reader simply swallowed the
expression that followed the file, so the program ran and answered a plausible number. That is the
real cost of s-expression syntax at a rung with no diagnostics: unbalanced input is not an error,
it is a different program.

## Two that only a typed rung could have

**Type index 0 is `i32`, and the slot has to be *taken* rather than assumed.** Nothing reserved it,
so the first struct registered became index 0 — and `valtype(0)` reads a 0 as the number type, so
every local of that struct was declared `i32`. The module was refused for a type mismatch the
compiler believed could not happen, and the generated assembly looked entirely correct until the
`local.set` line.

**A slot's type has to outlive its name.** A block pops the name table on the way out, and the
function header is written *afterwards*, because wasm wants locals declared before the body. So by
the time the header needed the types, scope had thrown them away. Slots are never popped; names are.
The fix is a second table indexed by slot, which is four lines and the sort of thing that reads as
redundancy until you know why.

## The bug that keeps happening

Three times now something has worked **by luck rather than by rule**, and each was invisible until
an unrelated change removed the coincidence:

1. the allocator kept the heap word-aligned because every allocation happened to be twelve bytes,
   until a symbol of odd length arrived;
2. `;` comments were read as code and evaluated, harmlessly, until one of them contained a
   parenthesis;
3. `//` comments were not comments at all, so every comment line in `bootstrap/boot/l3.l2` became a symbol
   in the program list and `comp-top` called `car` on it.

The third is the one worth the note. wac-L3's *own* syntax uses `//`, so writing its compiler in wac-L2
meant writing `//` out of habit — and sx, two rungs down, had never heard of it. **The rungs look
alike and are not alike**, and that is the tax the ladder charges: the same 33 lines that made me
write `==` where sx wanted `=` made me write `//` where it wanted `;`. sx takes both now.

## What L1 still is not

Everything the second rung needed has been added. What is left is what a *third* rung would want:

- **strings**, as distinct from symbols. Every fixed word wx emits is a quoted symbol, which works
  because the reader's only delimiters are whitespace and parentheses — but a lexer for wac needs
  literals it did not intern, and building them a byte at a time is where a typo hides for a week.
- **tail calls.** Recursion consumes the wasm stack, so a long list is a deep stack. wx's compiler
  recurses over the program tree and is fine; a lexer looping over 37,000 lines may not be.
- **any error reporting at all.** A malformed program traps, and a trap in wasm carries no message —
  which is how three of the four bugs below presented.

## The bugs, because they say what writing this is like

**An `if` given a result type whose else-arm produces nothing.** Made twice, in `.l0`. wasm reports
it as *expected 1 element on the stack for fallthru* against a function **index**, so finding it
means counting `func` lines. A map from byte offsets back to source lines is the obvious next tool.

**The tag bit needs an alignment invariant, and the allocator was not keeping it.** An object's
value is its address plus one, so addresses must be even. A symbol allocates `12 + len` bytes, so an
odd-length name leaves the heap odd, the next object's value comes out even, and `$is_fix` calls it a
fixnum. `$alloc` rounds up to a word now.

**Stage one could not have caught that one.** It read `(1 2 (3 4) 5)` — a program with no symbols in
it, so every allocation was a 12-byte pair and the heap stayed aligned by luck. The bug appeared the
moment the evaluator interned `+`. A staged test that passes tells you the stage passed, and nothing
else.

## The thing worth building, which is not a smaller compiler

The line counts above answer a question about cost, and cost is not the reason to do this. Here is
the reason.

**An interpreter is a prompt, and a compiler can never be one.** `bootstrap/ts/repl.ts` is a working wac-L1 REPL:
definitions survive between lines, `(fact 10)` answers 3628800, a list prints as `(1 2 3 4)` and an
improper one as `(1 . 2)`. That came free — `$eval_at` is `$run_at` without the reset, nine lines —
because the rung underneath it interprets rather than compiles.

wac has no prompt and structurally cannot get one. It is a compiler, so the only way to ask what an
expression does is to build a module and run it. **If the last rung interprets wac instead of
compiling it, `wac repl` falls out of the bootstrap** — and so does a stepper, and so does anything
that wants to stop in the middle and look.

And the whole chain has no imports and no host. Every rung is a pure wasm module, which means the
entire bootstrap — 1,457 readable instructions at the bottom, a live wac prompt at the top — fits in
a browser tab, offline. The 19,499-line TypeScript path cannot do that at any size.

**The printer lives outside.** L1 has none and needs none: the object layout is four words, written
at the top of `bootstrap/boot/l1.l0`, so the host walks the heap and renders. A hundred instructions saved in
the rung that is hardest to write, spent on nothing.

## How big is L5, against L4?

**Roughly fifteen to twenty times.** L4's compiler is 1,003 lines; L5's is somewhere around
16,000-22,000.

The estimate comes from the reference compiler, which is the same program in TypeScript. The parts
L5 needs:

    lex             366
    parse         1,734
    resolve       2,571
    instance        275
    emitFunc      3,539
    typecheck    ~1,500     -- inference only; wasm validation is the checker
    bindgen       1,062
                 11,047 lines of TypeScript

`wasmBuildBin`'s 3,010 lines are **not** on the list, because L5 emits wac-L0 text and the assembler
does the encoding. That is the ladder's one structural saving and it is a seventh of the program.
Expanding TypeScript into wac-L4 at 1.5-2x gives the range above.

## Why the ratio breaks at L5

Every rung so far has cost about 2.2x the one below - 200, 452, 1,003. L5 does not, and the reason
is not that it is one more feature.

**L0 through L4 are languages we designed. L5 is a language we are handed.** It has to accept
whatever `packages/wacc/src` happens to use, and that is 34,494 lines of existing wac:

| what it uses | count | how hard for L5 |
|---|---:|---|
| `for` loops | 1,013 | desugars to `while` |
| casts `as` / `as!` | 969 | one instruction per type pair, plus a check for `as!` |
| `i64`/`u32`/`u8`... | 910 | a numeric lattice; every operator picks signed or unsigned |
| string concatenation | 659 | a real string type with a runtime concat |
| ternary | 450 | desugars to `if` |
| `const` | 331 | parse and ignore - L5 has no checker |
| generic instantiations | 283 | **monomorphisation** |
| `match` | 254 | L4 already has it |
| `trap` | 90 | one instruction |
| imports | 44 | a module graph |

**The difficulty is concentrated, not spread.** Around 2,000 of those occurrences are desugaring -
maybe 150 lines of compiler between them. The breadth is in integers and casts, which is tedious and
mechanical. The one genuinely hard feature is **generics**: substitution through a generic body,
emission per instantiation, name mangling, and a fixpoint, because an instance's body can name
instances that do not exist yet. That is `resolve` + `instance` + a slice of `emitFunc` - call it
3,000 of the 11,000.

## The encouraging measurement

**wacc declares no generic types of its own.** All 283 instantiations are of about six types that
come from `core/` and `std/` - `Box`, `Vec`, `Pending`, `Option`, `Map`, `Cell`.

That makes the lever smaller than "rewrite wacc". Monomorphic versions of six library types would
remove the ladder's single most expensive feature, and they are our code.

It is still probably the wrong trade: it means adding redundancy to `core/` for every other user in
order to serve the bootstrap, in a repository whose stated rule is to delete what nothing needs. But
it is worth knowing that the choice is six types rather than thirty-four thousand lines.

## What this does not settle

L1 exists and cost 167 lines. **The open question is now L2: a compiler for wac's C-family syntax,
written in wac-L2.** That one has to lex and parse real text, keep a symbol table, and emit for structs
and generics — and it is the rung that has to compile `packages/wacc/src`.

Two things L2 would want first, and both are cheap:

- **string literals**, in wac-L2 and in wac-L1's reader. A lexer needs keyword tables, and building them a
  byte at a time from arithmetic is the kind of code that hides a typo for a week.
- **a `data` directive**, so those tables are in the module rather than constructed at startup.

L2 deliberately has no scopes — local names are unique per function — and that is fine for 167 lines
and questionable for three thousand. It is the first thing I would expect to have to add.

Two other things stay unanswered and should not be forgotten:

- **retiring the reference retires the differential**, which `design/lang/0003` calls the instrument
  that has caught most of this year's defects in wac. A last rung that genuinely implements the
  subset wacc is written in could take that role; a minimum-viable one could not.
- **an interpreted rung is slow**, and how slow has not been measured. It runs once per cold
  checkout, so the bar is patience rather than performance — but `fib 15` is not evidence about
  compiling 37,000 lines.

## Both of those are now settled

**The differential exists, and it is a better one than the reference gave.** A ladder that ends in
a real wacc can be its own oracle: wac-L5 builds wacc (round 0), round 0 builds wacc again from the
same source (round 1), and the two compile the corpus and are compared byte for byte. The argument
is a fixed point — if wac-L5 were correct then round 0 would be a correct wacc, so round 1 would be
one too, and the two could not disagree. All 296 corpus entry points now agree.

It needs no expectations at all, which the reference differential also did not; what it adds is
that both sides are *derived*, so nothing has to be maintained by hand as wac changes.

It found exactly one defect, which is the point: five entry points differed, all by four bytes, all
one instruction — `i64.const -1` against `i64.const 4294967295`. The threshold for a wide integer
literal was thirty-two *bits* and should have been an i32's *range*. `4294967295` is both the
all-ones u32 mask and an ordinary i64, and wacc writes it against an i64.

**And the interpreted rung is not slow enough to matter.** `fib 15` was never evidence; compiling
37,873 lines is. Cold, the whole chain builds and compiles wacc in about two seconds, and the wacc
it builds compiles wacc again in three quarters of one. The bar was patience and it is not being
tested.

## The bugs that only running the output could find

Six, and they are the useful half of this repository. Each produced a module that assembled, that
the engine accepted, and that was wrong.

- **A `match`'s default arm went where it was written.** `else:` has no tag test, so wherever its
  code sits is where the match stops — and wacc's own `typeOfE` writes `match (callee.kind) {
  else: … case Member(…): … }`. Every method call took the default and came back untyped, so
  `.len()` on an array was declined by a compiler that had read the arm for it and jumped over it.
  Sixteen spec cases turned on this one.
- **An integer literal wider than a token's value.** wacc writes `4503599627370496` — two to the
  fifty-second. Wrapped to an i32 it is zero, so every double the built compiler emitted came out
  denormal: `return 1.5;` answered 1.6688e-308. The checked casts and the float remainders were the
  same bug wearing different clothes.
- **String escapes were not resolved.** `"\n"` was a backslash and an n, so wacc's linker put a
  backslash between two files, and the module built from the joined text was empty. That reached me
  as *"emitFiles answers a bare module while emit works"*, with nothing about escapes in it.
- **A sized array held nulls**, where wac says `Point[10]()` is ten distinct Points and
  `string[3]()` is three empty strings. A program that validates, runs, and traps on the first read.
- **`string` was `u8[]`.** Same bytes, same wasm type, and they differ in the one place the corpus
  leans on: `b[i]` is the byte and `s[i]` is the one-character string.
- **`emitn(-2147483648)` printed its last digit as `(`.** Negating the most negative i32 overflows
  back to itself, so `48 + n % 10` adds a negative remainder. All three rungs that print a number
  had it, written the same way each time.

The instrument mattered more than the reading in every case. The step that changed things was
making the probe *call* what the built compiler produced and compare a value: `f` being exported is
not `f` being right, and a method lookup that falls back to matching on name alone emits a module
that runs and answers the wrong thing.

## The same fixed point as the TypeScript bootstrap, and what each costs

The ladder does not merely produce *a* wacc — it produces *the* wacc.

    W0  wacc by wac-L5           661,626 bytes
    X0  wacc by the reference    884,803 bytes
    W1  wacc by W0               681,417 bytes
    X1  wacc by X0               681,417 bytes     <- the same bytes

W0 and X0 differ by 223,177 bytes and must: they are one source compiled by two entirely different
compilers. What matters is the next step. Both are *wacc*, so if each is faithful they compile that
source the same way — and they do, exactly. `W1 == W2` and `X1 == X2` as well, so both paths are at
a fixed point and it is the same one.

That is the property that makes a ladder a *replacement* for a reference rather than a second
opinion, and `bootstrap/ts/same_fixed_point.ts` is the test.

**On speed.** The interpreted rung was the thing to worry about and it is not the thing to worry
about. In one cold process:

      410 ms   build the ladder — l1.l0 assembled, then L2, L3, L4, L5 in turn
      104 ms   flatten wacc's 37,873 lines
      361 ms   wac-L5 compiles it, to 183,862 lines of wac-L0
      280 ms   assemble that to 659,236 bytes
    -------
    1,159 ms   total, cold, from an interpreter written in assembly text

Against that, the TypeScript reference compiles the same source in **679 ms**, and either wacc
compiles it in about **800 ms**. So the whole ladder — five compilers built from nothing, then the
work — costs about 1.6x what the reference costs for the work alone; and wac-L5 by itself does the
job in 641 ms, which is *faster* than the reference doing the same job.

The 410 ms that builds the ladder is paid once per process and buys the thing the reference
charges 19,499 lines of trusted code for.

## What the corpus numbers do and do not say

Two numbers in this repository look alike and mean different things, and I conflated them for a
while.

**296 of 296** is the *corpus differential*: `bootstrap/ts/corpus_differential.ts` compiles every entry point
with the wacc wac-L5 built and with the wacc that one built, and the two agree byte for byte. Both
sides of that comparison are wacc. It is a strong statement — it is the fixed-point argument, and
it is what caught the `i64.const -1` literal bug — but it is a statement about the *compiler
wac-L5 produced*, not about wac-L5.

**81 of 296** is what wac-L5 itself compiles and validates. That is the number to quote when the
question is how much of wac this rung covers.

The gap is mostly one feature. Of the 213 entry points wac-L5 refuses, 44 stop at a `[` and 40 at
an `=` — both the shape of a module-level `const`, which is not consumed at the top level and so
shifts the declaration by a token. There are **251 such declarations in the corpus and none in
wacc or `core`**, which is the whole reason it survived: the ladder was built to compile one
program, and that program does not use it.

Left as it is, deliberately. wac-L5 is the minimum that compiles wacc, and a feature added here has
to be paid for in the rung below as well.

## The TypeScript, excluding tests

    the bootstrap path                       1,269 lines    965 without comments
      assemble.ts       the wac-L0 assembler   832
      l5.ts             driver and flattener   262
      l2.ts l3.ts l4.ts drivers                175
    hand-run helpers                           194 lines    141
      repl.ts run.ts
    instruments                              1,209 lines    933
                                             ---------
                                             2,672 lines  2,039

Only the first group can produce a wrong artefact. The instruments measure and the helpers are for
reading with, so a mistake in either shows up as a bad reading rather than a bad compiler — which
is the same reason `against_real_wac.ts` is deliberately not a test.

**Within the bootstrap path, 191 lines are a linker.** `bootstrap/ts/l5.ts` is 262 lines of which only 51
drive the compiler — bytes in at 16 MiB, text out at 4 MiB. The rest resolves specifiers,
concatenates modules and renames declarations that collide, which is the work `import` would have
done if wac-L5 implemented it. That is what the shortcut costs, and it is TypeScript that has to be
trusted, so it belongs in the same column as the assembler rather than the same column as the
tests.

## How much code is in each rung

                                        lines    code   comment
    wac-L0  the format                    207       —            spec/l0.md
              assembler, TypeScript       832     661       20%
              assembler, Rust           1,212   1,067       11%
    wac-L1  interpreter, hand-written   1,804   1,630        9%
    wac-L2  compiler, in wac-L1           298     200       32%
    wac-L3  compiler, in wac-L2           583     458       21%
    wac-L4  compiler, in wac-L3         1,326   1,079       18%
    wac-L5  compiler, in wac-L4         3,795   3,100       18%
                                        9,850   8,195

Against the reference, like for like: 19,499 lines and 13,009 of code. So the ladder is 63% of it
by code rather than the 50% the raw line counts suggest — the reference is more heavily commented
than this table's average, and comparing totals flattered us.

**Each compiler is about two and a half times the one below**: 200, 458, 1,079, 3,100. That ratio
is the shape of the thing. A rung buys exactly enough language to make writing the next one
affordable, and if the ratio were much larger the ladder would need more rungs, and if it were much
smaller it would need fewer.

L1 is 9% comment because it is assembly — one instruction per line, and a comment per instruction
would double the file. L2 is 32% because it is the smallest file and has the most to explain per
line: it is the first thing written in a language nobody has ever written anything in.

**wac-L5 is 38% of the ladder on its own**, and that is the one rung whose size was not a choice:
every other rung's language was picked to make the next one cheap, and L5's was handed to us by
whatever `packages/wacc/src` happens to be written in.

Inside it, four sections are 83% of the code:

    declarations    978      structs, enums, methods, templates, the emit pass
    expressions     835      precedence, calls, the builtin methods, casts
    statements      382      if, while, for, match, return, assignment
    types           373      the type table, arrays, funcrefs, instantiation
    the lexer       159
    everything else 373

The lexer being 159 lines is the part worth noticing. So is generics: the section dedicated to
templates is 57 lines of code, because monomorphisation here is "record the token index, re-read
the body with the letters bound" — and the parser's entire state is one integer into the token
array, so rewinding is free. The expensive part of generics in a normal compiler is having
somewhere to put a partially-instantiated type; there is nowhere to put anything here, so there is
nothing to put.

## The ladder under a second host

`rust-ladder/` runs every rung through V8 embedded in Rust, against `ts/` running the same rungs
through Deno. They produce identical wac-L0 — on a small program, and on the 37,873 lines of wacc,
where all 183,861 lines of output match.

    compiling wacc, the whole ladder cold
      Rust on V8       722 ms
      Deno             753 ms

Close enough to be the same measurement, which is the expected answer: both are V8 running the same
five compiled modules, and the host only moves bytes in and out.

**The one line of JavaScript is `new WebAssembly.Instance`.** V8's C++ embedding API exposes no
equivalent — instantiation is a JS constructor — so the Rust host evaluates that one expression and
does everything else itself: the bytes go in through the module's own linear memory, and the answer
comes back out of it.

Three seams, and they are not the same shape:

    wac-L1   source at 8192, `run_at(at)` answers an *address*, text runs to a NUL
    wac-L3   source at SRC, `compile(src, out)` answers a *length*
    wac-L4   the same, same addresses
    wac-L5   the same, different addresses — its buffers are much larger

wac-L2 has no seam of its own: it is a wac-L1 program, so it is driven by wrapping the compiler and
the program together in one s-expression and handing that to the interpreter.

**The memory pointer has to be taken after every call, not before.** Growing a wasm memory detaches
the `ArrayBuffer` a caller was holding, and `$alloc` in the interpreter grows it — so a pointer
read before the call is dangling by the time there is anything to read through it. Both hosts have
a comment about this; the TypeScript one was written after being caught by it.

## Two benchmarks, and what they say about where the time goes

`bootstrap/ts/bench.ts` and `ladder --bench` print the same table for the same input, so the two hosts can be
read side by side. Compiling wacc — 37,873 lines in, 183,861 lines of wac-L0 out, 659,236 bytes of
wasm — three cold runs each:

                            rust, v8 embedded        deno
    build the ladder            324–329 ms        370–371 ms
    compile to wac-L0           358–369 ms        353–416 ms
    assemble to wasm             85–98  ms        258–287 ms
                              -----------       -----------
    total                       771–795 ms       991–1073 ms

**The compile step is the same on both, and that is the result.** It is the only phase that is
entirely wasm — the same five modules, running under the same engine, with the host doing nothing
but moving bytes in and out. If the two columns had differed there, something would have been
wrong with a host rather than with a rung.

**The whole difference is the assembler**, which is the one part of the pipeline written in the
host's own language: 85 ms of Rust against 259 ms of TypeScript for the identical 659,236 bytes,
about three to one. `build the ladder` inherits a smaller version of the same gap because it
assembles five modules on the way up.

So the benchmark measures what it should: a ladder whose rungs are wasm costs the same wherever it
runs, and the only place the host shows up is the one file the host wrote. That is the same
property the two-assembler differential is for, arriving from the other direction — the assembler
is the piece that had to be implemented twice *because* it is the piece that is not derived.

**Assembling is a third of the work and was invisible until now.** The earlier figures in these
notes stopped at wac-L0 text, which flattered the total by a quarter under Rust and by a third
under Deno: 183,861 lines of text still have to become 659,236 bytes, and somebody has to do it.
