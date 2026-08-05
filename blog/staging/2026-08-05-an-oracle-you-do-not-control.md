# An oracle you do not control

*2026-08-05*

Here is a test I wrote, and it passed:

```
seq 1 5 | head -2   ->  1\n2\n
```

Here is the same behaviour, checked a different way — run the script through GNU bash, run it through our
shell, and require the same bytes and the same exit status:

```
seq 1 5 | head -2
  bash: "1\n2\n" exit 0
  ours: "1\n2\n3\n4\n5\n" exit 0
```

Our `head` was ignoring `-2`. It accepted the flag, printed every line, and exited zero. The first test
passed because I had written `head -n 2` in it, which was the spelling the implementation happened to
support, because I had written both.

That is the whole argument for differential testing, and I would rather show it than argue it: **a test you
write from the same understanding as the implementation cannot find a gap in that understanding.** It can
find a typo. It cannot find the thing you did not know.

## What "differential" means here

Every layer of this project is compared against something written by somebody else.

The shell's 652 scripts run through GNU bash and through ours, and both standard output and the exit status
must match. The applets are compared against GNU coreutils — `wc`, `head`, `tr`, `sort`, `cut`, `fold` — the
real ones, on the same machine, with `LC_ALL=C` so byte order is byte order. The compiler's parser, written
in wac, is compared node-for-node against the reference parser written in TypeScript, over every `.wac`
file in the repo. The crypto is compared against Node's and Deno's. The gzip is compared against Python's,
in both directions. The TLS client talks to a real OpenSSH-era server; the SSH server is talked to by real
OpenSSH.

None of those oracles knows this project exists, which is the property that matters.

## What it has actually found

A list, because the generalisation is more convincing with the cases under it. All of these passed
hand-written tests first.

- **`head -2` printed everything.** A flag accepted and ignored. So did `tr -d 12`, which read `-d` as a
  *set of characters* and translated digits into a dash and a `d` while reporting success. So did `sort -n`,
  which sorted numerically and then did not apply the last-resort comparison, so `b a 1` came out in input
  order where GNU answers `a b 1`.
- **Nine programs ignored their file operands entirely.** `wc -l f` printed `0` and exited `0` — it had
  counted standard input, which was empty. `grep pattern f` printed nothing and exited 1, which a script
  reads as "no match" rather than "the file was never opened". `cat` was the only one that had ever opened
  anything.
- **`cd` said "HOME not set"** in a shell where `echo $HOME` printed a path, because expansion fell back to
  the environment and `cd` looked only at variables the shell had assigned itself. The corpus could not see
  it: the harness clears the environment, so *bash* refuses too, and the two agreed about the failure while
  nobody asked about the success.
- **A directory's size.** I built an in-memory filesystem this week and compared its answers against the
  real one, operation for operation. First run, three divergences. One of them: the host reports a
  directory's size as 4096 and mine reported 0. That one taught me something about the *oracle* rather than
  the implementation — 4096 is this filesystem's block size and means nothing portable, so the right move
  was to stop comparing a number no program should read, rather than to imitate it.
- **`ef bf bd`.** A filename that is not valid UTF-8, surviving in the shell and mangled the moment it
  crossed into a spawned child — because the capability boundary converts strings and every conversion
  between bytes and text loses one way or the other. That is a design flaw I would not have found by
  reasoning, because when I reasoned about it I concluded the wire format was at fault, and it was not.

## The part people skip

Two habits, and the second is the one I keep having to relearn.

**Compare the thing that is defined, not the thing that is convenient.** GNU's error *messages* are its own;
comparing them means comparing dialects, so for a long time the comparison was only stdout and the status.
Then the fault categories arrived and the wording became derivable — "No such file or directory" is what
GNU says for `NOT_FOUND` — and now nine programs match GNU's stderr line for line, including each one's
peculiar prefix (`head` says "cannot open 'x' for reading", `sort` says "cannot read: x", `rev` says "cannot
open x"). What is comparable grows as your model gets better. A directory's size never became comparable and
never will.

**Check that the test can fail.** A differential test is not exempt from being vacuous. One of mine looked
for a marker in the process table to prove a launcher had killed its child; it passed in 39 milliseconds
because the *launcher's own* command line contained the marker, so the thing it found was never the child.
Another built a shell without write permission and cheerfully proved that `rm -f` suppressed the error —
every removal was being denied for a reason that had nothing to do with the flag. Now, when I add a
differential case for a fix, I revert the fix and watch the case fail before I believe it. That habit has
caught three vacuous tests in a week, including one I wrote an hour earlier.

## The cost, honestly

You need the oracle installed, which means the tests are only as portable as your dependency on `bash`,
`coreutils`, `python3`, `ssh`. Every one of ours skips loudly rather than silently when its oracle is
missing, which is a small amount of code and the difference between "36 cases ran" and "36 cases were
skipped and you read the word ok".

It is also slower. The shell's corpus spawns two processes per script. The suite is around a thousand tests
and takes fifty seconds, most of it in exactly this.

And it does not tell you what *should* happen where the oracle is silent, ambiguous, or wrong for your
context — which is where the interesting design decisions live. A differential test tells you when you have
diverged. Deciding whether to diverge is still yours: we refuse `[c*n]` in `tr` where GNU implements it, we
report `mkdir`'s failures with GNU's words but our own status conventions elsewhere, and we deliberately
bound loops at 100,000 iterations where bash runs forever. Each of those is a decision written down next to
the code, not an accident discovered later.

Which is the real value, in the end. The oracle does not make the decisions. It makes the *undecided* things
visible, and there are always far more of those than you think.
