# 0200 — a shell builtin shadows a box applet and refuses in fewer words than the applet does

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** bug
- **Symptom:** wrong answer — the same command answers two ways depending on how it is reached

## Reproduction

```
$ box mkdir
mkdir: missing operand
Try 'mkdir --help' for more information.

$ boxsh -c 'mkdir'
mkdir: missing operand

$ /usr/bin/mkdir
/usr/bin/mkdir: missing operand
Try '/usr/bin/mkdir --help' for more information.
```

Same for `rm`. Both spawned, so this is not about the in-process route.

## What is happening

`packages/sh/src/exec.wac:3341` dispatches `mkdir` and `rm` to the shell's **own builtins**, which shadow
`packages/box`'s applets of the same name. The builtin prints one line; the applet prints GNU's two,
because `lib/operands.wac`'s `missingOperand` calls `tryHelp` after the sentence — which is the whole
point of that file, and its header explains at length why the second line is not optional.

Twelve applets were changed to say what the real tool says. Two of them are unreachable from a shell.

## Why nothing noticed

The Deno test this replaced ran `box <applet>` directly, so it compared the applet with GNU and
saw them agree. Nothing compared *the shell's* answer with GNU for a name that is both a builtin and an
applet. `packages/box/test/wac/operands_test.wac` runs its cases through the shell — which is what a
person types — and that is what surfaced it.

`ls` is in the same list (`exec.wac:3427`) and is worth checking for the same reason.

## The decision this needs

Which wins, and it is not obvious:

* **The applet**, since box exists to provide the real tools' behaviour and a shell that quietly
  substitutes a lesser one is the surprise. Then the builtin list shrinks to what a shell must implement
  itself — `cd`, `export`, `exit` — and the rest resolve as commands.
* **The builtin**, since `packages/sh` ships without box and needs a `mkdir` at all; then the builtins
  have to say what their applet counterparts say, and something has to keep them in step.

The first is cleaner and the second is smaller. Filed rather than picked, because the answer changes what
`packages/sh` is on its own.

## Notes

Found while moving the operand sweep to a pure-wac in-process replay (`issues/system/0193`). The replay
names the two cases and skips them, pointing here; when this is fixed the skip list empties and the
replay's count assertion fails until it is raised.
