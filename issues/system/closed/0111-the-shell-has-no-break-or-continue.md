# 0111 — the shell has `while` and `for` but no `break` or `continue`

- **Status:** closed
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

## Fixed, 2026-08-08 — one mechanism, four keywords

`break`, `break N`, `continue`, `continue N` and `return`, through one channel: the walker already
stopped on `exiting`, and these are the same shape with different catchers. A loop catches a `break`, a
function call catches a `return`, nothing catches an `exit`. `unwinding()` is the one predicate every
walker asks; `caughtBreak` is the one place a count is decremented.

**Counters rather than flags**, which is the whole of `break 2`: each loop takes one off and stops, and
where the count is still positive the loop above is the one that decides.

Twenty-eight cases against bash, all in `packages/sh`'s corpus so they run for ever. Five of bash's
rules are not what anyone would guess, and three of them I had wrong before measuring:

- outside a loop, `break` **complains and leaves the status 0** — a shell that returned 1 would break
  `set -e` scripts that bash runs;
- a count of **0 is an error, status 1, *and* leaves the loop** — `for i in 1 2; do echo $i; break 0;
  done` prints `1` and stops;
- a count **larger than the loops enclosing it is not an error**: `break 5` inside one loop leaves it
  and the script carries on. This was the last bug — the count stayed positive, `unwinding` stayed
  true, and everything after the loop was silently skipped;
- a **non-numeric** count ends the shell with 128, the one place a bad argument to a builtin is fatal;
- `return` with no argument keeps the **last command's** status, so `f() { false; return; }` answers 1.

`return` outside a function complains and leaves status 2 without ending the shell, and a function body
does not count the caller's loops — `f() { break; }` called from a loop complains rather than leaving it.

## The sweep this issue asked for

"What else does bash have that nothing here has ever typed?" — measured, thirty constructs, on
2026-08-08. Fifteen already agreed, and are worth listing because a gap list without them reads as a
much emptier shell than this is: `case`, `until`, `${x:-y}`, `${x:=y}`, `${x:+y}`, `${#x}`, substrings,
prefix and suffix removal, `${x/a/b}`, `$@` versus `$*`, subshells, groups, `elif`, and `${x:?msg}`.

These are the ones that are not here:

| missing | what bash does |
| --- | --- |
| `!` before a pipeline | inverts the status; ours says `!: command not found` |
| `local` | a variable scoped to the function |
| `trap` | a command on EXIT and on signals |
| arrays, `${a[1]}` | a parse error here |
| `<<<` here-strings | a parse error here |
| `<(…)` process substitution | a syntax error here |
| `for ((i=0;i<2;i++))` | a syntax error here |
| brace expansion `{a,b}c` | `ac bc`; ours passes the braces through |
| `~user` | that user's home; ours leaves the tilde |
| `&` and `wait` | job control — design/0001 step 3 |

`packages/sh/README.md`'s "what it does not do" says all of that now, with the date it was measured.
`!` is the next one worth doing: it is a prefix on a pipeline rather than a builtin, and it is in the
first page of every script.
