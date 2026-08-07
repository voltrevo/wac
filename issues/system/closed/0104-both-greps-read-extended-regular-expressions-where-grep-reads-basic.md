# Both greps read extended regular expressions, where `grep` reads basic

**Status**: closed — fixed in the commit that added `packages/regex/src/basic.wac`
**Filed**: 2026-08-07

## What

`grep` without `-E` reads **basic** regular expressions. In basic, the six characters `| + ? { ( )` are
*literals* and their backslashed forms are the operators — the opposite of every dialect written today,
and the opposite of what both of this repo's greps compiled.

    grep 'a|b'      GNU: the three characters a, |, b        ours: a or b
    grep 'a\|b'     GNU: a or b                              ours: three characters
    grep 'a+'       GNU: a followed by +                     ours: one or more a
    grep 'a\+'      GNU: one or more a                       ours: a followed by +
    grep 'a?'       GNU: a followed by ?                     ours: zero or one a
    grep 'a{2}'     GNU: the four characters a{2}            ours: two a
    grep 'a\{2\}'   GNU: two a                               ours: the characters

Seven of seven wrong, and every one of them **silently**: nothing was refused, nothing was reported, the
pattern simply meant something else. It is the same shape as the substring grep found one tick earlier and
is arguably worse, because a substring grep at least never claimed to be a regex.

## How it was found

By reading `packages/regex` end to end, having wired it into `packages/sh`'s grep the tick before. The
package is honest and consistent — its README's first line is "a backtracking regular expression engine,
with JavaScript's semantics", and it is one. The defect was entirely in the callers: two programs using a
JavaScript engine and calling themselves `grep`.

Nothing in either package was wrong on its own. The bug lived in the space between them, which is where
the last three have lived too.

## The fix

`packages/regex/src/basic.wac`: a rewrite from basic to the engine's own dialect, in the package that owns
pattern syntax so both greps import one copy. The two dialects differ only in *which* spelling of those
six is the operator, so a basic pattern becomes the equivalent extended one by swapping the escaping and
nothing about matching changes — one engine, one set of semantics, a translation small enough to read.

Both greps take `-E` for extended now, which neither did.

Checked against **GNU grep 3.11** on nineteen basic patterns and six extended, plus `-x` in both dialects,
and pinned in `packages/sh/test/differential.test.ts` (17 scripts) and `packages/box/test/box.test.ts`
(16 cases).

## The other thing this found

**The `grep` in an interactive shell here is not GNU grep.** It is a shell function that dispatches to
Claude Code's own ugrep-based search; `/bin/grep` is the real one. Ad-hoc comparisons typed at a prompt
were therefore measured against ugrep 7.5.0, which differs from GNU on exactly the corners this issue is
about — it called `*a` an error where GNU matches a literal asterisk, and disagreed on `a\?` and `a*`.

The repo's tests are unaffected: they spawn binaries through `Deno.Command` and `bash -c`, neither of
which sees a shell function. But three of the "differences" in the first draft of this fix were ugrep's
and not ours, and believing them would have meant changing correct code. Recorded in
`~/notes/living/wac/` as well, because it is a fact about the machine rather than about this repo.
