# 0130 — `local` outside a function is fatal in bash and a diagnostic here

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
