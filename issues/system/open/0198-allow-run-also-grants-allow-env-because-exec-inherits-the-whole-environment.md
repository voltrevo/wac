# 0198 — `--allow-run` also grants `--allow-env`, because `Cli.exec` inherits the whole environment

- **Status:** open
- **Claimed by:** agent-a, 2026-08-20 — measuring which callers need which variables, which is the decision's missing input
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

## Measured: which callers actually need an environment, and it is three — agent-a, 2026-08-20

This issue says the decision and the caller discovery should be taken together. Here is the caller
discovery, done by taking `env_clear()` and adding back one variable at a time, then running every test
directory that reaches `exec` — twenty-four of them, found by scanning for `.exec(` in each package's
sources and tests.

**With `PATH` alone: 21 of 24 directories pass unchanged.** So the objection at the top of this issue
is the whole of the ordinary case — `PATH` is what "spawn a program by name" *means*, and once it is
back, almost nothing else is missed.

The three that fail name exactly what they need:

| directory | what failed | what it needs |
|---|---|---|
| `packages/tor/test/wac` | a capture tool resolved a path under `/root/` | `HOME` |
| `packages/platform/test/wac` | the seal test's **canary** — see below | `HOME` |
| `packages/wacc/test/wac` | `deno task` could not cache `binaryen@123.0.0` | the network, so `HTTP_PROXY` |

**With `PATH` and `HOME`: 23 of 24.** `tor` goes 45 of 45 and the seal test passes again. What is left
is one test that genuinely fetches from the network, plus a locale finding that is not about this issue
and is filed as `issues/system/0221a`.

So an allowlist of two variables closes **35 of the 37** and breaks one test. That is worth knowing,
and it is *not* the recommendation — see below.

### The seal test's canary is built on the leak, which settles the fourth parameter

`packages/platform/test/wac/native_shell_test.wac` asserts that a **sealed** application cannot read
the environment. Its own comment says why that needs a canary:

> a seal assertion passes just as well against a runtime that never reads the environment for anybody

So beside the sealed app it spawns an **open** shell — one whose world *is* the host's — and requires
it to print the machine's `HOME`. That canary works today **because `exec` inherits**. Close the leak
completely and the canary has no way to give the open shell a `HOME`, so the test that guards this
property stops being able to prove its grant is live.

That makes `exec(program, args, stdin, env)` **required rather than preferable**: the fourth parameter
is what the canary would use, and there is no other route. A `/bin/sh -c 'HOME=… …'` line works for a
caller that knows the value, and this canary does — it reads `HOME` itself to compare against — so the
migration is available. But it has to exist before the leak can be closed, which is exactly the order
this issue argued for.

### And both hosts have to move together

The canary above spawns the open shell on **Deno as well as native**, deliberately, because
*"`Cap::Env` in the native host is a separate implementation from Deno's"*. Both inherit today. So
narrowing only `native/v8/src/main.rs` makes the two hosts disagree about what a child sees, which the
two-host differentials exist to catch. Whatever lands has to land in both.

### Recommendation

Take the fourth parameter, as `0182` proposes, and in this order:

1. add `env` to `exec` on both hosts, inheriting nothing;
2. sweep the three callers above to declare what they need — `HOME` for `tor`'s capture tool and the
   seal canary, the proxy for the uninstaller test;
3. leave `PATH` as the one thing the API supplies, documented as part of what "spawn by name" means,
   or make it explicit too and have all ~180 call sites pass it.

Step 3 is the only remaining decision, and it is now a small one: everything else is measured.
