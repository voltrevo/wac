# The tool that makes your test input is never tested

*2026-08-05*

Seven hundred shell scripts, each run through GNU bash and through the shell I am building, both
outputs and both exit statuses required to match. It has found dozens of real bugs — a `head` that
ignored `-2`, nine programs that ignored their file operands, a `cd` that could not find `$HOME`.

Yesterday I typed this by hand, for an unrelated reason:

```
$ wacsh -c 'seq 1 2 9'
1
2
```

GNU prints `1 3 5 7 9`. The three-argument form of `seq` is FIRST INCREMENT LAST; mine read the first
two operands as first and last, never looked at the third, and exited 0. A script asking for the odd
numbers up to nine got two lines and a success.

`seq` appears in about a hundred of those seven hundred scripts. Not one of them found this.

## Why not

Because in all hundred, `seq` is the *fixture*. `seq 1 5 | wc -l` is a test of `wc`. `seq 1 200000 |
head -1` is a test of whether a pipeline streams. `seq 100000 -1 1 | sort` — which I tried to write
the same afternoon, and which silently produced nothing, because that form was broken too — is a test
of `sort`.

Every one of those cases has a subject, and the subject is never the thing generating the input. The
corpus is a differential test, so it does compare `seq`'s output against bash's — but only the shapes
of `seq` that somebody happened to need in order to test something else. `seq 1 5` and `seq 1 200000`
were the two, and both are the two-argument form.

The gap is not in the oracle. bash was sitting right there, willing to answer `seq 1 2 9` correctly
the whole time. The gap is that **nobody asked**.

## It was not one bug

Once I saw the shape I went looking for it, and the same afternoon produced three more, all in
programs the corpus uses constantly:

**`wc`'s columns had never matched GNU.** GNU right-aligns its counts in a field as wide as the digits
of its inputs' total size, and 7 when it cannot know one:

```
$ printf 'a b\nc\n' | wc
      2       3       6
```

Mine printed `2 3 6`. Twenty-odd `wc` cases in the corpus and every one agreed with bash, for two
reasons that are each individually reasonable: every case with a *file* used a file small enough that
GNU's width was 1 — so one space was the correct answer — and every case with a *pipe* asked for a
single count with `-l` or `-c`, which GNU prints unpadded. The one combination that would have shown
it, more than one count from a stream, was never written, because nobody needs `wc` with three columns
in order to test something else.

**`cat`'s options were filenames.**

```
$ wacsh -c 'cat -n f'
cat: -n: No such file or directory
```

A real GNU flag, reported as a missing file. `cat` is in the corpus constantly, always as `cat f` or a
pipeline stage that copies. Nobody had passed it a flag, because you do not need a flag from your
`cat` when your `cat` is there to move bytes for a test about something else.

**`cat` stopped at the first file it could not open.** `cat missing f` printed the complaint and none
of `f`, exiting 1. GNU prints `f` and exits 1. This is my favourite of the four, because the status is
*right* — a script checking `$?` sees exactly what it should — and the output is quietly short.

## The general shape

Test suites have a foreground and a background. The foreground is what each case is about. The
background is everything the case needs in order to exist: the fixture generator, the temp directory
helper, the process runner, the fake clock, the thing that fills a database with rows.

The background is code, and it is code you have unusual confidence in, because it appears in a hundred
passing tests. That confidence is misplaced in a specific way — those hundred passes tell you the
background behaved *consistently*, not that it behaved *correctly*, and in a differential suite they
tell you only that the handful of behaviours you needed are right. `seq 1 5` was right. `seq 1 2 9`
was never asked.

The failure mode is worse than an untested corner, because a broken fixture usually does not fail
loudly — it produces less input, or different input, and the foreground test still passes against an
oracle fed the same broken input. My `seq 100000 -1 1` produced nothing at all, so the `sort` case I
was writing compared two empty outputs and would have passed. A test that compares nothing to nothing
is the most confident-looking green there is.

## What I did about it

Two things, and only one of them is "fix the bugs".

**Ask each tool a question instead of using it to ask one.** The corpus now has cases whose subject is
`seq` itself: every argument form, counting down, the zero increment, a fourth operand, an argument
that is not a number. Same for `cat`'s nine flags. These are boring cases about boring programs and
they are exactly the ones that were missing.

**Enumerate what the real tool has, instead of guessing.** The strongest thing in this suite is a test
that reads the installed GNU tools' own `--help` output, extracts every short option, and asserts that
mine never calls one of them "invalid":

```ts
for (const m of help.matchAll(/^\s+-([a-zA-Z])[,\s]/gm)) letters.add(m[1]);
```

It does not check that the options *work* — that is the corpus's job — only that a gap announces
itself as a gap rather than as a user error. And because the list comes from the machine's own
coreutils rather than from a table I wrote, it cannot drift.

`seq` and `cat` were excused from that test with a comment that said they "take no letter this cares
about". GNU's `seq` has `-f`, `-s` and `-w`. GNU's `cat` has nine. The excuse was written by someone
who had never asked those two programs a question either. He and I have the same name.

## The rule I would give someone else

When you write a test, name its subject out loud. Then look at everything else in the case — the
generator, the helper, the setup — and ask when that thing was last a subject rather than a
background. If the answer is "never", you have found where your next bug is, and it will be the kind
that makes other tests pass rather than the kind that makes them fail.
