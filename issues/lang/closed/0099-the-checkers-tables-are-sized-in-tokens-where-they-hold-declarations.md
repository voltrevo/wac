# 0099 — the checker's tables are sized in tokens where they hold declarations

- **Status:** closed — fixed 2026-08-11 by agent-b
- **Fixed in:** the commit splitting `C.create`'s capacity in two
- **Claimed by:** agent-b, 2026-08-11
- **Reported by:** agent-b
- **Date:** 2026-08-11
- **Kind:** performance
- **Symptom:** no error

## Reproduction

```
deno test -A packages/wacc/test/corpusCheck.test.ts
```

Peak resident set, sampled from `/proc/<pid>/status` every 300 ms:

```
550 MB   before 0098's fix (capacity = the entry file's token count)
778 MB   after                (capacity = the closure's token count)
```

The largest closure in the corpus is `packages/tor/src/relayd.wac`: **80 files, 932 KiB of
source** — roughly a quarter of a million tokens. `C.create` allocates about forty-five arrays of
`capacity`, so that one call asks for ten million-odd slots.

## Notes

`issues/lang/0098` fixed a real defect: the tables were sized from the entry file and filled from its
whole import closure, so a small file with large imports silently overflowed and answered *no such
field* about correct code. Summing the closure's tokens is sound — nothing overflows now — but it is
the wrong *unit*.

**What those tables hold is declarations**: a struct, an enum, a field, a variant, a method, a
function signature. A file contributes those, not its tokens, and the ratio is an order of magnitude.
Sizing by a real count would give the same soundness for a fraction of the memory:

- parse each contributing file once in the pre-pass — `checkFiles` already lexes them — and sum
  `prog.decls.len()` plus each declaration's fields, variants and methods;
- keep the *per-function* tables (`names`, `types`, `nameConst`, `nameAliasOnly`) at the entry
  file's token count, since only the entry's bodies are walked;
- and the error array is `capacity * 3`, where a few thousand would do.

**Why it is worth doing.** Three agents share an 11 GB box, and `deno task test` is killed by the
OOM killer when two of them run a suite at once — the run reports `EXIT=137` with no failing test,
which reads as a broken suite rather than a busy machine. The suite passes on a quiet box.

Do not simply cap the capacity: an overflow is silent on this side, which is what 0098 was about.

## Fixed — 2026-08-11, agent-b

Peak resident set for `corpusCheck`, sampled the same way:

    550 MB   before 0098's fix
    778 MB   after it
    439 MB   now

**Two capacities, because the tables hold two kinds of thing.** The name table and the three beside
it are per *function* — `clearScope` empties them between bodies, and only the entry's bodies are
walked — so they keep the entry's token count. Everything else accumulates across the closure and is
sized by a *count of declarations*: one per declaration, plus a struct's fields and methods, an
enum's variants and their payloads, and each method's parameters, counted from the parse rather than
estimated from the text.

Counting means parsing each contributor once more than before. It cost nothing measurable —
`corpusCheck` runs in 3s, as it did — because the parse was already the cheap half.

Below where it started, and nothing was traded for it: 357 files with 0 false alarms, and the
mutation oracle rose to **99%** (197 of 198) as the corpus grew. Both directions of 0098's rule still
hold: nothing overflows, and nothing is sized by a guess.
