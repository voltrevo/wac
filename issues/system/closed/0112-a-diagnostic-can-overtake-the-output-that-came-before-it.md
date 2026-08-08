# 0112 — a diagnostic can overtake the output that came before it

- **Status:** closed
- **Reported by:** agent-a
- **Date:** 2026-08-08
- **Kind:** diagnostic
- **Symptom:** wrong answer

## Reproduction

Three files, the middle one absent, with both streams going to the same place — which is what a terminal
is, and what `2>&1` in a script is:

```
$ cut -c1 f1 nothing f2
cut: nothing: No such file or directory      <- ours: the complaint first
a
b

$ /usr/bin/cut -c1 f1 nothing f2
a                                            <- GNU: in the order it happened
cut: nothing: No such file or directory
b
```

Same bytes on each stream, same exit status. Only the interleaving differs, and only when the two streams
are merged. `packages/box/test/operand_errors.test.ts` states which invocations are which and compares
the streams separately for the ones listed here.

Affected: `cut`, `nl`, `fold` (every `Reader`-based applet), `wc`, and `tac`.

## Why it happens, which is three different reasons

**Buffering, for the `Reader` applets.** Output goes through `Sink`, which holds a block before writing —
`box seq 1 200000` spends fourteen seconds if it writes per line, which is why the buffer exists. A
complaint goes through `core.warn` and is not buffered. GNU has exactly the same arrangement and solves
it in one place: its `error()` calls `fflush(stdout)` first. Ours cannot do that from where it is —
`openStream` reports the failure and has never seen the caller's `Sink`.

`cat` and `head` are fixed and show the shape of the fix: they flush before opening the next operand,
because the applet's loop is where both objects are in scope. `Reader` opens the next operand from inside
`next()`, one layer under the applet, so the same trick does not reach.

**A width that needs every file, for `wc`.** The columns are right-aligned to the digits in the *total*
byte count, so no line can be printed until every file has been counted. GNU gets the same width without
reading anything: it stats the operands up front. That is the real fix and it is a change to how the
width is derived, not to where the flush goes.

**Reporting before writing, for `tac`.** GNU's `tac` complains about every operand it cannot open before
it prints anything; ours reports at the join, as the other filters do. Its own rule, not a general one.

## Not this

The content is right and the status is right. This is worth a number rather than a shrug because merged
streams are the normal case at a prompt — but it is *ordering*, and nothing is missing from either
stream. The bug that was worth fixing immediately was the one beside it: those same applets used to
**stop** at a bad operand, so `cat a missing b` never printed `b` at all.

## Where to look

- `packages/box/src/lib/input.wac` — `cannotOpen`, `openStream`, `Reader.next`, `nextSpan`
- `packages/box/src/applets/wc.wac` — `countWidth`/`digits(total.bytes)` and the loop that prints at the end
- `packages/box/src/applets/tac.wac`
- `packages/platform/src/stream.wac` — `Sink`, and `BLOCK`

The tidy version is probably that a diagnostic and the output share a flush point: something like the
`Sink` being reachable from wherever a complaint is made, so "flush before you complain" is stated once
rather than remembered at each call. That is a decision about the shape of `lib/input.wac`, which is why
this is filed rather than patched at four call sites.

## Fixed, 2026-08-08 — all three causes, and a fourth thing underneath them

**The `Reader` applets.** `Reader` holds the caller's `Sink` and flushes it before opening the next
operand, which is where the complaint comes from. That is what `cat` and `head` already did in their own
loops; the reader is one layer under the applet, so it had to be given the object rather than trusted to
be near it.

**`wc`.** The width comes from `stat` now, before anything is read — which is how GNU gets the same
number without reading a byte — so each line is printed as its file is counted rather than all of them
at the end. Two rules came out of measuring it that were not in the old comment: an operand with **no
size to take** (a directory, a device) puts the whole run on the fallback width of seven, and a
directory gets a **row of zeroes** while a missing file gets no row at all.

**`tac`.** Every operand is read before anything is written, which is that tool's own rule rather than
the family's — proved with `stdbuf -o0`, because the same experiment on `rev` shows the opposite.

**And `rev` is the one that stays**, on purpose. util-linux does not flush standard output before
complaining, so *its* merged order depends on whether stdout is a pipe or a terminal, and ours does not.
Copying that would be copying a buffering artefact. The test compares its streams separately and says so.

## What the directory cases found, which was the bigger half

Adding "the operand is a directory" to the sweep turned up worse than ordering. A directory *opens* and
then refuses to be read, which is a path nobody had walked:

- the host's own sentence reached the output — `wc: Is a directory (os error 21)`, an errno, no
  filename, and a different wording under Node. `FAULT_IS_DIR` is the eighth category; wac-mono 0062 is
  the same fix on the open path, and 0067 had recorded the question and left it.
- `head -1 somedir` printed **nothing and exited 0**. `Line.ok` false means "no more lines" whether the
  input ended or the read failed, and `head` pulls `nextLine` itself rather than through `Reader`.
- a read failure ended the run in `nextSpan`, `Reader`, `wc` and the checksums, so
  `cat a somedir b` never printed `b` — the same bug as the open case, one layer along, which survived
  that fix because a read only fails on inputs nobody had tried.
- the message had no filename in it at all: `nextChunk` knew the tool but not the operand.

Twenty-nine invocations in `packages/box/test/operand_errors.test.ts` now, missing and directory both,
against the real tools.
