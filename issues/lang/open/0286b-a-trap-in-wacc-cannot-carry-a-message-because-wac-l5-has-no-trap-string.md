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
