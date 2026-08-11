# 0130 — `local` outside a function is fatal in bash and a diagnostic here

- **Status:** closed — **not a bug; the fuzzer was misreporting**
- **Closed by:** agent-a, 2026-08-11
- **Reported by:** agent-a
- **Date:** 2026-08-11
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```
$ bash -c 'local v=in; printf "%s|" a'
bash: line 1: local: can only be used in a function

$ wacsh -c 'local v=in; printf "%s|" a'
a|sh: local: can only be used in a function
```

bash prints the error and **stops the script**. This one prints the error and carries on, so
everything after the bad `local` still runs — and, because the diagnostic goes to standard error and
the rest goes to standard output, the two streams disagree about whether anything happened.

## Where it came from

`tools/shellFuzz.ts`, and it is the *only* divergence three seeds find: seed 1 disagrees on two
scripts and seed 29 on one, and all three are this. It has been there for as long as `local` has —
0114's fix changed the other disagreement on seed 29 and left this untouched.

## What makes it more than a message

**`local` is a POSIX *special builtin***, and the rule is about the class rather than about `local`
itself: a special builtin that fails takes a non-interactive shell with it. `break`, `continue`,
`eval`, `exec`, `exit`, `export`, `readonly`, `return`, `set`, `shift`, `times`, `trap` and `unset`
are the others, and this shell has several of them. So the fix is a *rule* — a failed special builtin
sets `exiting` — rather than a branch in `local`, and getting the list right is most of the work.

Two things to check while doing it, because they are what makes this a rule with edges rather than a
one-liner:

- **Only when it fails.** `set -- a b` succeeding must not end anything.
- **Not in an interactive shell**, where bash prints the message and gives you a prompt back. This
  shell has an interactive mode (`packages/box`'s `sh` reads a terminal), so the rule needs the
  distinction that already exists for `$?` handling.

The status is unaffected in the observed cases — bash exits 0 for the seed-1 script and 1 for the
seed-29 one, matching ours — so the visible difference is entirely *how much of the script runs*.

## Withdrawn: bash does not do this, and the divergence was the normaliser — agent-a, 2026-08-11

**The premise is wrong.** Measured against bash, every one of these prints its error and carries on,
exactly as this shell does:

    local v=1; echo after      shift 99; echo after      unset -z; echo after
    export -z; echo after      set -z; echo after        break; echo after
    continue; echo after       return; echo after        cd /nosuch; echo after

All ten print `after` and exit 0. The POSIX rule about special builtins ending a non-interactive
shell is real, and bash does not apply it here — `local` is not a special builtin, and bash does not
abort for the others either without `set -o posix`. So there is nothing to fix in the shell, and the
"rule with edges" this issue proposed would have made it *diverge*.

**What the fuzzer was actually reporting.** `tools/shellFuzz.ts` compares `out + err` after stripping
each shell's diagnostic prefix, and the prefix pattern was
`/^(?:\S*bash|environment|ba-c): line \d+: /gm`. Under `m`, `^` matches at a line start — and
`printf '%s|'` leaves no newline, so standard output and the diagnostic share a line:

    set|set|set|set|bash: line 1: local: can only be used in a function

`\S*bash` matched `set|set|set|set|bash`, so bash's four printed words were deleted and ours were
not. Both shells had printed `set|set|set|set|` and exited 0. Confirmed by printing both sides:

    bash.out="set|set|set|set|" bash.err="bash: line 1: local: …" bash.code=0
    ours.out="set|set|set|set|"                                   ours.code=0

**Fixed in the tool**, three ways: only a *path* may precede the shell's name; the two streams are
joined with a newline so neither can be read as part of the other; and the patterns are no longer
anchored, because a diagnostic does not always start a line — `printf '%s|' a >&2` puts one in the
middle, which is how the same non-difference reappeared in the other direction on seed 1. Matching
anywhere is safe *only* because every script comes from the generator, whose vocabulary cannot
produce `sh: ` or `bash: line 1: `; that is now written beside the patterns.

**After the fix: 250 of 250 on seeds 1, 7, 29 and 30** — a thousand generated scripts with no
disagreement at all, where three of those seeds each reported one before. Canaried by pointing the
fuzzer at `/bin/dash`, which still disagrees on 16 of 60.

Filed on the strength of a tool's output without reproducing it by hand first, which is the lesson
worth keeping: the reproduction in the section above was written from the fuzzer's *report* rather
than from a shell.
