# An oracle you do not control

*2026-08-05*

Here is a test I wrote, and it passed:

```
seq 1 5 | head -2   ->  1\n2\n
```

Here is the same behaviour checked a different way — run the script through GNU bash, run it through our
shell, require the same bytes and the same exit status:

```
seq 1 5 | head -2
  bash: "1\n2\n" exit 0
  ours: "1\n2\n3\n4\n5\n" exit 0
```

Our `head` was ignoring `-2`. It accepted the flag, printed every line, and exited zero. The first test
passed because I had written `head -n 2` in it, which was the spelling the implementation happened to
support, because I had written both.

That is the whole argument for differential testing, and I would rather show it than argue it: **a test
you write from the same understanding as the implementation cannot find a gap in that understanding.**
It can find a typo. It cannot find the thing you did not know.

The rest of this post is the other half, which took me longer to learn: an oracle only answers the
questions you ask it, and there is a structural pattern to the questions nobody asks.

## What "differential" means here

Every layer of this project is compared against something written by somebody else.

The shell's 700-odd scripts run through GNU bash and through ours, and both standard output and the exit
status must match. The applets are compared against GNU coreutils — `wc`, `head`, `tr`, `sort`, `cut`,
`fold` — the real ones, on the same machine, with `LC_ALL=C` so byte order is byte order. The compiler's
parser, written in wac, is compared node-for-node against the reference parser written in TypeScript,
over every `.wac` file in the repo. The crypto is compared against Node's and Deno's. The gzip is
compared against Python's, in both directions. The TLS client talks to a real server; the SSH server is
talked to by real OpenSSH.

None of those oracles knows this project exists, which is the property that matters.

## What it has found

A list, because the generalisation is more convincing with the cases under it. All of these passed
hand-written tests first.

- **`head -2` printed everything.** A flag accepted and ignored. So did `tr -d 12`, which read `-d` as a
  *set of characters* and translated digits into a dash and a `d` while reporting success. So did
  `sort -n`, which sorted numerically and then skipped the last-resort comparison, so `b a 1` came out
  in input order where GNU answers `a b 1`.
- **Nine programs ignored their file operands entirely.** `wc -l f` printed `0` and exited `0` — it had
  counted standard input, which was empty. `grep pattern f` printed nothing and exited 1, which a script
  reads as "no match" rather than "the file was never opened". `cat` was the only one that had ever
  opened anything.
- **`cd` said "HOME not set"** in a shell where `echo $HOME` printed a path, because expansion fell back
  to the environment and `cd` looked only at variables the shell had assigned itself. The corpus could
  not see it: the harness clears the environment, so *bash* refuses too, and the two agreed about the
  failure while nobody asked about the success.
- **A directory's size.** I built an in-memory filesystem and compared its answers against the real one,
  operation for operation. First run, three divergences. One: the host reports a directory's size as
  4096 and mine reported 0. That taught me something about the *oracle* rather than the implementation —
  4096 is this filesystem's block size and means nothing portable, so the right move was to stop
  comparing a number no program should read.
- **`ef bf bd`.** A filename that is not valid UTF-8, surviving in the shell and mangled the moment it
  crossed into a spawned child, because the capability boundary converted strings. That is a design flaw
  I would not have found by reasoning, because when I reasoned about it I concluded the wire format was
  at fault, and it was not.

## The blind spot, which is structural

`seq` appears in about a hundred of those seven hundred scripts. Yesterday I typed this by hand, for an
unrelated reason:

```
$ wacsh -c 'seq 1 2 9'
1
2
```

GNU prints `1 3 5 7 9`. The three-argument form is FIRST INCREMENT LAST; mine read the first two
operands as first and last, never looked at the third, and exited 0. A script asking for the odd numbers
up to nine got two lines and a success. Not one of the hundred cases found it.

**Because in all hundred, `seq` is the fixture.** `seq 1 5 | wc -l` is a test of `wc`. `seq 1 200000 |
head -1` is a test of whether a pipeline streams. Every case has a subject, and the subject is never the
thing generating the input. The corpus does compare `seq`'s output against bash's — but only the shapes
of `seq` that somebody needed in order to test something else, which were `seq 1 5` and `seq 1 200000`.
Both two-argument.

The gap is not in the oracle. bash was sitting right there, willing to answer `seq 1 2 9` correctly the
whole time. **Nobody asked.**

Once I saw the shape, the same afternoon produced three more, all in programs the corpus uses
constantly:

- **`wc`'s columns had never matched GNU.** GNU right-aligns its counts in a field as wide as the digits
  of its inputs' total size, and 7 when it cannot know one: `printf 'a b\nc\n' | wc` gives
  `      2       3       6`. Mine printed `2 3 6`. Twenty-odd `wc` cases and every one agreed with bash,
  for two individually reasonable reasons: every case with a *file* used a file small enough that GNU's
  width was 1 — so one space was correct — and every case with a *pipe* asked for a single count, which
  GNU prints unpadded. The one combination that would have shown it, more than one count from a stream,
  was never written, because nobody needs three columns from their `wc` in order to test something else.
- **`cat`'s options were filenames.** `cat -n f` reported "cat: -n: No such file or directory" — a real
  GNU flag, reported as a missing file, blaming the caller for what the program had not implemented.
- **`cat` stopped at the first file it could not open.** `cat missing f` printed the complaint and none
  of `f`, exiting 1. GNU prints `f` and exits 1. My favourite of the four, because the status is *right*
  and the output is quietly short.

### Why a broken fixture is worse than an untested corner

Test suites have a foreground and a background. The foreground is what each case is about. The
background is everything the case needs in order to exist: the fixture generator, the temp directory
helper, the process runner, the fake clock, the thing that fills a database with rows.

The background is code you have unusual confidence in, because it appears in a hundred passing tests.
That confidence is misplaced in a specific way: those hundred passes tell you the background behaved
*consistently*, not that it behaved *correctly*.

And a broken fixture usually does not fail loudly — it produces less input, or different input, and the
foreground test still passes against an oracle fed the same broken input. My `seq 100000 -1 1` produced
nothing at all, so the `sort` case I was writing compared two empty outputs and would have passed. **A
test that compares nothing to nothing is the most confident-looking green there is.**

## Two habits, and the second is the one I keep relearning

**Compare the thing that is defined, not the thing that is convenient.** GNU's error *messages* are its
own; comparing them means comparing dialects, so for a long time the comparison was only stdout and the
status. Then fault categories arrived and the wording became derivable — "No such file or directory" is
what GNU says for `NOT_FOUND` — and now nine programs match GNU's stderr line for line, including each
one's peculiar prefix (`head` says "cannot open 'x' for reading", `sort` says "cannot read: x", `rev`
says "cannot open x"). What is comparable grows as your model gets better. A directory's size never
became comparable and never will.

**Check that the test can fail.** A differential test is not exempt from being vacuous. One of mine
looked for a marker in the process table to prove a launcher had killed its child; it passed in 39
milliseconds because the *launcher's own* command line contained the marker, so the thing it found was
never the child. Another built a shell without write permission and cheerfully proved that `rm -f`
suppressed the error — every removal was being denied for a reason that had nothing to do with the flag.
Now, when I add a case for a fix, I revert the fix and watch the case fail before I believe it.

## What I did about the blind spot

Two things, and only one of them is "fix the bugs".

**Ask each tool a question instead of using it to ask one.** The corpus now has cases whose subject is
`seq` itself: every argument form, counting down, the zero increment, a fourth operand, an argument that
is not a number. Same for `cat`'s nine flags. Boring cases about boring programs, and exactly the ones
that were missing.

**Enumerate what the real tool has, instead of guessing.** The strongest test in the suite reads the
installed GNU tools' own `--help`, extracts every short option, and asserts that mine never calls one of
them "invalid":

```ts
for (const m of help.matchAll(/^\s+-([a-zA-Z])[,\s]/gm)) letters.add(m[1]);
```

It does not check that the options *work* — that is the corpus's job — only that a gap announces itself
as a gap rather than as a user error. And because the list comes from the machine's own coreutils rather
than a table I wrote, it cannot drift.

`seq` and `cat` were excused from that test with a comment saying they "take no letter this cares
about". GNU's `seq` has `-f`, `-s` and `-w`. GNU's `cat` has nine. The excuse was written by someone who
had never asked those two programs a question either. He and I have the same name.

## The cost, honestly

You need the oracle installed, which means the tests are only as portable as your dependency on `bash`,
`coreutils`, `python3`, `ssh`. Every one of ours skips loudly rather than silently when its oracle is
missing, which is a small amount of code and the difference between "36 cases ran" and "36 cases were
skipped and you read the word ok".

It is also slower. The shell's corpus spawns two processes per script; the suite is around a thousand
tests and takes ninety seconds, most of it in exactly this.

And it does not tell you what *should* happen where the oracle is silent, ambiguous, or wrong for your
context — which is where the interesting design decisions live. We refuse `[c*n]` in `tr` where GNU
implements it, we bound loops at 100,000 iterations where bash runs forever, and `wc - < f` prints wider
columns than GNU because GNU asks the file descriptor how big it is and we have no way to. Each of those
is written down next to the code rather than discovered later.

Which is the real value, in the end. The oracle does not make the decisions, and it does not ask the
questions. It makes the *undecided* things visible when you ask, and there are always far more of those
than you think — most of them in the parts of the suite you stopped looking at because they work.
