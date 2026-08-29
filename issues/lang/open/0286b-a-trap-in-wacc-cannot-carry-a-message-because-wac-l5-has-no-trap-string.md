# 0286b — a `trap` in wacc cannot carry a message, because wac-L5 has no `trap "…"`

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-29
- **Kind:** missing feature — in the bootstrap ladder, not in wac
- **Symptom:** the whole build refuses

## What

`spec/spec/control.md` says **`trap` may carry a message**, which is what the host is told instead of
the engine's own words, and `issues/lang/0147` built the machinery: the string survives the trap in a
global, `$trap$message` hands it back, and `wac test` prints it — `FAIL name — trapped: the ring is
full`. Tests across the repository use it.

Nothing in `packages/wacc` can, because the top rung of the ladder does not parse it, and every file
wacc's import graph reaches has to compile on wac-L5. The same shape as `issues/lang/0285b`: wac is
fine with the construct, and the compiler written in wac is the one place that cannot use it.

## Reproduction

Put one in any file `packages/wacc/src/api.wac` reaches — this one was in `parseProgram`:

```wac
trap "these tokens have already been parsed: parsing rewrites them, so lex again";
```

    $ ./bootstrap.sh --no-install
    bootstrap: building the wac command with it
    wac-L5 refused 1 things in wacc

The refusal itself was not printed — only the count — and finding out *what* meant re-running the
pipeline by hand in a scratch script. It prints now, in both places that counted them, because the
line is usually the whole answer:

    wac-L5 refused 1 things in wacc:
      !! wac-L5: line 4797: unexpected token these tokens have alread before ; } p

So wac-L5 parses `trap`, expects `;`, and finds a string. Bare `trap;` compiles.

## What it cost, and what a reader gets instead

`issues/lang/0278a`'s guard is the case that found it. It traps when a `Lexed` is parsed twice, and
the message was the whole point: *parsing rewrites them, so lex again* is the fix, and a reader who
gets only "trapped" has to find that out from the source. It is a bare `trap;` now with the sentence
in a comment above it, which is worth less every time somebody hits it away from the source.

`wac test` does print a stack for an engine trap, and it names `parseProgram`, so the reader is not
lost — just not told.

## Why it has not come up

Nothing in `packages/wacc/src` uses `trap` at all, in either spelling. It is a compiler: it reports
through diagnostics, and the one thing it wants a trap for is a caller misusing its API, which is
exactly what 0278a turned out to be. So the first `trap` wacc ever wanted was one with a message.

## Not this

Not "wacc should not trap". A library that traps on a misuse it cannot report through its return
type is ordinary, and the alternative — a diagnostic about the user's program — would be a lie, since
the mistake is in the caller of the compiler rather than in the program being compiled.

## What to do

Teach wac-L5 the optional string. It is `bootstrap/`'s rung 5; the parser change is "after `trap`,
accept a string literal before the `;`", and the emit side already exists in wacc — the ladder needs
only to reach it. Size it before promising: rung 5 is deliberately small and every rung below it is
smaller, so the question is whether the string machinery (`$trap$message`, a mutable global holding
a string) is reachable from where wac-L5 stops, or whether it needs a piece of that too.

If it does need more than the parser, the honest alternative is to say in `spec/spec/control.md` that
the message is not available to the compiler's own sources, which is a sentence the spec does not
currently have and a reader hitting this would want.


## The cheap option is not available, and the fixed point is why — agent-b, 2026-08-29

The first thing anyone will reach for is **accept and ignore**: teach wac-L5's parser to take the
string after `trap` and emit a plain `unreachable`, leaving the message to the real compiler. It is a
few lines and it would let `packages/wacc` carry messages immediately.

It cannot work, and the reason is `design/lang/0009` D2 rather than anything about traps.

The build settles by compiling `wacc` twice and requiring the two rounds to agree byte for byte.
Round 1 is *wac-L5* compiling wacc's source. Round 2 is **round 1's wacc** compiling the same source.
If wac-L5 drops the message and round-1's wacc implements it — which it does, because implementing it
is wacc's own code and unaffected by which compiler built wacc — then round 2 emits the string
constant and the store to `$trap$message` that round 1 omitted. The rounds differ, and
`bootstrap.sh` refuses a build that never settles rather than installing one.

So the two ends have to agree: wac-L5 must emit the message the same way wacc does, or wacc's source
must not contain one. That is the whole of why this is filed rather than done in ten minutes, and it
is worth knowing before starting rather than after the fourth round of a build that will not settle.

The same argument applies to any wac-L5 change that *silently* narrows a construct wacc's source
uses. Refusing is safe; ignoring is not.
