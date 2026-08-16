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
| `wacTestRun` wrappers, registration and nothing else | **81** | the suite to run `wac test` — **done** |
| `wacTestRun` wrappers that also declare a host test | 2 | the same, then those tests moved |
| bind a wac module and assert from TS | 182 | **63** rewritable; 72 can never be — see below |
| spawn a real process | 120 | a decision: may a wac test spawn its own oracle? |
| drive `compiler/` directly | 32 | stays until the reference seed retires |
| `harness/` | 27 | mostly evaporates with the above |

**Do not classify these files by text scan.** I tried four times and got four different wrong
answers, each confidently derived:

| attempt | said | wrong because |
|---|---|---|
| "asserts a trap" by the word `trap` | 72 | matches comments, and a filename (`i31Trap.test.ts`) |
| "convertible" by absence of markers | 63 | `itoa64.test.ts` has no markers and its oracle is JS BigInt |
| "uses a JS oracle" by `BigInt\|JSON.` | 55 of 61 | mostly `JSON.stringify(got)` in each file's own assert helper |
| files defining `assertTraps` | **4 remaining** | this one is reliable — it is the helper, not a word |

The verifiable facts, and they are the only ones worth planning against:

- **182 `.test.ts` files call `wacBind`.**
- **Ten of them defined `assertTraps`, and all ten are converted** — that grep now finds nothing.
  But it was never the whole set: `packages/tls/test/keyschedule.test.ts` asserted traps with a
  three-line local `traps(f)` closure and no helper to grep for. Its header said it stayed because
  "a trap unwinds the module rather than returning, so wac cannot assert one", which is the same
  belief the other ten were written under. Converted too — its two cases went into the existing
  `test/wac/keyschedule_test.wac`, where the rest of that file had already moved.

  **So there is no grep for this.** A file asserting a trap can spell it any way its author liked,
  and the only reliable signal was the sentence in the header — which is the sentence that turned
  out to be wrong. Expect a few more to surface the same way, by being read.

  Converting them keeps finding that they prove less than they claim, which is the argument for
  doing it by hand rather than mechanically. `wire_traps` is the sharpest so far: its header is about
  a length prefix trusted against the bytes present, and **removing `take`'s bound left every one of
  its cases green** — the overruns promise more than the whole buffer, so the array read traps first
  and the check is never what refuses. It needed a new case, a `take` past the end of a *slice* with
  bytes behind it, where the missing bound answers a short read with somebody else's bytes.
- The rest need **reading**, one at a time, and a minute each is the right minute to spend. A file
  that binds a module and compares numbers may still have JavaScript as its oracle, and no marker
  distinguishes that from arithmetic the language can do itself.

So `test_traps_*` unlocked ten files rather than the seventy-two I claimed for it when I found the
trap behaviour. It is still the right feature — those ten include the framing guards on the side of
TLS that accepts connections from strangers — but the tier it belongs to is small, and the large tier
is the one nobody can count without reading.

**One is done, as the shape for the rest.** `packages/gzip/test/crc32_incremental.test.ts` became
`test/wac/crc32_incremental_test.wac` plus a nine-line wrapper. It built an array, called two
functions and compared two integers; the TypeScript was doing nothing the language cannot. The gzip
suite is 87 tests before and after.

It also deleted a file that existed only to serve the boundary: `crcprobe.wac` was a *probe*
— a wac file exporting `whole` and `chunked` so a TypeScript test could drive them — and with the
test in wac it had no callers at all. That is worth expecting for the other 62: a probe exists to be
reached from the host, and the conversion removes the reason for it.

**The first two rows were 37 and 48 and are measured now — 2026-08-16.** The old split counted a
wrapper with *any* other content as mixed: an import, a comment, a helper. The question step 3
actually asks is narrower — does deleting this file take a test with it — and the predicate for it
is `countTestsDeclaredHere(source) === 0` alongside a resolvable `wacTestRun(`, both from
`harness/testRegistrars.ts`. By that measure **81 files are pure registration and 2 also declare a
host test**, out of 83. So step 3 deletes 81 files rather than 37, and the "extra content to move"
is two files' worth rather than forty-eight.
| `tools/` | 48 | separate track; several are natural `wac` subcommands |

## How to convert one — the recipe, from doing three

Two conversions found four things that cost time and are not obvious. Written down so the next
person does not pay for them again.

**Pick from the list, not by eye.** A file qualifies if it binds a wac module and only compares
values, or if its assertions are traps (`test_traps_*` handles those now). It does *not* qualify if
it spawns a process, opens a socket or wants `node:crypto` — that tier is waiting on the oracle
decision below.

**Write the wac test, then watch it fail.** Mutate the thing under test and confirm the new file goes
red for the reason it exists. This is the step that pays: `packages/json/test/bounds.test.ts`
converted cleanly and *neither* form could distinguish the guard it claimed to be about — removing
both explicit bounds checks left it green, because `items[i]!` traps on the null slot anyway.
`packages/std`'s did keep its discrimination, and only canarying told them apart.

**The probe usually dies with it.** A `test/wac/*probe.wac` exists to be reached from the host —
`crcprobe.wac` exported `whole` and `chunked` so a TypeScript test could drive them. With the test in
wac it had no callers at all. Check and delete; `tools/deadexports.test.ts` will not, since probe
files are exempt from it.

**Deleting the file breaks its citations.** Both conversions were cited elsewhere as *the shape* for
that kind of test — five files across `ens`, `crypto` and `rlp` pointed at `packages/std/test/traps.*`
alone. `deno task docs` catches every one through the backticked-path check, so run it before
pushing rather than after.

**`deno task docs` finds backticked paths, not paths passed as arguments.** It caught the citations
in all six conversions and missed one: `packages/crypto/cov.ts` instruments the trap fixture through
`instrument("packages/crypto/test/wac/traps.wac")`, which is a string argument rather than a
backticked path in prose. So `grep -rn <basename>` as well, and run the package's `coverage:` task if
it has one — a `cov.ts` naming a file that no longer exists fails at run time, not at check time.

Then: a nine-line wrapper so both lanes run it, `deno task seed` if `packages/wacc/src` moved under
you, and the package's own suite plus `deno task docs`.

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

**Three wrong answers about the cost here, and this is the measured one — 2026-08-16.**

Not the mutant compile: 66 ms each, about 3 seconds for 40.

Then I wrote that it was `buildProfile` — reasoning from its sequential loop, without a clock.
Then I "corrected" that by timing `buildProfile` per package, 9.0s for `packages/gzip` and 23.2s for
`packages/crypto`, and concluded it was small. **That correction was the wrong one, and it was wrong
for the reason the first version was: I measured a narrower thing than the one that runs.**
`buildProfile`'s input is not a package. It is the union of `testDirs` over every mutant, and
`testDirs` gives a mutant every package that imports the file it edits. For `--package gzip` that is
**380 test files across 32 scopes** — `packages/bytes/src/buf.wac` alone has 31 dependents.

Measured end to end, profile only, no baselines and no mutants run:

    deno task mutate --package gzip --explain-selection
    profiling 380 test file(s) across 32 scope(s)…
      profile: 1783 test(s) across 380 file(s), 24853 covered line(s)
    selection: 20 narrowed, 20 widened, 0 unhit, of 40 mutant(s)
                                                        26m45s

So the profile is the dominant cost, it is essentially *the whole repository's suite run one file at
a time*, and it has to be sequential — the profiler diffs one global counter array, so two tests
moving it at once would each be credited with the other's lines.

The per-scope baseline is the second cost and `issues/system/0139` owns it: 4m53s for gzip's scope,
and there are two of them in that run.

**Which puts step 2 back where the first version of this section had it.** `wac test --coverage
packages/` profiles all 83 wac test files in **53s**; those files are 83 of the 380, and the rest are
TypeScript that still needs Deno. So sourcing wac profiles natively is not a rounding error on a
26-minute pass, and the share it removes grows with every test that moves across — which is steps 3
to 5. It is worth doing for speed *and* for what it lets step 3 delete.

**There is no cheap scope, and that part stands.** The whole curated set is `gzip` 40 and `bytes` 3
— `crypto`'s single mutant is gone since this was written — so mutation testing here speaks about two
packages out of thirty. `--package bytes` is no cheaper: `--package` filters *mutants*, and `bytes`
is under 31 packages, so the profile and the baselines are the same size either way.

**`--explain-selection` exists now**, for exactly this. It builds the profile and prints what each
mutant would run — narrowed to which tests, widened to which scope, or unhit — then exits. No
baselines, no mutants, no score. It is how a change to selection logic gets looked at, and it is what
produced every number above. It also surfaced `issues/system/0163`: nine of the 380 files fail under
`WAC_PROFILE`, seven of them the whole of `packages/zstd`, because the profiling path compiles with
the reference compiler and zstd uses a wacc-only method.

## Where the cut falls, for whoever does step 2

`buildProfile` is a loop: for each test file, run `deno test <file>` with `WAC_PROFILE` set to a
temp directory, then read every JSON in it. Sequential, because the profiler diffs one global
counter array. So the change has two halves and they are separable.

**Profiling — done 2026-08-16.** `buildProfile` takes a wrapper's coverage from
`wac test --coverage` when it can prove that is not narrower than the Deno path's, and spawns
`deno test` otherwise. Names are translated to the spelling the wrapper registers, because execution
is still Deno's; a native profile holding `test_basics` against a suite that calls it `map: basics`
filters to nothing, exits 0, and scores the mutant as survived.

Over `--package bytes`, 368 files: **34 taken natively**, 1752 tests either way, selection identical
at 3 narrowed / 0 widened / 0 unhit. Not 81, and that is the `skipped` rule working: 31 wac test
files need a host oracle for every test and 17 more are mixed, and a partial native profile is
refused outright rather than merged.

Two things this cost, both worth knowing before doing the running half:

- **The binary is a tool, not a subject.** `buildProfile` looked for it at `${work}/${WAC_BIN}` —
  inside the staged copy, which does not carry `native/v8/target/release/`. All 368 files fell back
  to Deno and nothing said so, because a missing binary is a case the code deliberately tolerates.
  Forty minutes to notice. And the first guard against it passed the path in by hand, so it kept
  passing while the runner looked elsewhere; the canary only fired once the test asked the question
  the same way the runner asks it.
- **`all` is a subset, not an equal.** A wrapper's Deno profile accumulates every point instrumented
  in that process; the native run knows the entry's closure alone.
  `packages/tls/test/x509_path_wac.test.ts` is 8132 points through Deno and 1077 natively, with zero
  points the Deno side lacks. Over a scope that is 23,749 lines against 23,710, because other
  wrappers contribute the same lines. Subset is the safe direction — a line the profile has never
  heard of **widens** to the whole scope, where a line it knows can be narrowed — and
  `tools/mutate/nativeShare.test.ts` pins that it can never be wider.

**Profiling.** `wac test --coverage` writes the same JSON into the same directory, so for a wac test
file the native command can stand in for `deno test` inside that loop with nothing else altered. The
whole corpus takes 53 seconds against a loop that does not finish in fifteen minutes, and 85 of the
files in that loop are wrappers around wac tests.

**Running — the exit codes are written down and pinned now, 2026-08-16.** `tools/mutate/native.ts`
builds the argv and maps the codes; `tools/mutate/native.test.ts` checks every mapping against the
binary, including a fixture that fails on purpose, because `killed` is the verdict a score is made
of and nothing here fails by itself.

| code | meaning | verdict |
|---:|---|---|
| 0 | the selected tests ran and passed | survived |
| 3 | they ran and one failed | killed |
| 1 | nothing matched the filter, or a file did not run | **abort — score nothing** |
| 4 | every test in the file wants a host oracle | nothing ran here |

**1 is the trap, and it is the opposite of Deno's.** A filter matching nothing is a tooling failure —
a misspelling, or the profile and the runner disagreeing about which spelling a test has — and it
exits *non-zero*, so a runner reading "non-zero means killed" records a kill for a mutant nothing
ran. `deno test --filter nonsense` exits **0** and the same mutant reads as survived. Both are wrong,
in opposite directions, and neither shows up as a red anything. That is why `classify` returns a
verdict rather than a boolean.

`--filter` matches by substring, as Deno's plain filter does, so it over-selects — `test_remove` also
matches `test_remove_keeps_probe_runs_contiguous`. That is the safe direction: extra tests can only
make a mutant more likely to be killed. It costs time, not correctness.

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
