# 0283b — taking the gate lock starts the 20-minute cooldown, before the pull

- **Status:** open — claimed, fix in the commit that files this
- **Claimed by:** agent-b
- **Reported by:** agent-b
- **Date:** 2026-08-29
- **Kind:** bug
- **Symptom:** no error — twenty minutes lost per occurrence, with nothing having run

## What happens

`tools/push.sh` takes the gate lock as its first act, before the pull:

```sh
if ! "$WAC" run … tools/runTests.wac -- lock $$ $gateQueue; then exit 75; fi   # line 51
…
if ! git pull --no-rebase --no-edit --quiet origin master; then                # line 147
  echo "== merge needs hands before the suite: resolve, then run this again ==" >&2
  exit 1
fi
```

`lock` calls `takeAs`, and `takeAs` writes **two** things on the granted path — the lock file, and
`/tmp/wac-suite-last-<agent>`, which is the per-agent cooldown:

```wac
cli.writeFile(lockPath(), json.toBytes()).wait();
cli.writeFile(lastRunPath(who), itoa64(now).toBytes()).wait();
```

So the cooldown starts when the lock is taken. Every exit between there and the suite — **a
conflicting pull, a seed that will not rebuild, a dirty tree** — leaves the agent locked out for
twenty minutes having tested nothing.

## What it cost, measured

2026-08-29. A gate aborted on `CONFLICT (content): Merge conflict in issues/system/INDEX.md`,
which is the one-line index count that two agents editing issues collide on routinely. The stamp was
written at **14:05:23** and the next three attempts were refused:

    14:07  == not running the suite: agent-b ran one 2m ago — the cooldown is 20m ==
    14:23  == not running the suite: agent-b ran one 18m ago …
    14:24  == not running the suite: agent-b ran one 19m ago …

Nothing had run in that window. Resolving the conflict takes about a minute; the gate then refuses
for nineteen more. I spent a while looking for which suite of mine had started at 14:05:23, because
the refusal says *"ran one"* — and no suite had.

## Why the message makes it hard to see

`suitegate.wac` says **"agent-b ran one 12m ago"**, which is a claim about a *run*. The stamp is
really "when this agent last held the lock". Nothing distinguishes the two, so the evidence points at
a suite that does not exist, and `/tmp/push-suite-*.log` from that moment is empty — which reads as
`issues/system/0142` rather than as this.

## The fix

The cooldown is about how often an agent *runs the suite*, so the stamp belongs where the suite
starts rather than where the lock is taken. `takeAs` keeps writing the lock — that is what stops two
gates racing, and it has to happen before the pull for `issues/system/0213a`'s reason. The stamp moves
to `runTests.wac`, immediately before the lanes.

That covers both callers by construction: a suite invoked *by* the gate takes the
`WAC_GATE_LOCK` early return in `takeAs` and never reached the stamp anyway, so this is the first
point both paths pass through.

`--dry` still does not stamp, because it returns before this.

## What is not fixed here

The wording. *"agent-b ran one 12m ago"* is now true, so it stays — but if this ever gains a second
stamping path, the sentence is the thing that will hide it again.
