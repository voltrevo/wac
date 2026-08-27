# wac-0 — the first rung that looks like wac

The point of wac-0 is the **syntax**. Everything above it is a superset, so this is where the lexer
and the recursive-descent parser get written, once, in wx — and every rung above inherits them by
porting rather than rewriting.

    i32 add(i32 a, i32 b) { return a + b; }

    i32 fib(i32 n) {
      if (n < 2) { return n; }
      return fib(n - 1) + fib(n - 2);
    }

    i32 main() {
      i32 total = 0;
      i32 i = 0;
      while (i < 10) { total = total + i; i = i + 1; }
      return total;
    }

## What is in v1

- functions, all `i32`, with typed parameters and a required return type;
- `i32 name = expr;` declarations, with proper **shadowing** — an inner block may reuse a name;
- `return`, `if`/`else`, `while`, blocks;
- `+ - * / %`, `== != < <= > >=`, unary `-` and `!`, parentheses, calls, and assignment;
- `//` comments;
- one function may call another declared later in the file;
- **globals**: `i32 name = 7;` at the top level, mutable, initialised to a literal;
- **memory**: `load(a)`, `store(a, v)`, `load8(a)`, `store8(a, v)`, spelled as calls so the lexer
  needs no new tokens and the parser no new syntax;
- **string literals**: `"text"` is the address of a length-prefixed block, exactly as in wx, so
  `load(s)` is its length and `load8(s + 4 + i)` its i'th byte — literals without a string type.

Those last three are not decoration. They are what a language needs before a compiler can be written
in it, which is the only thing wac-0 is for.

Every function is exported under its own name. There is no `export` keyword because there is nothing
a program would want to keep private from its only caller.

## What is not, and where it goes

`struct`, arrays, `enum`/`match`, methods, `T?` and generics are all absent, and all of them belong
to **wac-1** — which is written in wac-0 and is the last intermediate before wac itself.

There is no type checking, because there is one type. That changes the moment structs land, and it
is the honest reason to keep them out of v1: a type checker is a different program from a parser and
mixing them in one rung is how a rung stops being finishable.

## How it is compiled

**One pass, no syntax tree.** The parser emits `.wax` as it goes, which suits wasm exactly —
expressions are parsed by precedence climbing and a stack machine wants operands before operators, so
the natural order of a recursive-descent parser is already the order of the output. An AST would be a
tree to allocate, a set of node kinds to encode by hand, and a second walk, all in a language with no
structs.

The one thing wasm asks for that a single pass cannot give is **locals declared before the body**, and
they are only known once the body has been read. So a function body is emitted into a scratch buffer,
and the header, the parameters and the local declarations are written in front of it afterwards.

Shadowing costs nothing here: every declaration takes a fresh wasm local index, and only the *name
table* is popped at the end of a block. Two `i32 x` in sibling blocks are two indices, which is what
lets wac-0 have scopes where wx does not.
