# wac-1 — structs, arrays, and wasm GC

wac-1 is wac-0 plus a **type system**, and that is the whole of the difference. wac-0's compiler
never had to know what an expression was, because there was one type; here every expression answers
a type, because `p.x` has to know which struct to read from and a local of struct type has to be
declared `refnull $s1` rather than `i32`.

    struct Node { i32 value; Node[] kids; }

    i32 total(Node n) {
      i32 sum = n.value;
      i32 i = 0;
      while (i < n.kids.len()) {
        sum = sum + total(n.kids[i]);
        i = i + 1;
      }
      return sum;
    }

## What is in v1

Everything wac-0 had, and:

- `struct Name { T field; … }`, constructed positionally as `Name(a, b)` and read as `p.field`;
- assignment to a field, `p.field = v`, and through a chain, `a.b.c = v`;
- arrays: the type `T[]`, construction `T[n]()`, indexing `xs[i]`, assignment `xs[i] = v`,
  and `xs.len()`;
- **a struct may name itself, or one declared later**, which is what `Node[] kids` needs;
- `null`, and `isnull(x)` to test for it.

**`isnull(x)`, not `x == null`.** `==` emits `i32.eq`, which is a type error on two references —
wasm spells reference comparison `ref.eq` and null-testing `ref.is_null`, and they are not the same
instruction. A rung with no type checker cannot notice the difference, so it does not get to offer a
spelling that hides it.

## It is wasm GC, and that is the point

Structs and arrays are engine types, not linear memory. There is no allocator, no layout
arithmetic, no `free`, and no way to read a field of the wrong type — `struct.new` and
`array.new_default` do the work a rung this size would otherwise have had to build first.

That is also why `.wax` grew a type section with recursive groups. `struct Node { Node[] kids; }`
needs the struct and the array in the same group, because outside one a type may only name types
already defined.

## Enums, match and methods

    enum Expr { Num(i32 v); Add(Expr a, Expr b); Neg(Expr a); }

    i32 eval(Expr e) {
      match (e) {
        case Num(v): { return v; }
        case Add(a, b): { return eval(a) + eval(b); }
        case Neg(a): { return 0 - eval(a); }
      }
      return 0;
    }

**An enum is one struct and a payload**: `struct { i32 tag; anyref payload }`, with a separate
nameless struct per variant holding its fields. That needs no subtyping — which `.wax` does not
have — and a `match` becomes an integer compare on the tag and a `ref.cast` inside the arm, both of
which the engine does.

`match` is a **statement**, so an arm may `return` and none has to answer anything. There is no
exhaustiveness check: a value whose tag matches no arm falls out of the match, which is what wac-1
does everywhere else it has no type checker. An arm's bindings are locals scoped to the arm.

Variant names are **global**, as they are in the languages that spell them this way. Two enums with
a `None` apiece would collide, and a rung this size is allowed to say so by not having a rule.

**A method is a function whose name is its owner's and its own, joined.** `p.sum()` resolves at
compile time to `call $Point_sum` — no vtable, no receiver in the call, because wac-1 has no
subtyping to make it ambiguous. `this` is the first parameter and has the owner's type. Methods are
not exported, because their names are not ones a caller outside the module could have written.

## Why there is no type checker, and why one is not missing

wac-1 tracks types to *pick an instruction* — which struct to read a field from, whether a local is
`i32` or `refnull $s1`. It never checks that the types agree, and it does not need to: **wasm
validation is the checker, and it is total.**

Every wac-level type error that could be constructed is refused before the program runs, by one of
two things:

| the mistake | who refuses it |
|---|---|
| arithmetic on a struct | the engine — `i32.add[0] expected i32` |
| an `i32` passed where a struct is wanted | the engine — `call[0] expected …` |
| two structs of the same shape, swapped | the engine — they are distinct wasm types, never merged |
| a field that does not exist | the compiler, which emits a refusal marker |
| an `i32` indexed as an array | the compiler |
| a `case` naming no variant | the compiler |
| a `case` binding more fields than the variant has | the engine — invalid field index |

So a wac-1 program that assembles and validates cannot have a type error in it. What a checker would
buy is a better *message*: the engine names a wasm type and a function index, and points at
generated assembly rather than at a line of source.

That matters less here than anywhere else in this ladder. The only program that will ever be written
in wac-1 is the next rung's compiler, and every rung below has exactly the same absence — sx traps
with no message at all. A checker is a rung's worth of work to improve a diagnostic for one reader.

**What was actually missing was smaller**: the compiler's own lookups answering `-1` and carrying on.
A `case` naming no variant used to read `VARS - 16`, get zeros, and cast to type 0 — which is `i32`
and emits no `type` directive, so the assembler happened to refuse it. That is the fourth thing here
that worked by coincidence, and the first one found before it cost anything.

## What is left

`T?`, and generics. The second is the real question for the ladder rather than for the language: the
rung above this one is wac itself, and either wac-1 gains generics or `packages/wacc/src` stops using
them.

Nothing here is type-*checked*. The compiler tracks types to decide which instruction to emit, and
believes what it is told; a wrong one reaches the assembler and then the engine, which refuses it
with a message about a wasm type rather than a wac one. A checker is a different program, and mixing
it in is how a rung stops being finishable.

## How it is compiled

One pass, no syntax tree, as in wac-0 — with two additions that the types force.

**A pre-pass collects every struct and every function signature**, so a call to a function declared
later knows its return type and a field of a struct declared later resolves. It walks the tokens and
skips bodies by matching braces.

**The `type` directives are emitted into their own buffer and appended at the end.** `.wax` takes
directives in any order, so an array type first named inside the last function needs no second
pre-pass to discover it.

Two things that had to be true and were not, at first:

- **type index 0 is `i32`, and the slot has to be taken rather than assumed.** Without a reserved
  entry the first struct registered is index 0, every local of that type is emitted as `i32`, and
  the module is refused for a mismatch the compiler believes cannot happen.
- **a slot's type has to outlive its name.** A block pops the name table on the way out, and the
  function header — which is written afterwards, because wasm wants locals declared before the body
  — is exactly where those types are needed.
