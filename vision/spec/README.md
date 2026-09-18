# vision/spec

The language written as wac, rather than as prose about wac.

**Not vetted.** `SHOWCASE.md`, `IDIOMS.md`, `TECHNICAL.md` and `DECISIONS.md` are settled and jointly
reviewed. Nothing in this directory is. It is a first attempt at describing the whole language in one
place — the parts vision has added and the parts that already work — and it will contain mistakes,
guesses, and constructs whose spelling is still open. Read it as a draft and correct it freely.

## The format

Each file is wac source. The prose lives in comments, and as little of it as will do:

```wac
u8 a = 200;
u8 b = 100;

a + b;                // 44 — wraps at 8 bits
a as i32 + b as i32;  // 300
```

`expr; // value` is the preferred form. A block comment is for what code cannot show — a rule about
when something is refused, or why a spelling exists — and a doc comment introduces the function it
sits on.

`// ERROR:` marks code that does not compile, and the line is commented out beneath it. That is
`spec/tour.wac`'s convention, and the refusals are as much of the description as the working lines.

## The files

A file is a grouping rather than a chapter, and they import from each other where a type is worth
sharing. A later test should be able to read almost like the file it tests.

    values.wac      primitives, literals, conversion, defaults, construction
    operators.wac   what each operator takes, and where one is refused
    control.wac     branching, loops, the ternary's type, `matches`, `defer`
    functions.wac   parameters, capability, funcrefs, lambdas
    generics.wac    letters, instantiation, invariance, and the absence of constraints
    types.wac       structs, methods, `const`, inheritance, dispatch, identity
    nullable.wac    `T?`, `T??`, the forced unwrap, `?.` and `??`
    arrays.wac      construction, access, packed and nullable element types
    strings.wac     the one reference that compares by content
    tuples.wac      a fixed-length heterogeneous type, and the variadic built on it
    enums.wac       variants, matching, `Result`, `try`
    async.wac       tickets, the machine underneath, and the two ways to drive one
    typelogic.wac   `typeref`, `type(…)`, and the `static_` family
    markup.wac      a tree of ordinary values, written as tags
    imports.wac     what crosses a file boundary
    program.wac     `Sys`, what `main` answers, and when a program is finished

## How these were checked

Each was compiled with today's `wacc` and every complaint attributed to a known vision addition. An
unattributable complaint is a mistake in the file, and that is the whole of the method — it caught a
lossy cast written as `as`, a redundant cast on a literal that already took its slot's type, empty
bodies on functions that must return, and a method's own type letter that nothing could infer.

`markup.wac` is the exception: `core/html.wac` is not one of the five modules the compiler carries,
so it stops before parsing and nothing there is verified.

## What checks this

Nothing, in the sense the rest of vision means it — no suite reads these pages. But
`tools/visiongrammar.sh` parses every `.wac` under `vision/` with today's compiler and lists what it
refuses, and `tools/specparse.ts` parses them against `vision/vibes/GRAMMAR.ebnf`. Both will have
plenty to say about this directory, and that output is the point rather than a failure: it is the
distance between the language described here and the one that exists.
