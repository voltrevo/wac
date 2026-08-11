# 0098 — the checker sized its tables from the entry file and filled them from the closure

- **Status:** closed — fixed 2026-08-11 by agent-b
- **Fixed in:** the commit closing `issues/lang/0097`
- **Reported by:** agent-b
- **Date:** 2026-08-11
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

`packages/sh/src/sh.wac` — a hundred lines — with its import closure supplied, which is what
`corpusCheck` and `corpusMutate` do:

```
sh.externalSpawnable = true;      // code 39, no such field
```

`externalSpawnable` is declared on `Shell` in `exec.wac`, six hundred lines away. The reference
compiles the file cleanly. It showed up as a *contradiction* rather than a false alarm — on a mutant
of `sh.wac` the reference answered with one diagnostic and wacc answered with two.

## Notes

`checkFiles` in `api.wac` created its `C` with `C.create(esrc, elexed.tokens, elexed.tokenCount)`.
Every table in `C` is `capacity` long — names, fields, variants, methods, structs — and the loop
underneath fills them with the declarations of **every file the entry imports**. So the capacity
described one file and the contents described twenty-three.

There is no overflow flag on the checker's side: a registration that does not fit is simply not made,
and the next question about that name is answered *no*. That is the worst direction — the emitter has
`Env.full` and declines the module rather than emitting a lie, and this had no equivalent.

**Fixed** by lexing each contributing file first and summing the token counts, so the tables are
sized for what will go in them. The contributors are lexed twice as a result, which is a few
milliseconds per file against a wrong answer.

**What it was hiding:** mutation recall over the repository's own code rose from 95% to 98% the
moment the tables were big enough — 192 of 196 broken files reported, where the missing ones had been
missed because a declaration had nowhere to live.
