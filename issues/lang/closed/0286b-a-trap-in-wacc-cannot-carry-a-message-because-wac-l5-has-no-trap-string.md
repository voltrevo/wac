# 0286b — a `trap` in wacc cannot carry a message, because wac-L5 has no `trap "…"`

- **Status:** closed
- **Fixed in:** `bootstrap/boot/l5.l4` — wac-L5 parses the optional string after `trap` and
  discards it. `packages/wacc/src/parse.wac` carries the first one. Tests
  `bootstrap/ts/l5.test.ts` ("trap takes an optional message and this rung discards it") and
  `packages/wacc/test/wac/parseconsumes_test.wac`.
- **Claimed by:** agent-b
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


## Fixed, and both of this issue's predictions about the build were wrong — agent-b, 2026-08-29

The change is the three tokens the issue's plan asked for. `bootstrap/boot/l5.l4`:

```
if (isword("trap")) { next(); if (kind() == K_STR) { next(); } want(59); line("unreachable"); return 0; }
```

`packages/wacc/src/parse.wac` now says what it always meant to:

    FAIL test_probe — trapped: these tokens have already been parsed: parsing rewrites them, so lex again

**The first prediction — that this could not work at all.** The section that stood here argued the
build would never settle: round 1 drops the message, round 2 emits it, the rounds differ, refused.
The last step is wrong. `bootstrap.sh` iterates to `MAX_ROUNDS=4` and says why immediately above the
loop — *a change to what the emitter emits is not in round 1 at all [...] Demanding agreement after
one round refuses every legitimate emitter change.*

**The second prediction — that it would settle at round 2.** It settles at round **1**, and the
reason is `--with-wacc`. The ladder step is one invocation:

    "$LADDER" packages/wacc/src/api.wac --with-wacc packages/wac/src/wac.wac $GRANTS -o "$seed"

The wacc that wac-L5 builds is never the artefact. It is used, inside that same invocation, to
compile the command — so the first thing written to `$seed` was emitted by *wacc*, and the message
is in it from the start. The L5-built compiler is missing a message inside its own `parseProgram`,
in a trap that does not fire during a successful compile, and nothing downstream is built from it.

Both errors have one shape: reasoning about a build from what a bootstrap normally does rather than
from what this script says it does. The script says both things in comments at the lines concerned.

**Measured:** `./bootstrap.sh --no-install`, 36s, *fixed point after 1 round(s), 1845720 bytes* —
87 more than before, and `grep -a` finds the message in the new artefact and not the old.

**What is not fixed.** wac-L5 still discards the message, so a `trap "…"` compiled by *that rung*
loses it. Nothing but wacc is compiled by that rung, and its own traps do not fire during a
successful compile, so the cost is one intermediate — stated at the site rather than left to be
discovered.
