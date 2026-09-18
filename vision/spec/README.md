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

    values.wac      primitives, literals, defaults, construction
    variables.wac   locals, module constants, and what `const` binds
    casts.wac       the four operators, chosen by what the conversion costs
    operators.wac   what each takes, and where one is refused
    control.wac     branching, loops, `switch`, the ternary's type, `matches`, `defer`
    functions.wac   parameters, `const` on one, capability, return paths
    funcrefs.wac    a function as a value, a method as a value, a lambda
    generics.wac    letters, the angle-bracket rule, where a construction is resolved
    types.wac       structs, construction, methods, `const`, inheritance, dispatch, identity
    naming.wac      what may collide, what may shadow, keywords in a name position
    nullable.wac    `T?`, `T??`, the forced unwrap, `?.` and `??`
    arrays.wac      construction, access, bulk moves, packed and nullable elements
    strings.wac     UTF-8 bytes, escapes, interpolation, and content comparison
    tuples.wac      a fixed-length heterogeneous type, and the variadic built on it
    enums.wac       variants, matching, narrowing, `Result`, `try`
    coretypes.wac   sketches of the types the other files lean on
    async.wac       tickets, the machine underneath, and the two ways to drive one
    typelogic.wac   `typeref`, `type(…)`, and the `static_` family
    markup.wac      a tree of ordinary values, written as tags
    imports.wac     the four kinds of specifier, and what crosses a file boundary
    bindgen.wac     the host boundary: what crosses, as what, and what does not
    program.wac     `Sys`, what `main` answers, and when a program is finished
    diagnostics.wac what a refusal looks like, and the wording of the common ones
    examples.wac    two whole programs — a growable buffer and a linked list

It is meant to replace `spec/spec/` rather than summarise it, with two exceptions. `wapy`, the
indentation surface, is not covered here at all. And `grammar.md` has no equivalent: a grammar is
the one thing that cannot be written as source in the language it describes —
`vision/vibes/GRAMMAR.ebnf` is the draft of that.

`spec/spec/buffer.md` and `spec/spec/linkedlist.md` both say they are examples rather than language;
both are in `examples.wac`.

## How these were checked

Each was compiled with today's `wacc` and every complaint attributed to a known vision addition. An
unattributable complaint is a mistake in the file, and that is the whole of the method — it caught a
lossy cast written as `as`, a redundant cast on a literal that already took its slot's type, empty
bodies on functions that must return, and a method's own type letter that nothing could infer.

`markup.wac` cannot be built that way — `core/html.wac` is not one of the five modules the compiler
carries, so it stops before parsing. `tools/visiongrammar.sh` reaches it anyway, because that pass
strips imports first, and reports one first refusal per file:

    async.wac       expected '=', found ';'      an uninitialised local
    bindgen.wac     found '='                    a field initialiser
    control.wac     expected '=', found 'in'     `for … in`
    coretypes.wac   found 'settled'              `virtual`
    enums.wac       found 'Circle'               an arm without `case`
    examples.wac    found '='                    a field initialiser
    funcrefs.wac    expected '[', found '<'      `fn<…>` rather than `fn[…]`
    functions.wac   expected '=', found 'in'     `for … in`
    generics.wac    found '='                    a field initialiser
    imports.wac     found '='                    a field initialiser
    markup.wac      expected '=', found '-'      a hyphenated attribute
    naming.wac      found '='                    a field initialiser
    nullable.wac    found '='                    a field initialiser
    operators.wac   found '='                    a field initialiser
    program.wac     expected '[', found '<'      `fn<…>`
    tuples.wac      expected ')', found ','      a tuple literal
    typelogic.wac   expected '(', found '='      a `type` alias
    types.wac       found '='                    a field initialiser
    values.wac      found '='                    a field initialiser

Each is an addition vision makes, which is the distance being measured. `arrays.wac`, `casts.wac`,
`diagnostics.wac`, `strings.wac` and `variables.wac` are absent from that list because they have no
refusals at all — everything in them is the language as it stands today.

A file whose first refusal is early hides whatever is behind it, so a file that leans on an addition
in its first lines was also checked with that addition written out the long way. `examples.wac` done
that way reports eight more, all of them the decision that a packed type is an ordinary type: `u8` as
a parameter, and an element read answering `u8` rather than `i32`.

One hit is noise: that pass matches comment text, so the word *static* in an `// ERROR:` line is
reported as though it were code.

## What checks this

Nothing, in the sense the rest of vision means it — no suite reads these pages. But
`tools/visiongrammar.sh` parses every `.wac` under `vision/` with today's compiler and lists what it
refuses, and `tools/specparse.ts` parses them against `vision/vibes/GRAMMAR.ebnf`. Both will have
plenty to say about this directory, and that output is the point rather than a failure: it is the
distance between the language described here and the one that exists.
