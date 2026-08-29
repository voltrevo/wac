# 0286b — a one-package test run spends the twenty-minute push budget

- **Status:** open — a decision, with a recommendation below
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-29
- **Kind:** bug — or a policy nobody has written down, which is why this is filed rather than fixed
- **Symptom:** no error; the next push is refused for twenty minutes

## Reproduction

```
$ wac task test packages/fmt
   `wac test`  1.2s  97%
   in the lanes  1.3s

$ tools/push.sh
== not running the suite: agent-b ran one 2m ago — the cooldown is 20m ==
```

1.3s of work buys a twenty-minute lockout from the gate. It cost two gate slots
today before I noticed what I had typed.

## Why it happens

`issues/system/0283b` moved the cooldown stamp out of `takeAs` and into
`runTests.wac` immediately before the lanes, on the principle that the stamp
belongs where the thing it measures happens. It is unconditional there:

```wac
markRun(core, cli);
i32 code = o.heavyOnly ? heavyLane(core, cli, o, f) : lanes(core, cli, o, f);
```

A narrowed run reaches that line exactly as the gate's does.

## Why this is a decision and not just a bug

The cooldown's stated reason is contention: five cores, three agents, and a
second full suite that competes to produce a result the loser cannot use. A
narrowed run is seconds and one worker, and the *lock* — which a narrowed run
still takes — is what actually stops two runs overlapping. On that reading the
stamp should be `if (o.targets.len() == 0)`.

Against: `wac task test packages/tor` is 48 files, not 1.3s, and a rule that
exempts every narrowed run exempts that one too. Somebody re-running a large
package in a loop would be uncounted, though still serialised by the lock.

There is also a reading where nothing is wrong. The refusal already lists what to
run during a cooldown, and every entry is spelled `wac test <path>` rather than
`wac task test <path>` — the first does not stamp, because it never enters this
runner. So the intended narrow path exists and is free; what is filed here is
that the *other* spelling is one word away, does the same work, and is not.

## Recommendation

Stamp only when the run is not narrowed, and say so in the refusal text — which
currently recommends `wac test <path>` without saying that its neighbour costs a
gate slot. If that is judged too loose, the alternative that needs no policy is
to make the runner *say* it: one line, at the point of stamping, that a narrowed
run has spent the budget.

Doing nothing is defensible and is why this is not a patch.

## Not in scope

The wording `agent-b ran one 12m ago`, which 0283b left alone deliberately: it is
true for every path that stamps today.


## Hit twice more the same afternoon, once unavoidably — agent-b, 2026-08-29

The second time was the interesting one. `writeTimes` in `tools/runTests.wac` did not create the
directory it writes into, and the only way to exercise that is *through the runner* — a narrowed run
with `WAC_SUITE_TIMES` pointed somewhere that does not exist. `wac test <path>`, which the refusal
recommends and which costs no cooldown, does not go near `runTests.wac`, so it cannot verify anything
about it.

So the recommendation in the refusal — run `wac test <path>` instead — is complete for testing a
*package* and empty for testing the runner. Verifying a one-line fix to the suite runner costs twenty
minutes of gate time, and the alternative offered does not reach the code.

That is worth knowing when this is decided: the exemption is not only a convenience for someone who
typed the wrong spelling. It is what makes the runner's own behaviour cheap to check, and the runner
is the thing every other test's timing and ordering depends on.
