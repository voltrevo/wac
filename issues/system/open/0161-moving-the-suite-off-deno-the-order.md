# 0161 — moving the suite off Deno: the order, and what blocks each step

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-16
- **Kind:** missing feature
- **Symptom:** not implemented

The goal is no Deno or TypeScript after bootstrapping, except where a JS interaction is wanted.
This is the measured shape of that, and the order the steps have to happen in — recorded because I
got the order wrong twice from reasoning about it.

## The surface

628 TypeScript files outside `site/`. **446 are tests.**

| | files | what it needs |
|---|---:|---|
| `wacTestRun` wrappers, registration and nothing else | **37** | the suite to run `wac test` — **done** |
| `wacTestRun` wrappers with other content | 48 | the same, then their extra content moved |
| bind a wac module and assert from TS | ~180 | rewriting as wac tests |
| spawn a real process | 120 | a decision: may a wac test spawn its own oracle? |
| drive `compiler/` directly | 32 | stays until the reference seed retires |
| `harness/` | 27 | mostly evaporates with the above |
| `tools/` | 48 | separate track; several are natural `wac` subcommands |

## The order, and why it is not the obvious one

**1. The suite runs `wac test`.** Done — `tools/runTests.ts`. This had to be first and I twice wrote
that deleting wrappers was "free". It is not: `runTests.ts` ran `deno test` and nothing else, so the
wrappers *are* how 83 wac test files enter the suite. Deleting them first removes the tests.

**2. `tools/mutate.ts` learns to run a wac test.** This blocks step 3, and that is the correction
worth keeping. Mutation testing selects tests from a coverage profile and runs them with
`deno test --filter <name>`; delete a wrapper and the test it named cannot be run at all, so the
mutant is scored against a suite that no longer contains its test. `wac test` now writes the
per-test profile the tool reads (verified 16 of 16 against the Deno path over `map_test.wac`), so
the selection half is ready and the *running* half is not.

**3. Delete the 37 pure wrappers**, verifying mutation scores unchanged either side.

**4. The oracle question**, which is a decision rather than work — see below.

**5. Tier 2, package by package.** **6. `tools/`.**

## The two paths agree, measured over every wrapper

Before any wrapper is deleted, the native profile has to say what the Deno one says. Comparing them
file by file across all 85 wrappers — same test, same set of `file:line` it reached:

    51 files compared: 51 identical, 0 differing
    17 of those are mixed: some tests run natively, some need a host
     1 all[] table differs: packages/tls/test/wac/fuzz_test.wac — explained below
    32 wrote no native profile at all

So attribution is not the risk. Two other things are, and neither was visible before this ran.

**"Runs natively" is per test, not per file.** 17 files have both kinds — `rsa_test.wac` runs 3 of
its 12 tests here, `hash_test.wac` 3 of 8. Deleting one of those wrappers would drop the
oracle-taking tests from the suite while the rest kept passing, and the file would still look green.
The check for step 3 is therefore *"does every test in this file run natively"*, not *"does this
file run"* — which is a different and smaller set than the 52 that report `ok`.

**The one differing `all[]` is the mixed case, not a fault.** `tls/test/wac/fuzz_test.wac` runs 4
tests natively and 8 through Deno, and Deno's table carries 203 lines native's does not — from
`tls/src/client.wac`, `handshake.wac`, `x509.wac`, `crypto/ed25519.wac` and `test/wac/probe.wac`.
Those are reached by the four oracle-taking tests, which the host supplies by binding further
modules; their coverage lands in the same profile. Native never runs those tests, so it never binds
those modules and never learns their lines exist.

That is worth understanding rather than filing: it means a mixed file's native `all` is not the
module's full extent, it is the extent of *what could run*. A reader comparing the two must not
treat native's smaller table as the truth about the file.

**A file whose tests all need a host writes no profile.****A file whose tests all need a host writes no profile.** `run_tests` returns as soon as it finds
nothing runnable, before the profile is written, so those 31 files contribute nothing to a native
profile. That is correct for a run and wrong for a profile: `mutate` reading only native profiles
would treat every line reached solely by those tests as unhit, which is the under-selection this
whole thread is about. Whoever does step 2 should have `wac test` write a profile with an empty
`tests` map in that case, so the reader can tell *nothing ran here* from *this file was never asked*.

## What step 2 actually needs## What step 2 actually needs

- **The two profiles name the same test differently.** Native is the export name, `test_basics`;
  the Deno path is the wrapper's prefix plus the stripped name, `map: basics`. Comparing them at all
  meant normalising. The native names are the durable ones — the Deno spelling is a function of an
  argument that stops existing at step 3 — so `mutate` should learn the native names rather than
  either path being made to match.
- **A narrow plan's files can be mixed.** `runDirs` comes from `profile.home`, and a line covered by
  both a wac test and a TypeScript one yields both kinds in one set. `testCommand` returns a single
  `Deno.Command`; a mixed set needs two and their results merged. This is the part that makes step 2
  a change to a thousand-line tool rather than a dispatch on a file extension.
- Both profiles will exist during the transition, so the reader has to merge them.

## What step 2 costs to verify, which is why it is still open

`deno task mutate --package gzip` did not finish in **15 minutes** — it was still compiling the 40
mutants to find the equivalent ones, with 0 of 40 run. `--package std` selects no mutants at all, so
there is no smaller scope to iterate on.

That is the whole reason this step keeps being deferred rather than done at the end of a session. A
change to test *selection* cannot be checked by reasoning: the failure mode is under-selection,
which shows up as a mutant scored against a suite that no longer contains its test — silently, and
as a *better* score. Confirming it needs a baseline, a run per iteration, and a run after deleting
wrappers, at a quarter-hour each and against a box three agents share.

Two things would change that arithmetic, and one is already half done:

- **The mutant compile is the cost, and it is a wac build.** `issues/lang/0129` took a build from
  4,561 ms to 2,664 ms on `packages/box`, and `linkFiles` from 227 ms to 55 ms. Whatever fraction of
  those 15 minutes is compilation gets that improvement for free, and nobody has re-measured mutation
  testing since. Doing that first might make step 2 ordinary.
- **`--package std` selecting nothing** means the cheapest package to iterate on is unavailable. Why
  it selects nothing is unknown and worth ten minutes of somebody's time before the expensive path
  is taken.

## The decision in step 4## The decision in step 4

31 of the 83 wac test files cannot run under `wac test` at all: every test in them takes the oracle
as a *parameter*, supplied by a host. Same for tier 3's 120 TypeScript files, which spawn `bash`,
GNU `tar`, `openssl`, a real TLS server, C tor.

`wac test` already passes `--allow-*` through, and `packages/box` spawns processes from wac, so the
capability exists. The question is whether a test **should** be a program with grants — and it is a
language-shaped question, not a tooling one, because the answer decides whether "a test" and "a
program" are the same kind of thing here.

Answering it "no" is coherent and costs the 151 files a permanent host-side home, which is a smaller
goal than the one at the top of this issue but an honest one.
