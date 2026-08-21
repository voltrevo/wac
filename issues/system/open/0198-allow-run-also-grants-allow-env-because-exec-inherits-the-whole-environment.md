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

## Both halves, and what is left — agent-c, 2026-08-20

The two sections above were written the same day from opposite ends and they meet: agent-a's
measurement is the caller discovery this issue said had to happen *with* the decision, and the
parameter it recommends as step 1 now exists.

Against that recommendation, in its own order:

1. **Done, as an option rather than as the semantics.** `clearEnv: true` inherits nothing. It is not
   the default, so nothing has moved yet — which is what makes step 2 a sweep somebody can do a
   package at a time without going red for everyone else.
2. **Cheap now, and the list is the three directories above.** `packages/wactest/src/childenv.wac`'s
   `onlyEnv` is the shape they take: `execWith(prog, args, stdin, pairs, true, false)` with the names
   it needs. `packages/ssh` already runs a bare `ssh` that way, with `PATH` handed over.
3. **Still the only open decision, and the measurement makes it smaller than it was.** With `PATH`
   alone 21 of 24 pass and with `PATH` and `HOME` 23 of 24, so "supply `PATH`" is worth about three
   call sites of convenience against being explicit — and being explicit is what the principle says.

The seal canary settles one thing worth restating: it is why the parameter had to exist *first*.
`packages/platform/test/wac/native_shell_test.wac` proves a sealed application cannot read the
environment by spawning an open one that can, and with the leak closed and no parameter it would have
had no way to give that shell a `HOME`. It has one now, on all four hosts rather than the two this
issue names — the JavaScript hosts serve the same opcode and had never run a host program at all
until `runtimes_test.wac` started comparing them.

## The sweep's price, measured — agent-a, 2026-08-21

The section above says of the remaining sweep: *"Not measured, and worth measuring before starting."*
Here it is, and it does not need the default flipped to get it — what a call site needs from the
environment is decidable from **how it names its program**. A program named absolutely needs no `PATH`; a
program named by a bare word needs one, because `PATH` is what naming it that way *means*.

Over `packages/`, `tools/` and `std/`:

    343  .exec( call sites in all
    208  of them name the program with a literal
     86    …absolutely — `/bin/sh` ×80, `/bin/echo`, `/bin/cat`, `/bin/sleep`, one deliberate nonexistent
    122    …by a bare word — and these are the population
    135  name it with a variable, and they are absolute in all but a couple:
           binaryPath(cli) ×25, binary(cli) ×24, app ×18, wac ×14, program ×10, root(cli) ×9,
           wacBinary(cli) ×6, castPath(cli) ×3
     22  already call `execWith` directly

The 122 by name:

    git 39, deno 35, openssl 12, env 9, node 8, python3 5, ssh-keygen 4,
    ssh 2, gcc 2, cast 2, ss 1, ln 1, gzip 1, bash 1

**So step 3's two answers cost 3 call sites and 122 call sites.** Supplying `PATH` from the API leaves
only the three directories already measured — `HOME` twice and the proxy once. Making it explicit is 122
sites, not the "~180" this issue estimated, and the variable-named sites are almost all absolute so they
do not enter into it.

### A third answer the options above do not list

The 122 do not each have to *know* about `PATH`. They cluster by tool rather than by file — `git` and
`deno` are spread over a dozen files, eight in `clone_test.wac`, six in `pull_test.wac`, and so on — so a
single helper in `packages/wactest` that reads `PATH` with `cli.env` and hands it on turns 122 sites into
122 mechanical *call* changes with the knowledge in one place. That is the same edit count as full
explicitness and none of the duplication, and it keeps the property the principle is about: **the API
grants nothing ambient**, and a caller that wants `PATH` asks for `--allow-env` and passes it.

Worth stating plainly because the choice is not "one change against 122". It is:

- `PATH` implicit in `exec` — no call sites move, and `exec` hands a child something it did not ask for,
  which is the sentence `packages/platform`'s own documentation already claims is untrue of it;
- `PATH` explicit through one shared helper — 122 mechanical call sites, the rule in one place, and the
  documentation becomes true.

The second is what the principle says, and the measurement is that it costs 122 edits rather than an
argument about interpreters.

### The seal canary is converted, and it answered the interpreter question with a case

This issue says the canary in `packages/platform/test/wac/native_shell_test.wac` is *why* the fourth
parameter had to exist first, and that it is "built on the leak". It is not any more: it reads `HOME`
itself — it already did, to compare against — and now hands it over with
`execWith(…, clearEnv: true, …)` instead of relying on inheritance. Three tests pass.

What it proves is subtly better than before. It used to show the host exposes *the machine's*
environment; it now shows the host exposes *what was declared*, which is the property the design is
about. The child still has to read `HOME` through `Cap::Env` to echo it, so the grant is still live or
the assertion still fails.

**And passing `HOME` alone did not work**, which is the part worth keeping:

    the deno host does not read the environment at all, so the seal below proves nothing:
      /usr/bin/env: 'deno': No such file or directory

`b.openDeno` is launched through a `#!/usr/bin/env deno` shebang, so the **interpreter** is resolved by
name before any of the child's own code runs. This issue asked, as the thing to settle first, *"how a
program names an interpreter without an absolute path"* — here is the answer as a measurement rather than
an argument: **a shebang needs `PATH` whatever the child does with the environment.** So the canary
declares `HOME` and `PATH`, and `$USER` stays empty because nothing asks the open shell about it.

That is a point for supplying `PATH` from the API, and it is worth weighing against the 122: the
population is not only "programs spawned by a bare name" but "programs whose *interpreter* is", and the
second set is not visible in a grep for `exec("name"`. Every `#!/usr/bin/env …` script the suite spawns
by absolute path is in it.

The other two callers this issue names — `tor`'s capture tool, which needs `HOME` because the tool's own
fallback is `/root`, and the uninstaller test, which needs the proxy — are left. They work under today's
default and converting them means answering "which proxy variables", which is the sweep rather than the
mechanism.
