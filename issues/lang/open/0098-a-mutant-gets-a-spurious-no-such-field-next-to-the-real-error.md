# 0098 — a spurious `no such field` appears beside the real error, and `corpusMutate` is red

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-11
- **Kind:** diagnostic
- **Symptom:** wrong answer

**`deno task test` is red on master because of this**, and has been for longer than
[0097](0097-a-linked-git-repo-emits-an-invalid-module.md) was: `packages/wacc/test/corpusMutate.test.ts`
throws

```
on a mutant the reference answers with one diagnostic, we point elsewhere:
  packages/sh/src/sh.wac: we say 49:5, the reference says 50:3 — missing return value: expected i32
```

Verified pre-existing: stashing every uncommitted change and running that test alone reproduces it
byte for byte, so it is not a consequence of 0097's rename or of anything in `packages/git`.

## Reproduction

Take `packages/sh/src/sh.wac` and apply the corpus sweep's own mutation **"a return loses its value"**
— the first `return <expr>;` in the file becomes `return;`. That turns line 50 of `main` from
`return shellMain(core, cli, sh, 0);` into `return;`, and leaves line 49 untouched:

```wac
  sh.externalSpawnable = true;   // line 49 — not modified by the mutation
  return;                        // line 50 — the mutation
```

Asked about that file, with its real 23-file import closure, the two checkers say:

```
reference:  50:3 [typecheck] missing return value: expected i32     (one diagnostic)
wacc:       code=37 at 50:3     <- correct, and the same place
            code=39 at 49:5     <- spurious; 39 is errNoSuchField
```

**wacc gets the actual error right.** The failure is the *extra* diagnostic: `errNoSuchField` against
`sh.externalSpawnable`, on a line the mutation did not touch, for a field `Shell` genuinely declares —
`packages/sh/src/exec.wac:235`, `bool externalSpawnable;`.

It is **mutation-induced rather than a standing false alarm**: on the unmodified file the reference
answers `ok` and wacc reports nothing at all. So removing a return *value* on line 50 costs a field
lookup on line 49.

## What does not reproduce it

All of these give only the correct `37`, and no `39`:

- A bare `return;` in an `i32` function with a field write before it, one file.
- The same with a field *read* before it, and with nothing before it.
- The same across an import — `struct S` in one file, the function in another.
- The same at 1, 2, 4, 8, 16, 24, 32, 40 and 64 fields, in case a fixed-capacity field table was
  overflowing.

So it needs the real closure, which is where it is like 0097 and probably not like it otherwise.

## A trap for whoever reduces it

Delta-debugging this needs **the reference in the predicate**, not just "wacc emits a 39". Reduced on
the weaker predicate it converges in seconds to

```wac
// exec.wac, entire
export struct Shell {
```

— an unterminated struct with no fields, for which `no such field` is the honest answer rather than a
bug. The predicate has to be *the reference still answers with exactly its one `missing return value`
diagnostic, and wacc still adds a 39*. That version is much slower, because every step recompiles the
closure with the reference; a first attempt at it did not finish inside ten minutes and wants either a
narrower closure or a cheaper reference call.

## Two things about the test worth deciding

- **It treats an extra position as a contradiction.** The reference gave one diagnostic; wacc gave two,
  one of them identical. The loop compares *every* position wacc reports against that single one, so a
  checker that finds the real error and also says something else fails. That may well be the rule
  wanted — pointing somewhere additional is confusing — but it is not the same rule as "we point
  elsewhere", which is what the message says, and the fix for this issue changes depending on which is
  meant.
- **The coverage is positional.** Which mutation a file receives is `MUTATIONS[i % MUTATIONS.length]`
  over the corpus order, so **adding files to the corpus reshuffles it** and this contradiction can
  vanish without being fixed. Anybody who sees `corpusMutate` go green should check that `sh.wac` still
  draws "a return loses its value" before believing it.
