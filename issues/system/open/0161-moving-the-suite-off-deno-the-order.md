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

**A profile now says whether it is complete — done 2026-08-16.** Two halves of the same gap. A file
whose tests all need a host wrote no profile at all, so *nothing ran here* and *this file was never
asked* were the same observation; it writes one with an empty `tests` map now. And a **mixed** file's
profile listed only what ran, which reads exactly like a complete one — `rsa_test.wac` would have
looked like a file with 3 tests rather than a file with 12 of which 3 ran. `write_profile` records a
`skipped` list, and an empty list is the positive statement that the profile is the truth about the
file. `harness/nativeTestProfile.test.ts` holds all three shapes.

That is the precondition for step 2 rather than step 2: it does not make `mutate` read native
profiles, it makes a native profile safe to read. **The rule step 2 must follow is `skipped` empty,
not `tests` non-empty** — a mixed file's profile is a correct answer to a different question, and
taking it as the file's coverage narrows a sweep to tests that cannot notice the mutant.

## What step 2 actually needs

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

**It is not the mutant compile, which is what I first wrote here.** `mutate.ts` compiles mutants
with the *reference* — `import { wacCompile } from "wac/wacCompile.ts"` — so this morning's wacc
work does not touch it, and it would not matter if it did: one reference compile of
`packages/gzip/src/inflate.wac` is **66 ms**, so 40 mutants is about **3 seconds** of compiling.

**The cost is `buildProfile`,** which runs the whole suite *sequentially and without `--parallel`*,
because the profiler diffs one global counter array and cannot have two tests moving it at once.
That is the 15 minutes.

Which is the encouraging part, because it is exactly what `wac test` replaces. Building profiles for
every wac test file natively:

    WAC_PROFILE=… wac test --coverage packages/     53s, 83 files, 355 tests attributed

**Not the same scope**, and the difference matters: the native run profiles the 355 wac tests, while
`buildProfile` runs everything including the ~180 TypeScript tests that bind wac modules. So this is
not 17x on a like-for-like task. What it does say is that step 2's verification cost is not a fixed
tax — it falls as tests move across, and the wac-test share of it is already 53 seconds rather than
a quarter of an hour.

**There is no cheap scope, and that is the finding.** `--package std` selects nothing because the
curated set does not cover it — the whole set is `gzip` 40, `bytes` 3, `crypto` 1, so mutation
testing here speaks about three packages out of thirty. And `--package bytes`, three mutants, also
exceeds ten minutes: `--package` filters *mutants*, and `buildProfile` runs the suite either way.
The quarter-hour is paid per run whatever you ask for.

That is worth stating on its own, because it means mutation testing is not iterable today. Anyone
changing selection logic — step 2 — cannot try something, look, and try again. Replacing
`buildProfile` with the native profile is therefore not a nice-to-have on the way to deleting
wrappers; it is the change that makes the tool usable, and it happens to be the same change.

## Where the cut falls, for whoever does step 2

`buildProfile` is a loop: for each test file, run `deno test <file>` with `WAC_PROFILE` set to a
temp directory, then read every JSON in it. Sequential, because the profiler diffs one global
counter array. So the change has two halves and they are separable.

**Profiling.** `wac test --coverage` writes the same JSON into the same directory, so for a wac test
file the native command can stand in for `deno test` inside that loop with nothing else altered. The
whole corpus takes 53 seconds against a loop that does not finish in fifteen minutes, and 85 of the
files in that loop are wrappers around wac tests.

**Running.** This is the half that is not a substitution. `mutate` runs a selected test with
`deno test --filter <name>`, and the names in a native profile are the export names — `test_basics`
where the wrapper produced `map: basics`. So selection and execution have to agree about which
spelling they are in, and a mixed set needs `wac test --filter` and `deno test --filter` both, their
results combined. `testCommand` returns one `Deno.Command`; that is the piece to write.

**They are not separable, and I had this wrong.** I first wrote that the profiling half could land
alone because it changes what the profile costs rather than what it says. It also changes the
*names* in it, and that breaks execution silently. A profile built natively holds `test_basics`;
`mutate` then runs `deno test --filter test_basics`, Deno matches substrings, and `test_basics` is
not one of `map: basics`. Checked rather than reasoned:

    deno test --filter "test_basics" packages/std/test/map.test.ts
    ok | 0 passed | 0 failed | 16 filtered out     exit 0

    deno test --filter "map: basics" packages/std/test/map.test.ts
    ok | 1 passed | 0 failed | 15 filtered out

Nothing runs, the command exits 0, and the mutant is recorded as **survived** — a score that goes up because the tests stopped running. That is the exact failure this
issue exists to prevent, and taking my advice would have caused it.

So both halves land together, or the profiling half lands with a name translation: the wrapper knows
its own prefix — `wacTestRun("…/map_test.wac", "map")` — so a native `test_basics` maps to
`map: basics` mechanically, while the wrappers still exist. That is a third option and it is
probably the cheapest, because it keeps execution on the path that is known to work while making
the profile fast enough to iterate against.

The predicate for "this file declares only wac tests" already exists and is worth using rather than
re-deriving: `countTestsDeclaredHere(source) === 0` together with a `wacTestRun(` in the text, from
`harness/testRegistrars.ts` — which exists because two tools once answered that question
differently and 28 tests went invisible.

## The decision in step 4## The decision in step 4## The decision in step 4

31 of the 83 wac test files cannot run under `wac test` at all: every test in them takes the oracle
as a *parameter*, supplied by a host. Same for tier 3's 120 TypeScript files, which spawn `bash`,
GNU `tar`, `openssl`, a real TLS server, C tor.

`wac test` already passes `--allow-*` through, and `packages/box` spawns processes from wac, so the
capability exists. The question is whether a test **should** be a program with grants — and it is a
language-shaped question, not a tooling one, because the answer decides whether "a test" and "a
program" are the same kind of thing here.

Answering it "no" is coherent and costs the 151 files a permanent host-side home, which is a smaller
goal than the one at the top of this issue but an honest one.
