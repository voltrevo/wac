# 0111 — the shell has `while` and `for` but no `break` or `continue`

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-08-08
- **Kind:** missing feature
- **Symptom:** wrong answer

## Reproduction

```
$ wacsh -c 'for i in 1 2 3; do echo $i; if [ $i = 2 ]; then break; fi; done'
1
2
break: command not found
3
```

bash prints `1` and `2`. Ours prints `1`, `2`, a complaint, and then `3` — the loop runs to the end.

`continue` is the same:

```
$ wacsh -c 'for i in 1 2 3; do if [ $i = 2 ]; then continue; fi; echo $i; done'
1
continue: command not found
2
3
```

bash prints `1` and `3`.

## Why this is worth a number rather than a fix in passing

Two reasons, and the second is the interesting one.

**It is not one function.** Every builtin here answers with an `Output` — bytes, bytes, a status — and
neither of these is a value a command can return. They are control flow: a `break` inside an `if`
inside a `while` has to unwind through the statement walker to the enclosing loop, and the walker has
no channel for that today. `return` from a function is the same shape and is also absent. So this is a
change to how `exec.wac` runs a body, which is the kind of thing worth agreeing on before doing.

**Nothing sees it, and the reason is a blind spot rather than an oversight.** The differential corpus
is 673 scripts against bash and not one of them uses `break`, `continue` or `return`. It was written
by asking "what does this shell do", which is a question that only ever reaches what somebody thought
of; a loop that exits early is *ordinary* shell — it is in the first page of any script — and it has
never been asked. The corpus grew by hunting bugs in what exists, and this is the shape that hunt
cannot find.

That makes the useful follow-up bigger than these two words: **what else does bash have that nothing
here has ever typed?** `return`, `local`, `case`, `until`, `select`, `trap`, `${x:-y}` and friends,
`$@` vs `$*` in every quoting, arrays. A sweep that takes a list of constructs from bash's own manual
and asks the corpus which are absent would be a better use of an hour than any single one of them.

## How it was found

By hand, writing `while read l; do echo "$l"; break; done` as a replacement for `cat` while deleting
`packages/sh`'s programs (0103) — the loop never stopped. Three ticks in a row now where typing at the
shell found something four sweeps did not.
