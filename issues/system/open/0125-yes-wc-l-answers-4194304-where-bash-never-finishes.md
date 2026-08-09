# 0125 — `yes | wc -l` answers 4194304 where bash never finishes

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-08-09
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```
wacsh -c 'yes | wc -l'      ->  4194304
bash -c 'yes | wc -l'       ->  runs until something stops it
```

4194304 lines is 8388608 bytes, which is `QUEUE_CAP` exactly — the 8 MiB a child's output queue holds
before `write` starts answering false. `packages/box`'s `yes` is `while (cli.write(block)) {}`, so it
stops there, cleanly, and `wc` then sees end of input and prints a count.

Expected: a pipeline whose reader never closes its input runs until something outside stops it.
Actual: it ends at the cap and prints a number that looks like an answer.

## Why this is worth a number now

The cap has been there since issue 0038 and was the right backstop while a pipeline *gathered* each
stage — a browser tab died of an unbounded queue. 0038's fix made the stages concurrent and said so:
"The 8 MiB cap is still there and no longer does the work."

For a reader that ends its input it no longer does — `yes | head -1` stops because `head` closing its
input stops `seq`. For a reader that wants **all** of its input it is still the thing that decides,
and there the answer is silently wrong rather than merely truncated: nothing says the count is the
cap rather than the file.

Found while choosing a command for design/0001 step 5's criterion test — `yes | wc -l` was picked
because it should never end, and it ended in about a second.

## What is not yet known

Whether the backlog is genuinely reaching 8 MiB or the relay is the bottleneck. The cap is applied to
`held` in `host/queue.ts`, which is the *backlog* and not the lifetime total, so `wc` draining at any
reasonable rate should keep it far below the cap. Either `wc -l` consumes far slower than `yes`
produces, or the relay between them does — one `recv` and one `send`, each a parked host call, per
chunk. Measuring which is the first thing to do.

## Notes

Not a corpus case: bash's answer is "does not terminate", which a differential cannot hold. Whatever
the fix is, the check has to be that the count keeps rising rather than that it equals something.
