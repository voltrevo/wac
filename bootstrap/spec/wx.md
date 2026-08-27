# wx — the first rung, and why it is not a subset of wac

`wx` is the language the sx interpreter compiles. Its job is to be a decent systems language to
write the *next* rung in, and nothing more.

## Why not wac syntax here

The obvious plan is to make every rung a larger subset of wac, so the ladder converges on the real
language. That is the wrong place to start, for one reason: **wac's syntax needs a lexer and a
parser, and writing those in an interpreted Lisp costs more than it buys.**

s-expressions cost nothing, because sx's reader already is the parser — a wx compiler receives a
list structure and never sees a character. That saves the whole front end at the rung where code is
most expensive to write, and it moves the C-family parser to L2, where it can be written in a real
language with locals, loops and a heap.

So the split is:

    root   sx        an interpreter, hand-written in .wax
    L1     wx        s-expressions, compiled by a program written *in sx*
    L2     wac       C-family syntax, compiled by a program written *in wx*

Each rung buys exactly one thing. sx buys "a language at all". wx buys "a language you can write a
real compiler in". L2 buys the syntax and type system that `packages/wacc/src` is written in.

## Why the target is `.wax` text

A wx compiler emits **assembly text**, not a wasm binary. LEB128, section framing, index assignment
and type deduplication are already written twice and tested against each other; making every rung
re-implement them is work with a known answer and a new place to be wrong.

That keeps the assembler in the trust root, which it was going to be anyway — it is the thing that
turns readable text into bytes, and it is dual-implemented for exactly that reason.

## The language

Everything is an `i32`. There is one memory, byte-addressed. There are no structs, no strings and no
types beyond the word — a struct in wx is an offset you add, the way it is in C with macros. All of
that is deliberate: wx is not meant to be pleasant, it is meant to be enough.

**Every form is an expression and produces a value.** A statement is an expression whose value is
dropped. That removes the statement/expression distinction from the compiler, which in wasm is the
difference between `if $l -> i32` and `if $l ->` and is otherwise decided by context.

    (fn name ((p i32) ...) i32 body ...)   a function; the body is an implicit `do`
    (global name value)                    a mutable global, initialised to a literal
    (export name)                          export a function under its own name
    (memory pages)                         the initial memory size

    (do e ...)                             evaluate in order, answer the last
    (let name e)                           declare a local, set it, answer the value
    (set name e)                           assign a local or global
    (if c a b)                             both arms required, because every form has a value
    (while c body ...)                     answers 0
    (return e)

    (+ a b) (- a b) (* a b) (/ a b) (% a b)
    (& a b) (| a b) (^ a b) (<< a b) (>> a b)
    (< a b) (> a b) (<= a b) (>= a b) (== a b) (!= a b)
    (not a)

    (load a)      (store a v)              a word
    (load8 a)     (store8 a v)             a byte
    (name arg ...)                         a call

**Local names are unique within a function**, including across nested `let`s. The compiler collects
them in one pre-pass and declares them all at the top, because `.wax` wants locals before
instructions — and renaming shadowed bindings is a symbol table wx does not need to have.

## What is deliberately absent

No closures, no recursion over the heap, no garbage collector, no type checking beyond arity. A wx
program that stores a word at an odd address gets what it asked for. The rung above is a compiler,
which is a program that reads a tree, walks tables and appends bytes — none of which needs more
language than this.

The one thing that will hurt is **the absence of any diagnostic**: a wx program with a typo compiles
to a `.wax` file that the assembler refuses, naming a line of generated assembly. That is survivable
for one program written once, and is the strongest argument for keeping L2 the only thing ever
written in wx.
