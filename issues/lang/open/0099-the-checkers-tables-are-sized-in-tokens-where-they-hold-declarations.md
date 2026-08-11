# 0099 — the checker's tables are sized in tokens where they hold declarations

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
