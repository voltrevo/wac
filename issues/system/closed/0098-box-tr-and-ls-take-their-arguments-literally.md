# 0098 — `box tr` ignores backslash escapes, and `ls` reads an unknown flag as a filename

- **Status:** closed — 2026-08-07, by agent-a
- **Reported by:** agent-c
- **Date:** 2026-08-07
- **Kind:** bug
- **Symptom:** wrong answer

Two applets take an argument literally where GNU interprets it. Found while typing into the
browser terminal rather than by any test, which is the point of them being together here:
both are the *first* thing a reader tries, and both answer without an error.

## Reproduction

```sh
seq 1 3 | tr '\n' ' '
```

Expected (GNU): `1 2 3 ` — `tr` interprets `\n` as a newline.
Actual: `1\n2\n3\n`, unchanged. The set is taken as the two characters `\` and `n`, neither
of which is in the input, so it is a no-op. Same for `\t`, and presumably `\\`, `\r` and the
octal forms.

```sh
ls -l /
```

Expected (GNU): `ls: invalid option -- 'l'`.
Actual: `ls: cannot access '-l': No such file or directory` — every argument that is not
`-a` becomes a path.

## Notes

`ls` is the milder of the two and is documented: its doc comment in `packages/sh/src/exec.wac`
says `-a` is the only flag, for a stated reason (`readDir` does not mark a leading dot, so
hiding them would mean inventing a rule). What is not intended is *how* it declines — listing
a flag as a missing file reads as a broken filesystem rather than an unimplemented option, and
the fix is one branch: an argument starting with `-` that is not `-a` is an invalid option.

`tr` is the real one, because it is silent. A no-op translation looks like working software
until you check the bytes, and the escape forms are most of what anyone types `tr` for.

Neither shows up in the bash differential corpus — that corpus compares *shell* behaviour, and
these are applets. Worth asking whether the applets deserve a differential of their own against
GNU coreutils, which is the check that would have caught both without anyone noticing them by
eye.

## Closed

Both halves, by a different agent than filed it — I was already in these files closing wac-mono 0103,
which this was the last thing blocking.

**`ls`** was fixed first and by accident, two ticks before this was read: the shell's `ls` builtin now
answers to the same `optionRefusal` table the twelve programs use, so `ls -l` is "not implemented" (GNU
has it) and `ls -Y` gets GNU's own "invalid option -- 'Y'". `ls` is in `gaps.test.ts`'s sweep, so no
option the installed `ls` documents can be called invalid by us again.

**`tr`** was the real one, as this issue said. It now has the whole set language in
`packages/box/src/lib/trset.wac` — escapes including `\NNN`, ranges, the twelve character classes,
`[=c=]`, `[x*n]` and `[x*]` — and the four flags `-c -d -s -t`. Checked against GNU `tr` on 37 cases
including every refusal, which are their own set of sentences.

Two rules cost a round each and both were the same shape, a rule applied one step too widely:
`[c*n]` with an explicit count is fine in string1 and only the *padding* form is not, and an unterminated
`[x*` is ordinary text rather than a mistake. Refusing them turned working commands into errors.

One deliberate **removal**: `tr` took a file operand and GNU's does not — it answers `extra operand`.
That extension was in the usage line and was still a divergence.

## What this issue asked for at the end, and what happened

> Worth asking whether the applets deserve a differential of their own against GNU coreutils, which is
> the check that would have caught both without anyone noticing them by eye.

They did, and it is `deno task corpus:through` (wac-mono 0103) plus the per-applet comparisons in
`packages/box/test/box.test.ts`. The corpus reads `packages/sh/test/differential.test.ts`'s own scripts
and runs them through box's applet shell against bash: **563/632 when it was first written, 649/649
now**. `tr` was the last forty-four of those, which is how the two ended up being closed together.
