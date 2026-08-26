# 0261c — `env` cannot say whether a variable is unset or withheld

- **Status:** open
- **Reported by:** agent-c, 2026-08-25
- **Kind:** decision
- **Symptom:** none today — a distinction the type cannot express

`Cli.env` is `fn[Pending<u8[]?>(string)]` and null means two things: the variable is not set, and this
program was never granted the environment. Since `issues/system/0256c` closed, all four hosts agree on
that null — which was the urgent half, because they used to disagree — and this is the half left over.

**It is the same conflation `issues/system/0238c` removed from `Socket`**, for the reason given there:
a caller acts differently on the two. "`$HOME` is not set, so use a default" and "I cannot read the
environment, so tell the operator to pass `--allow-env`" are different programs.

Nothing is wrong today, which is why this is a decision and not a bug: every current caller treats
null as "fall back", and falling back is right in both cases. `packages/sh/src/exec.wac:670` is the
closest to caring — `this.cli.env(name).wait() is not null` implements the shell's `${x+set}` — and a
sealed shell reporting every variable as unset is arguably correct.

## What it costs, measured rather than guessed

A shape that can say which — `Pending<EnvValue>` with bytes, presence and a fault, as `FileResult`
and `Change` and `Socket` have — reaches:

    std/platform.wac            the `Cli` field, `Cli.of`'s forty positional parameters, the docstring
    four hosts                  provider.ts (Deno, Node, browser), native/v8, native/ (wacland)
    packages/platform/src/frame.wac    `childCli` passes `env` through
    packages/wac/src/grants.wac        `noEnv`, the narrowed refusal
    packages/sh/test/wac/probe.wac     `fakeEnv`, and `Cli.of` is positional so the shape must match
    13 call sites               `git` (2), `ssh` (3), `sh` (2), `wacc` (1), `wac` (4), tools (1)

Plus `deno task gen:core` and a reseed, because `std/platform.wac` is embedded.

**`Cli.of` being positional over forty fields is the risk, not the count.** A parameter list a
character wrong wires a capability to its neighbour and compiles — `packages/wac/src/grants.wac` says
so where it explains why its refusals are named functions rather than lambdas. Whatever does this
should change the arity, so every out-of-date caller fails to compile rather than one of them silently
answering the wrong question.

## Why it was not done with 0256c

The suite gate has been refusing for memory all day — nine attempts, 4849–5520 MB against a 5500 MB
floor, with three agents on the machine. Landing the widest seam in the repository without the suite is
the wrong risk, and the divergence between hosts was the part that could not wait. `0256c` took option
one and said so.

The cheap sequencing note: this wants doing when the gate is available, and it wants doing *before*
anything else grows a caller of `cli.env`.
