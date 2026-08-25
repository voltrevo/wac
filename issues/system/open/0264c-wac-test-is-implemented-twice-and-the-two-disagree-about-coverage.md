# 0264c — `wac test` is implemented twice, and the two disagree about `--coverage <directory>`

- **Status:** open
- **Reported by:** agent-c, 2026-08-25
- **Kind:** decision
- **Symptom:** the same command prints a different report depending on which host runs it

`issues/system/0257c` ruled that a host may implement **running a module** and must not implement the
**command surface**. `test` was in its table as a row to move, and I closed that issue saying the table
was empty. It was not: `native/v8/src/main.rs` still has a complete `wac test`.

    fn test_command                   441 lines
    plus collect_tests, write_aggregate, test_module_key, build_and_call, closure_of

It intercepts `test` before the fall-through, so **on the native binary the program's `wac test` never
runs.** The three hosts agree in `commandparity_test.wac` because the Rust one was made to agree, which
is the arrangement rather than evidence about it.

## Where they do not agree, measured

Three test files in a directory, one with no branch, one with an `if`, one with a nested `if`:

    $ wac test --coverage covprobe          # the native binary — a report per file
    branch coverage: 1 of 1 points (100%)
          1 / 1     covprobe/a_test.wac
    ── covprobe/b_test.wac
    branch coverage: 2 of 3 points (66%)
          2 / 3     covprobe/b_test.wac
    ── covprobe/c_test.wac
    branch coverage: 3 of 5 points (60%)
          3 / 5     covprobe/c_test.wac

    $ wac prog.wasm test --coverage covprobe    # the program — one aggregate
    branch coverage: 6 of 9 points (66%)
          1 / 1     covprobe/a_test.wac
          2 / 3     covprobe/b_test.wac
          3 / 5     covprobe/c_test.wac

Neither is wrong arithmetically — 1+2+3 covered of 1+3+5 points — and that is the problem: they are two
answers to one command. The program's is the one to keep, both because the rule says the program is the
implementation and because a directory's coverage is one number.

## Why no test caught it

`tools/wac/testflagrows_test.wac` exists because `--verbose` was a flag `wac test` accepted and no
differential row exercised. It checks that **every flag appears in some row** — and `--coverage` does,
for a single *file*. The flag-with-a-directory combination has no row.

**So the guard is per flag and the behaviour is per flag *and argument shape*.** That is worth fixing in
the guard as well as here: `--coverage <file>` and `--coverage <directory>` are different code paths in
both implementations, and only one of them is compared.

## What makes the deletion safe, and what does not

**Nothing consumes the native's shape.** All thirty-odd `deno task coverage:*` tasks run a
`cov_ledger.wac` program through `wac run`; none parses `wac test --coverage`. Checked by grep, not
assumed.

**What is not safe today is running it.** `wac test` is how the whole suite runs — `tools/runTests.wac`
and every per-file invocation — so replacing it wants the suite, and the suite gate has been refusing
for memory all day (eighteen attempts, 4930–5520 MB against a 5500 MB floor, three agents on the
machine). The parity differential covers 41 invocations across three hosts and several are `test`, which
is good coverage and not the same as "the suite passed".

So: the deletion is a gate-day job. The order when it comes:

1. add a parity row for `test --coverage <directory>` — it goes red, which is the point;
2. delete `test_command` and its five helpers, letting `test` fall through to the seed;
3. the row goes green, and about 700 lines of the host go with it;
4. widen `testflagrows_test.wac` from *flag* to *flag and argument shape*, since that is the guard that
   would have caught this.

## The deletion is blocked, and by the thing that explains why the duplicate exists — agent-c, 2026-08-25

I tried it. Removing the two-line interception is enough to route `test` through the fall-through, and
`cargo build` then names the dead code itself — **six** functions, not five: `test_command`,
`collect_tests`, `write_aggregate`, `test_exports_of`, `cpu_millis` and `build_module`. `closure_of`,
`test_module_key` and `build_and_call` stay, because `run` uses them.

Then the suite's own oracles fail:

    wac test packages/wacc/test/wac/typecheck_test.wac
      FAIL test_rung3_the_references_own_tests — the oracle ran — Not granted to this application

    wac test packages/codec/test/wac
      FAIL test_base64_encoding_matches_an_external_encoder — the oracle answered for
           every input: got 0, want 201

Both spawn a process — the rung-3 oracle and a `python3` base64 encoder — and neither can, however many
`--allow-run` flags are on the command line.

**Because the fall-through's grants are baked, not parsed.** `run_seed` builds an `AsChild` carrying
only `argv` and hands the seed's own manifest to `run_as_with`, so the program runs with the grants
compiled into it — and `tools/seed.sh` builds the seed with `--allow-read --allow-write --allow-env
--allow-net` and no `--allow-run`. A flag on the command line reaches the program's *argv* and not its
capabilities.

That is what the host implementation is buying, and this page did not know it: `test_command` parses
`--allow-*` at run time and grants what it finds, which a baked manifest cannot do. So the 700 lines are
not a duplicate of the program's command — they are a duplicate *plus* a capability the other route has
no way to obtain.

## What would unblock it, and what would not

- **Not `--allow-run` in `tools/seed.sh`.** It would fix these two tests and give every `wac` invocation
  the right to spawn, for ever, ambiently — against the operator's principle that a program gets what
  it is granted. `wac check` would be able to start processes.
- **The seam is `AsChild`**, which already carries `argv` from the command line to the program. A
  grants field beside it — parsed from the command line, intersected with the manifest's so it can only
  ever *narrow* what the artefact asked for — is the shape that makes the fall-through equal to the
  host path without widening anything. `packages/wac/src/grants.wac` is the narrowing already written
  for the program side (`issues/system/0257c`), so the two would agree on the rule.
- **Then the deletion is the four steps above**, and the `test --coverage <directory>` row goes green
  because there is only one implementation left.

**Still worth doing, and bigger than it looked.** The disagreement this issue reports is real and the
deletion is right; what it needs first is a way for a command-line grant to reach a baked program. Filed
against this issue rather than a new one, because it is the same subject: the host implements the
command *because* it implements the granting.
