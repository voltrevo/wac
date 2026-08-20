# 0198 — `--allow-run` also grants `--allow-env`, because `Cli.exec` inherits the whole environment

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-18
- **Kind:** bug
- **Symptom:** no error

## The measurement

A wac test granted `--allow-run` and **not** `--allow-env`, spawning `printenv` through `Cli.exec`:

    HOME direct:       /home/claude          status=0
    HTTP_PROXY direct: http://gateway:3128   status=0
    count of vars:     37                    status=0
    shell override:    /tmp/proof            status=0

Thirty-seven variables, including the proxy the container reaches the network through. The last line
is `/bin/sh -c 'HOME=/tmp/proof printenv HOME'`, showing a caller can also *override* one.

`packages/platform`'s own documentation says the opposite, and says it deliberately:

> `Cli.exec(program, args, stdin)` starts a child with **no environment at all**. That is deliberate
> and the reason is good: an inherited environment is a capability nobody declared, and this
> repository does not hand a program anything it did not ask for.

That is `issues/system/0182`, quoting the design. The implementation is `native/v8/src/main.rs`:

```rust
let mut cmd = std::process::Command::new(&path);
cmd.args(&argv)
    .stdin(std::process::Stdio::piped())
    ...
```

`std::process::Command` inherits the parent's environment unless told otherwise, and nothing here
calls `env_clear()`. So the grant `run` silently carries the grant `env` with it: a program that was
refused `--allow-env` reads any variable it likes by spawning something that prints it.

That is the **no ambient capabilities** principle inverted — a program gets what its *host* had,
rather than what it declared.

## Why this is filed rather than fixed

`env_clear()` is one line and it is not the fix, because clearing the environment removes `PATH`.
Every oracle in this repository is spawned by name — `cli.exec("deno", …)`, `"node"`, `"git"`,
`"python3"`, `"ssh-keygen"` — and a child with no `PATH` cannot resolve any of them. So the one-line
version turns a silent over-grant into a broken test suite for everybody, which is the change
`CLAUDE.md` says to file rather than make.

The fix is the fourth parameter `issues/system/0182` already proposes — `exec(program, args, stdin,
env)`, total, nothing inherited — plus an answer for how a program names an interpreter it does not
have an absolute path to. Those are one decision, and they should be taken together rather than the
leak being closed first and the callers discovered afterwards.

Until then, **nothing here is blocked by the environment**, which is the other half of this and is
written up in `0182`.

## What it means for anything that reasoned about the old behaviour

Two documents describe a limit that does not exist, and both drove real decisions:

- `issues/system/0182` lists six `packages/git` tests as blocked on this and says of three of them
  that they want the environment "for a reason nothing in the repository can work around, because
  the proxy is how this container reaches anything at all". The proxy variable is inherited today,
  so those three are not blocked. Corrected there.
- packages/git/test/status.test.ts and configchain.test.ts carry headers saying they stayed
  host-side for this reason.

The security question and the migration question point in opposite directions here, which is worth
saying plainly: the tests are unblocked *because* of a defect. Converting them is fine — they can
declare what they need on a `/bin/sh -c` line, which is what the `exec` doc points a caller at and
which keeps working after the leak is closed — but a conversion that silently *relies* on
inheritance would break on the day this is fixed.

## The mechanism exists — 2026-08-20, agent-c

`issues/system/0182`'s parameter landed and is closed. `Cli.execWith(path, args, stdin, env,
clearEnv, inherit)` with `clearEnv: true` hands a child exactly what it was passed and nothing else,
on all four hosts — `env_clear()` on the two Rust ones, `clearEnv` on Deno's `Command`, and an
explicit `envRecord(env)` instead of `{...process.env, ...}` on Node's `spawn`.

**This issue is still open, and what is left of it is the sweep rather than the mechanism.**
`Cli.exec` — the three-argument method 342 call sites use — passes `false`, so the over-grant is
exactly as it was. Closing this means flipping that one `false` to `true` and then answering, per
call site, which inherited variable it was relying on.

The question this issue said had to be answered first — how a program names an interpreter without an
absolute path — has an answer that is now measured rather than argued:
`packages/ssh/test/wac/wacsshd.wac` runs a bare `ssh` under `clearEnv: true`, with `PATH` among the
`NAME=value` strings it hands over, and its twelve tests pass. So the shape of every fixed call site
is "read what you need with `cli.env`, pass it on" — which needs `--allow-env`, which is the
principle rather than a wrinkle. A caller granted `run` and not `env` cannot pass `PATH` on, and
should be naming its program absolutely.

**What the sweep is likely to cost, so whoever takes it can price it.** Not measured, and worth
measuring before starting: the callers that spawn `deno`, `node`, `git`, `python3` and `openssl` by
name are the population, and the ones reaching the network need `HTTP_PROXY` as well as `PATH`. A
first pass could flip the default and let the suite name the sites, which is cheap to run and reads
as a hundred failures rather than a list — or `execWith(..., clearEnv: true, ...)` could be adopted
one package at a time under the current default, which is slower and never red for anyone else.
