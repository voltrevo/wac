# 0179a — `emitFiles` answers a bare wasm header at 1024 import edges in one file

- **Fixed in:** the commit closing this issue
- **Status:** closed — agent-a, 2026-08-21
- **Closed by:** agent-a, 2026-08-21
- **Reported by:** agent-a
- **Date:** 2026-08-21
- **Kind:** bug
- **Symptom:** no error — an 8-byte module, and the checker calls the program clean

## Measured

`n` one-function files plus an entry importing every one of them, through `diagnoseFiles` and
`emitFiles` on the same input — `packages/wacc/test/wac/importcurve_probe.wac`:

| imports in the entry | check | emit | module |
| ---: | ---: | ---: | ---: |
| 1 000 | 66ms | 49ms | 61 423 bytes |
| 1 020 | 71ms | 49ms | 62 663 bytes |
| **1 024** | 67ms | 4ms | **8 bytes** |
| 1 100 | 77ms | 5ms | 8 bytes |
| 1 200 | 89ms | 5ms | 8 bytes |

Eight bytes is `\\0asm` and a version — a module with nothing in it. `diagnoseFiles` answers **clean**
at every one of those sizes, and `blockedFiles` says nothing either.

**It is the import edges in one file, not the file count.** The same 1 024 files with only ten imports
in the entry emit **3 665 bytes** and run. So the bound is on one file's import list, and 1 024 is
exactly where it falls — `Env` is constructed with about a dozen `string[1024]` tables
(`packages/wacc/src/emit.wac`, in `Env(...)`), one of which is that list.

## Who can reach it

Not `wac build` or `wac check`: `gather` in `example/wacc.wac` refuses past **512** files now
(`issues/lang/0158`), so the CLI stops before the emitter's limit. What is exposed is a caller that
supplies its own path map and calls `emitFiles` directly — the playground, the harness, an embedder,
which is the same set `issues/lang/0157` is about, and the set that gets no diagnostic today.

No real program is near it. The largest import list in this repository is `packages/box/src/box.wac` at
65, and the only thing that generates more is a test written to push the linker's tables.

## What to do

The principle is the operator's, quoted in `issues/lang/0170a`: *"In every case where it hits a case
that isn't implemented, it must fail, not be silent."* So:

1. **Find which table it is.** The `Env(...)` constructor has a dozen `string[1024]`s on four lines and
   the field names are in the struct rather than at the call, so this is a matter of reading the
   declaration order rather than guessing. Then check whether the overflow is a *guarded write* — the
   shape `issues/lang/0130` found in the linker, where `if (table.len() > n)` silently skips — or a
   `return`.
2. **Say so.** A decline with a reason, which `blockedFiles` already has a channel for, naming the limit
   and the file whose import list is too long. The sentence `gather` now uses is a fair model.
3. **Then decide whether to raise it**, which is a separate question and probably "no": 1 024 imports in
   one file is not a program anybody writes, and a limit that reports itself costs nothing to leave.

Worth doing at the same time: `Env`'s other fixed tables have the same shape and no reason to be
different. Counting how many of them are written under a guard rather than a check would say whether
this is one bug or a family — the linker's version of it was a family.

## How it was found

Re-measuring `issues/lang/0158`, whose superlinearity had been fixed by someone else's change and whose
wall was gone; the probe kept going past the sizes that issue used and fell off this instead.

## Closed — agent-a, 2026-08-21, and it was not silent, it was misdiagnosed

The issue above says the emitter answers an 8-byte module with no diagnostic. The first half is right;
the second was my own measurement gap — the probe never asked `blockedFiles`, which does answer:

    an import of a file that was not supplied

**For a program whose every file was supplied.** So the emitter refuses correctly and blames the
caller's map for its own table limit — the same sentence `gather` used to give for the same reason
(`issues/lang/0158`), and a worse failure than silence because it points somewhere.

### The mechanism, which was half-built

`linkFailure` already distinguished them:

```wac
return starts[0] == 1 ? "more import edges than the linker was given room for"
                      : "an import of a file that was not supplied";
```

**And `starts[0]` appears exactly once in `emit.wac` — that read.** Nothing ever wrote it, so the first
message was unreachable and every refusal took the second. A reader with no writer, which is the shape
`issues/lang/0175a` and `issues/system/0229a` were both about, in a third place.

`linkFiles` has **five** room guards, and they were not even consistent with each other:

| guard | table | was |
|---|---|---|
| `sn >= seen.len()` | the file table | `return ""` |
| `qn >= queue.len()` ×2 | the walk's queue | `return ""` |
| `en >= fromPath.len()` ×2 | the edge table | **`continue`** — dropped the edge and linked anyway |

The last two are `issues/lang/0130`'s shape: a guarded write rather than a check, so the module comes
out with a name resolved to nothing. Those now refuse.

### What it says now

Each guard sets the sentinel and `linkFailure` names the limit:

    more files in one program than the linker was given room for (at most 1024)
    more files to visit than the linker's queue holds (at most 1024, which is one per import edge followed)
    more import edges in one program than the linker was given room for (at most 32768)

`1024` is `linkQueueSize()` now rather than a literal in two places, so the message cannot drift from
the array. The 1024-import program reports the queue one.

### Tests, and what the canary taught

`manyfiles_test.wac` — the file this belongs in, since it is about the linker's tables — asserts the
refusal names the queue *and* the limit *and* no longer says "not supplied", plus a control at 201 files
that still links.

The canary is worth recording. Neutralising **either** queue guard alone leaves the test passing;
neutralising **both** fails it with the old sentence. That is not redundancy: `blockedFiles` fails the
link once with the caller's tables and then calls `linkFailure`, which **re-links with its own, larger
ones** — so the diagnosis can trip a different guard than the build did. Worth knowing before trusting
any future message from this path to describe the run that actually failed.

### What is left, measured rather than left as a question

The five guards above are the linker's. `emit.wac` has **five more** of the silent-skip shape, counted
by `rg "\.len\(\)\) \{ continue; \}"`:

| site | table | what it is |
|---|---|---|
| `frontOfRaw`, and its twin | `env.importFrom` (`i32[1024]`) | a **write** — the edge is dropped and the module built |
| three in the coverage-name walk | `fnName` | **reads** of a looked-up index, where skipping is the answer |

So two of the five matter, and both are the same site in two functions: `Env`'s import-edge table
truncating silently at 1024.

**They are unreachable today, and only by coincidence.** The linker's queue holds one entry per import
edge *followed* — its own new message says so — and it is also 1024, so a program big enough to overflow
`Env`'s table is refused by the queue first. Measured, 300 files with a fan-out of 4 (about 1200 edges,
301 files):

    fan 2, ~600 edges    →  clean, 20 130 bytes
    fan 4, ~1200 edges   →  refused: "more files to visit than the linker's queue holds (at most 1024…)"
    fan 6, ~1800 edges   →  the same

**Which is a latent hazard rather than a non-problem:** raise `linkQueueSize()` and those two guards
become live, silently, and the symptom is a module with a name resolved to nothing. The honest fix is to
size `Env`'s import tables from `linkQueueSize()` so the relation is stated rather than coincidental —
not done here because `Env`'s constructor is positional with a dozen `1024`s on four lines, and picking
the right four by counting arguments is exactly the kind of edit that goes wrong quietly. Whoever gives
`Env` named field initialisers should do it in the same change.
