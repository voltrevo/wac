# 0256c — a denied `env` is null on the native hosts and a trap on the JavaScript ones

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-25
- **Kind:** decision
- **Symptom:** wrong answer — the same call answers two ways depending on the host

`Cli.env` is `fn[Pending<u8[]?>(string)]`, and its docstring says what null means:

> One environment value, as bytes. **Null when the variable is unset**, which is not the same as empty.

It says nothing about a program that was never granted the environment, and the four hosts do not
agree about that case. Read granted, env not:

```
$ wac test --allow-read src/env_test.wac                  # the native binary
FAIL test_reads_the_environment — PATH is not readable    # `env` answered null

$ ./wac-deno test --allow-read src/env_test.wac
FAIL test_reads_the_environment — trapped                 # `env` threw
```

where the test is:

```wac
export string test_reads_the_environment(Core core, Cli cli) {
  u8[]? v = cli.env("PATH").wait();
  return v is null ? "PATH is not readable" : "";
}
```

`deny("environment")` in `deno.ts` and `node.ts` throws a `Faulted`, which reaches a wac program as a
trap. The native hosts fold the refusal into the null the type already has.

## How it was found, which is the part worth keeping

**`--allow-env` was a flag `wac test` accepted and no row of `commandparity_test.wac` passed.** That is
the state `--verbose` was in when it did nothing on three hosts for two days, so
`tools/wac/testflagrows_test.wac` now names any such flag; it named this one, the row was added, and
the row disagreed on its first run. The differential found a real divergence within a minute of the
guard finding the hole.

It also showed `issues/lang/0254c` in the wild. In a directory run the env test reported
`trapped: the reason it stopped` — the sentence a `trap "…"` in a *different file* of the same
aggregate had left behind, because nothing clears that global.

## Three answers, and none of them is the current state

- **Null, as the native hosts do.** Smallest, and it makes "you may not ask" indistinguishable from
  "it is not set" — the same conflation `issues/system/0238c` removed from `Socket` for exactly the
  reason that a caller acts differently on the two.
- **Trap, as the JavaScript hosts do.** Unmissable, and wrong for a capability whose type has a way to
  say no: a program that checks `is null` has written the careful thing and dies anyway.
- **A result that carries a fault**, as `FileResult` and `Change` and now `Socket` do. Right, and the
  largest: `env` is called in `packages/git`, `packages/http` and the shell, so the signature change
  reaches them.

The third is the one to want and the first is what to do if it is not worth it. **What is not an
option is the present arrangement**, where the answer depends on which host the program was built for.

## The regression test is already written

`packages/wacc/test/wac/commandparity_test.wac` has an `--allow-env` row, and its fixture is in
`envsrc/` rather than `src/` **on purpose**: in `src/` it also joins the three rows that walk a
directory, where the run grants read and write and not env, and those rows go red. Moving that one
file back into `src/` is this issue's reproduction and its regression test — one path, no new fixture.
