# 0182 — `Cli.exec` passes no environment, so a wac test cannot drive a program that reads one

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-17
- **Kind:** missing feature
- **Symptom:** not implemented

## What is wanted

`Cli.exec(program, args, stdin)` starts a child with **no environment at all**. That is deliberate
and the reason is good: an inherited environment is a capability nobody declared, and this repository
does not hand a program anything it did not ask for. `packages/http`'s oracle already works around it
by taking `--nudge-ms=` on the command line instead of `WAC_HTTP_ORACLE_NUDGE_MS`.

The workaround stops working when the program under test is **not ours to change**, or when what it
reads from the environment *is the thing being tested*.

## The six tests behind it, measured 2026-08-17

All six are `issues/system/0161` conversions that stopped at this gap, and they are **six of the
eight tests left in `packages/git`** — the other two are already converted. They are not the same
problem repeated: each wants the environment for a different reason, and the last three want it for
a reason nothing in the repository can work around, because the proxy is how this container reaches
anything at all.

| test | what it needs | why an argument will not do |
|---|---|---|
| `packages/git/test/configchain.test.ts` | `HOME`, `XDG_CONFIG_HOME` | The subject *is* which config file git reads. The fixture makes four levels disagree and walks down them; naming the files on a command line would test a different program. |
| `packages/git/test/status.test.ts`'s `core.excludesFile` | `HOME` | `~/.gitignore_global` — expanding the `~` is what proves the `env` grant is real, and the test says so. |
| `packages/git/test/commit.test.ts` | `GIT_AUTHOR_DATE` | `gitci` honours it so two runs of one tree name the same commit. Without it the clock is used and the content-addressing assertion — commit twice, get the same sha — cannot be made. |
| `packages/git/test/lsremote.test.ts` | `HTTP_PROXY` | Measured, not inferred: `wac run … gitls.wac -- https://github.com/…` lists the refs with the variable set and fails with `failed to lookup address information` without it. This container reaches nothing except through Squid. |
| `packages/git/test/clone.test.ts` | `HTTP_PROXY` | Same, one layer up. |
| `packages/git/test/fetchlive.test.ts` | `HTTP_PROXY` | Same. |

The third is the one that shows the shape of the problem best. `gitci` reads `GIT_AUTHOR_DATE`
because **git does**, and it does that so a commit is reproducible. Adding a `--date` flag to `gitci`
to make the test convertible would be changing the program to suit the test.

## What it would take, and why this is filed rather than done

The obvious answer is a fourth parameter — `exec(program, args, stdin, env)` — where `env` is an
explicit map the caller builds. That keeps the principle: nothing is inherited, everything passed is
declared at the call site. It is what `Deno.Command`'s `{ env, clearEnv: true }` already expresses,
and every one of the three tests above wrote exactly that.

Two things make it a decision rather than a patch:

- **`Exec` is a capability and its shape is a promise.** Adding a parameter changes every call site
  and every implementation of the seam — `packages/platform`'s three hosts and whatever else provides
  one. That is the sort of change `CLAUDE.md` says to file rather than guess at.
- **Whether an empty map and an absent argument mean the same thing.** "No environment" and "this
  environment, which happens to be empty" are different, and a program that reads `PATH` cares. The
  answer probably has to be that the map is total — what you pass is what the child gets, and passing
  nothing means nothing — but it should be decided rather than fallen into.

Until then those three tests stay host-side and say so in their headers.

## What is *not* blocked, which is most of it

Worth stating so this does not read as a wall. Nine `packages/git` tests set six `GIT_*` variables
for reproducible dates and **none of them read one**: `git -c user.name=… -c user.email=…` commits
happily with an empty environment, and every assertion those tests make compares against git's own
answer for the same object rather than against a remembered string. Two of them got *sharper* for
losing the environment — `history_test.wac` had been comparing a parsed timezone against the literal
`+0000`, which is a claim about the machine rather than the parser, and now reads
`git log --date=raw`.

So the rule when converting: an environment variable in a fixture is usually there for
reproducibility nothing checks. Look for the assertion that reads it before assuming it is needed.

## Renumbered from 0181 — 2026-08-17, by agent-c

Two files claimed 0181 — this one and agent-a's *"the usage test passes or fails on an untracked
per-agent file"* — which fails the uniqueness check in `compiler/wacSpec.test.ts` and made master red for
everybody. Theirs was committed at 20:14 and this at 20:30, so this is the one that moved. Renumbered by
a third agent who ran into the red rather than by either author; nothing else about the issue is changed.
