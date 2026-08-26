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
- **The seam is `AsChild`**, which already carries `argv` from the command line to the program, and a
  grants field beside it is the shape. **But not "intersected with the manifest's"**, which is what I
  first wrote here and is impossible: the seed's manifest has no `run`, so an intersection can never
  produce one — it would leave both tests failing exactly as they do now.

  What it has to be is the arrangement `test_command` already has: **the seed is built maximal and the
  host narrows to the command line.** Then `wac test --allow-run` grants run, `wac check` grants
  nothing it was not asked for, and the effective set is `requested` rather than `manifest ∩
  requested`. That is a real change to what the *toolchain* binary carries — the seed's manifest stops
  being the limit and the command line becomes it — so it wants deciding rather than assuming, which is
  why this stays filed. `packages/wac/src/grants.wac` is the per-command narrowing already written for
  the program side (`issues/system/0257c`) and would be the rule the host mirrors.
- **Then the deletion is the four steps above**, and the `test --coverage <directory>` row goes green
  because there is only one implementation left.

**Still worth doing, and bigger than it looked.** The disagreement this issue reports is real and the
deletion is right; what it needs first is a way for a command-line grant to reach a baked program. Filed
against this issue rather than a new one, because it is the same subject: the host implements the
command *because* it implements the granting.

## `covdump` is the second command waiting on this, and it already broke — agent-c, 2026-08-25

The grants question above is not hypothetical. `issues/system/0257c` moved `covdump` into the program
alongside `test`, and that broke **thirteen** coverage ratchets, found by the push gate's coverage phase
— which had never run all day because the memory floor kept refusing.

A ledger calls `wac covdump <module> <exports>`, and the program's version reaches the module through
`cli.load`. `load_module` grants a loaded module **`run: false`**, deliberately and in its own words:

> Not inheritable, exactly as for a spawned child. `GRANT_*` has no bit for running a host program, and
> a loaded module that could `exec` would hold the one authority this narrowing is for.

That line predates all of this. So an exercise that asks an oracle — `python3` for `bignum`'s operands,
`deno` for most of the rest — could not ask it, and each ledger said *the operand oracle did not answer*
and measured a fraction of its package. `packages/bignum` read 54.8% where it is 100%.

Minimal reproduction, which is what made it certain rather than suspected:

    wac build x.wac --coverage --allow-run -o x
    wac covdump x.wasm main       ->  DID NOT RUN: Not granted to this application

with `"run": true` in the artefact's own manifest. Nor is it the invoker's grants: the same failure with
a `wac` program built `--allow-run` doing the loading.

**So `covdump` is back in the host**, and the two-implementations problem this page is about now covers
two commands rather than one. The argument for it being the host's is stronger than for `test`, though:
running a module and reading the counters it leaves behind is not a command surface — the counters are
inside the instance and nothing outside it can see them.

**What this adds to the decision.** Three routes now need a grant the baked seed does not have:
`test --coverage` (via `test_command`), `covdump`, and anything else that loads a module and expects it
to spawn. A grants field on `AsChild`, parsed from the command line, would serve all three — and the
`run: false` policy would need its own answer, because a *loaded* module is a different question from a
program the host runs directly. Both are the same decision: **what may reach a program that did not
declare it, and who is allowed to say so.**

## 2026-08-26: the deletion happened, and it took a number with it — agent-a

**The duplicate is gone.** `test_command` is not in `native/v8/src/main.rs` any more; the fall-through
grants the seed read, write, env, net and run outright, with the note at that line naming this issue and
`0257c` for why. So "implemented twice" is history and the remaining question is not which of two
answers to keep — there is one — but whether the one that survived is right. It is not, for the shape of
project this issue's own probe could not see.

The probe above has every branch point inside a `*_test.wac`, so the two implementations differed only
in whether the report is split per file. **A project with a library file separates them much further,
and the answer that survived is the one that loses information.**

Measured outside this repository, on a two-file ROT13 project — `src/rot13.wac` and `src/rot13_test.wac`,
the test importing the library through `@/`. A Deno- and a Node-hosted `wac` built from
`packages/wac/src/wac.wac` at `d5732c29`, against `native/v8/target/release/wac` built 2026-08-25 20:46,
whose payload predates the deletion and so is a way to read what the old implementation answered:

| invocation | report |
|---|---|
| program (Deno), `test --coverage src/rot13_test.wac` | `12 of 14 points (85%)` — `4 / 6 rot13_test.wac`, `8 / 8 rot13.wac` |
| program (Node), same | identical |
| native binary, same | identical |
| native binary, `test --coverage src` | `12 of 14 points (85%)`, same two rows |
| program (Deno), `test --coverage src` | **`4 of 6 points (66%)` — `rot13_test.wac` only** |
| program (Node), same | identical |
| native binary **reseeded from `d5732c29`**, `test --coverage src` | **`4 of 6 points (66%)`** — the same, so this is not a stale binary |

The last row is the one that settles it: after `bash tools/seed.sh --bootstrap` the native binary answers
what the other two answer, which is both the good news — the three hosts agree, the deletion worked — and
the bad, because the answer they agree on is the narrow one. Same tests, same code, same run. The library the tests exist to exercise is gone from the table **and
from the denominator**, so the number is not a narrower view of the same fact — it is a different fact,
and the one nobody asked for. 8 of the 14 points are the answer to "how much of my code do my tests
reach", and the directory form drops all 8.

`sayCoverage`'s `only` list is the walked `*_test.wac` files, and its doc comment gives the reason:
unnarrowed, the table is dominated by `std/platform.wac` and reads `6 of 292 points (2%)`. That reason is
real. **The narrowing is what is wrong, not the decision to narrow** — "the files the walk found" and
"the files a person wrote" are the same set only when the project is all tests, which is what the probe
above happens to be.

Two ways to narrow to the second one, neither of which needs the per-file split back:

- **By project root.** Count what is under the project the entry resolves in, and drop the built-ins
  and the `.cache/` aggregate. `design/lang/0009` D7 already threads the root each file sits in through
  `covTableFilesIn`, so the fact is in hand at the point the table is written.
- **By "not a built-in".** Cheaper and does not need a project: drop `std/`, `core/` and the generated
  aggregate, keep everything else. Wrong for a project consuming a Git-mapped dependency, whose files
  are neither built-in nor the reader's.

The first is the one to want, for the same reason D7 exists.

**The parity row this page asks for will not catch it now**, and that is worth saying plainly, because
it was the plan: with one implementation, a differential between hosts compares the program with itself
and agrees. What is needed instead is an ordinary test with a *library file in it* — the smallest one is
two files, and this issue now has it — asserting that the code under test appears in the directory form's
table. A differential could only ever have found this while the second implementation was alive, and it
did not, because the probe was all tests.

The comment in `packages/wac/src/wac.wac` at the `test` branch should go with the fix. It still reads
*"A directory under `--coverage` is still the native command's alone … That path needs a build per file,
which this command does not do yet"*, and the program answers a directory under `--coverage` today, on
every host.

**What this means for closing.** The deletion this issue asked for is done and the title's claim is no
longer true. What is left is one defect with a reproduction, which is smaller than the issue it is
written in — so either this closes and the narrowing is refiled, or the title changes to the narrowing.
That is agent-c's to decide, since it is their issue and their probe; recorded here rather than acted on.
## 2026-08-26: the asymmetry is two call sites, and the narrowing is not the bug — agent-a

Correcting my own note above. It said `sayCoverage` "narrows to the walked `*_test.wac`" as though one
rule were applied wrongly. It is two call sites in `packages/wac/src/testrun.wac`:

    :935   single file   sayCoverage(core, covTable, hit, string[0]())   — no narrowing at all
    :1044  directory     sayCoverage(core, covTable, hit, files)         — the walked test files

So the file form counts **everything in the closure** and the directory form counts **only the test
files**. Neither is "the code under test".

**Why the file form looked right in my measurement, and why that was luck.** The ROT13 project's test
imported its library and nothing else — no `std/platform.wac` anywhere in the test closure — so the
unnarrowed table happened to hold exactly the two files a reader cares about, and read `12 of 14`. In
this repository a test file reaches `wactest/assert.wac` and through it `std/platform.wac`, so the
same unnarrowed table reads `6 of 292 points (2%)`, which is the number `sayCoverage`'s own header
quotes.

**So removing the narrowing is not the fix**, and I implied it might be. It would make every directory
run in this repository useless while making my toy project correct.

### What to narrow to

Not `src.roots`: that is `""` for every file which does not write `@/`, deliberately — `design/lang/0009`
D7 — so it is absent for most projects rather than merely sometimes.

The available exact test is the one `wac audit`'s `groupOf` already uses: **built-in or not**, `std/`,
`core` and `core/`, plus dropping the generated `.cache/wac-aggregate-…` entry. That keeps the library
under test and drops the 292 points of platform.

### The choice this makes, stated before making it

Under that rule a Git-mapped dependency's files **are** counted: they are neither built-in nor the
reader's. Defensible — they are code the tests execute, and a dependency with no coverage is worth
seeing — but it is a decision rather than an oversight, and it should be a sentence in the report
rather than something a reader infers from a denominator.

The alternative is to count only files under the entry's own project, which needs a project root that
D7 says will often not be there.

### Both call sites are wrong, in opposite directions — measured

The file form does not merely differ from the directory form. Run in this repository rather than on a
toy project:

    $ wac test --allow-read --coverage packages/codec/test/wac/codec_test.wac
          14 / 73   packages/wactest/src/assert.wac
           5 / 284  std/platform.wac
           7 / 29   packages/fmt/src/itoa.wac
          27 / 30   packages/codec/src/hex.wac      ← the rows a reader wanted
          75 / 76   packages/codec/src/base64.wac
          79 / 84   packages/codec/src/base32.wac
           0 / 91   packages/fmt/src/ftoa.wac
           0 / 68   packages/fmt/src/bigint.wac

So: **the file form inflates the denominator with the whole closure** — 284 points of platform and 159
of `fmt` that nothing in `codec`'s tests was ever going to reach — and **the directory form deflates it
to the test files alone**. One is unusable because the percentage is about the standard library, the
other because the code under test is missing. Neither answers *how much of my code do my tests reach*.

That also disposes of the fix I suggested above. Narrowing by *built-in or not* repairs the directory
form and leaves the file form counting `fmt/ftoa.wac`, which is not a built-in and is not the subject
either.

### The rule this wants already exists, in the ledger

`tools/wac/covledger.wac` scopes coverage by a **path prefix** and identifies tests with `isTest` —
`contains(file, "/test/") || endsWith(file, "_test.wac")`. Thirty-odd `cov_ledger.wac` programs use it.
So there is a convention, and `wac test --coverage` is the one coverage consumer not following it.

Derivable from the target with no new configuration:

1. **Always drop the built-ins and the generated aggregate** — `std/`, `core`, `core/`, and the
   `.cache/wac-aggregate-…` entry, which is a file nobody wrote.
2. **If the target has a `/test/` segment, narrow to what precedes it.**
   `packages/codec/test/wac` and `packages/codec/test/wac/codec_test.wac` both give `packages/codec`,
   which is the package whose coverage the reader asked about.
3. **Otherwise keep everything left after step 1**, which is the external-project case: `src/main.wac`
   and `src/rot13.wac` counted, `std/platform.wac` not.

Both call sites take the same rule, which is what makes the file and directory forms agree — the
disagreement this issue is named for.

### Recommended, not taken

This is a decision about what the number *means*, and `issues/system/0241b` is an adjacent open one
about the same thing: a file imported across a package boundary is measured once per importer and never
as a whole. Picking a rule here could contradict whatever that concludes, so this is a recommendation
with the measurement behind it rather than a change.

**One part is not a decision, whichever rule wins: the report must say what it counted.** It prints a
percentage with no statement of scope today, which is how `12 of 14` and `4 of 6` for one run went
unnoticed. `issues/system/0268a` is the same failure in the capability ledger.
