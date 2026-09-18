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

## What checks this

Nothing, in the sense the rest of vision means it — no suite reads these pages. But
`tools/visiongrammar.sh` parses every `.wac` under `vision/` with today's compiler and lists what it
refuses, and `tools/specparse.ts` parses them against `vision/vibes/GRAMMAR.ebnf`. Both will have
plenty to say about this directory, and that output is the point rather than a failure: it is the
distance between the language described here and the one that exists.
