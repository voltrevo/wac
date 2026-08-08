# 0112 — a diagnostic can overtake the output that came before it

- **Status:** open
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
