# 0201 — a shell builtin shadows a box applet and refuses in fewer words than the applet does

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

## Measured: only two of the four shadowed names diverge — agent-a, 2026-08-20

The issue says *"`ls` is in the same list and is worth checking for the same reason"*. Checked, and the
answer narrows the decision rather than widening it.

Cross-referencing `builtinNames()` (25 names) against `packages/box/src/applets/` (62) gives **four**
names that are both a shell builtin and an applet: `echo`, `ls`, `mkdir`, `rm`. Each compared three ways
— GNU, the applet through `box`, and the builtin through the shell:

| command | GNU | box applet | shell builtin |
|---|---|---|---|
| `mkdir` (no operand) | `missing operand` + `Try … --help` | **same** | one line — **diverges** |
| `rm` (no operand) | `missing operand` + `Try … --help` | **same** | one line — **diverges** |
| `ls /nope-xyz` | `ls: cannot access '/nope-xyz': No such file or directory` | same | **same** |
| `echo --bad` | `--bad` | `--bad` | `--bad` |

So `ls` and `echo` agree everywhere, and the divergence is exactly the two already reported — both on the
missing-operand path, which is the path `lib/operands.wac` exists to standardise and which the builtins do
not go through.

**What that does to the decision.** Option two — keep the builtins and make them say what their applets
say — is smaller than it looked: it is two error paths, not four commands, and the sentence to copy is
already written in `missingOperand`. Option one is unchanged. This does not pick between them; it removes
the unknown that made the second look open-ended.

The three-way comparison is worth having as a test whichever way it goes, since nothing currently compares
*the shell's* answer against GNU for a shadowed name — which is why this was invisible. Not added here: it
would assert the divergence, and the replay in `issues/system/0193` already names and skips these two
cases, so the tripwire exists.