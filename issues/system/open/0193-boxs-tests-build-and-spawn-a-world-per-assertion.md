# 0193 — box's tests build and spawn a world per assertion, and the differentials re-derive their oracle every run

- **Status:** open
- **Claimed by:** agent-c
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** performance
- **Symptom:** no error — 4m23s to ask 130 questions

## The measurement

`packages/box`: 130 tests, **4m23s** in the suite, 351 s run file by file.

| | |
|---|---:|
| test files, each its own Deno process | 26 |
| `buildApp` call sites | **71** |
| distinct entries built | 5 — `sh.wac` ×14, `sealedsh.wac` ×7, `imaged.wac` ×7, `boxsh.wac` ×2, `box.wac` ×1 |
| spawns of a built app | ~100 (79 in `box.test.ts` alone) |
| one compile of `sh.wac` | 5.4 s warm, 7.5 s through the CLI |
| one `buildApp` cache hit | 0.3–0.4 s |
| one spawn of the built shell | **132 ms** |
| the same assertion in-process | **0–2 ms** |

Heaviest files: `box` 59 s, `fuzz` 46 s, `backings` 32 s, `sealed` 20 s, `corpus` 19 s.

## The four changes

1. **Freeze the differentials into vectors.** The corpus runs bash *and* our shell once per script,
   946 times, twice per suite (`packages/sh` 14 s, `packages/box` 24 s). All 946 expectations are
   **11 KB** — 5 KB of stdout, 6 KB of stderr, largest single output 0.1 KB. `tools/shVectors.ts`
   captures them with the oracle's version in the header; the replay is a wac test. Ten cases stay live
   as a drift canary.
2. **Move the tests with no external oracle in-process** — about 60 of ~128. `Shell` with
   `sh.external = boxRun` inside a `Frame` is what `example/boxsh.wac` wires up, and the frame captures
   the output. `packages/box/test/wac/inprocess_test.wac` is the keystone: a pipeline through box's
   applets, 1 ms.
3. **Make grants a manifest rewrite rather than a recompile.** `buildApp` keys its cache on grants, so
   one program compiles once per grant *set* — seven in `box.test.ts` alone. Two builds differing only
   in grants are byte-identical up to **797 104**, and the `wac.manifest` section starts at **797 107**:
   87.6% identical, and `withManifestSection` appends. So compile once, append the manifest per set.
4. **`fuzz.test.ts` keeps bash and drops our binary.** Its own header says "heavy — 716 MB and 58s,
   spawning a built binary per case".

## What stays end to end

`sealing` (13) — a sealed session's claim is about the *real* machine, and an in-process substitute
would be testing the substitute. `sealed` (2), `node_shell` (1, the point is Node), `rasterterm_live`
(4, a real browser), and one build-and-spawn smoke test per area so the boundary keeps coverage.

`routes.test.ts` already asserts the in-process and spawned routes are one program, and that they are
genuinely two routes. That is the licence for change 2, and it stays as the gate.

## Related

`issues/system/0192` — the per-file compile that remains after this, and which must not be answered by
merging test files together.

**Measurement discipline for anything claimed here**: the same file measured 59 s cold and 27 s warm on
the same night. A saving is only a saving if the two runs are in the same cache state.

## Done: the compile no longer depends on the grants — 2026-08-18

`waccArtifacts` — the whole-program compile that `buildApp`, `wacTestRun` and `wacCoverage` all sit on —
takes no grants and never did; only the *application* cache key included them, so the same 180 files
compiled once per grant set. It is cached now on what it actually reads: the sources, the entry, and
whether the build is instrumented or optimised.

    {"read":true}                                      5 702 ms   (a real compile)
    {"read":true,"write":true}                           641 ms
    {"net":true}                                         528 ms
    {"read":true,"write":true,"net":true,"env":true}     560 ms

against **5 378 ms** for a fresh grant set before. Canaried against staleness, which is the only way this
change can be wrong: warm and unchanged is 212 ms, touching one of the 180 files costs 4 675 ms and
produces a new entry, and restoring the file returns to 118 ms.

**A cost to keep an eye on**: this is a second on-disk cache — 17 MB so far against `.cache/app`'s 105 MB —
and nothing prunes either. `tools/prune-deno-cache.sh` sweeps Deno's transpile cache and not this. One
entry per *source set* rather than per source-set-times-grant-set, so it grows more slowly than the cache
it saves work for, but it grows.

## Done: the backings differential is in wac, and covers 946 scripts instead of 40 — 2026-08-18

`backingsprocess_test.wac` built three binaries and ran `CORPUS.slice(0, 40)` through each: 120 processes,
**29.8 s**. It is `packages/box/test/wac/backings_test.wac` now — three `Fs` values in one process — and
runs the **whole** corpus, 946 scripts on three backings, in **7.6 s of which about 6 s is the compile**.
The Deno file keeps the one claim that needs processes, that an image outlives one and a sealed session
does not, and is **2.0 s**.

Two things the move found:

* the old sample was **vacuous**. Breaking the host arm outright made 2 of the 40 cases differ and 38
  agree — the head of the corpus is the shell language, not the world. That is what made running all 946
  the right answer rather than a better sample.
* `tools/corpusBackings.ts` says six scripts name an absolute path this machine has and are compared on
  two arms. It is **30**, measured with that file's own regex. The wac port agrees with it exactly, script
  for script, which is how the port was checked.

The corpus is thin on filesystem work either way — 43 of 946 scripts redirect anywhere — so a differential
about filesystems is mostly running scripts that never open one. Worth a corpus of its own; not filed yet.

## Done: the fuzz differential is captured vectors, and the generator is in wac — 2026-08-18

`fuzz.test.ts` ran four seeds × thirty scripts × two stdin shapes × two shells: **480 processes, 38 s**,
every suite run, to ask what bash does about scripts that are fixed by their seed.

* `tools/shellFuzz.ts` is `tools/wac/shfuzz.wac`. The port is exact and was **checked rather than
  assumed**: both grew a `--print` mode and were diffed byte for byte over **1,400 scripts and seven
  seeds**. The first attempt drifted — a `r.pick` inside an array literal is evaluated before the pick
  that chooses between its elements — and seed 1 agreed for ten scripts before it showed.
* `packages/box/test/fuzz-vectors.txt` is bash's answer to all 120, **11 KB**, captured by
  `--capture`. `packages/box/test/wac/fuzz_test.wac` replays them in process (**7.7 s, ~6 s of it the
  compile**) and keeps eight of them live against bash as the drift canary.
* `fuzz.test.ts` keeps the one shape a `Frame` cannot express — standard input open and silent, which is
  what wac-mono 0113 needed — and spawns 120 times for it: **19 s**, down from 38 s. That gap is
  `issues/system/0195`, and it is the only reason the file still exists.

One answer per script rather than one per stdin shape, and that is measured: bash answers **identically
for all 120** under both, checked by running both ways and diffing. The two shapes were never about bash.

**Found in passing** (`issues/system/0196`): the caret-blink browser test went red twice in full box runs
and green alone, on the *precondition* that 0159's fix left in front of its sampling guard. Its message
says a sample cost 1 ms, so the guard let it through — what was starved was the renderer, not the sampler.

## Where this stops, and why — 2026-08-18

`packages/box` measured file by file: **351 s at the start of this issue, 184 s now.** The suite (parallel,
both lanes) went from 4m23s to about 3m40s.

| | ms | |
|---|---:|---|
| `box.test.ts` | 23 828 | the coreutils differential, 26 tests, none over 3 s |
| `fuzz.test.ts` | 20 631 | 120 spawns for the held-open stdin shape — `0195` |
| `sealed.test.ts` | 15 725 | processes, deliberately |
| `notdir.test.ts` | 11 578 | ~90 spawns: GNU as oracle, twice per case |
| `routes.test.ts` | 11 202 | 80 spawns: called against spawned, which needs both |
| `shell.test.ts` | 8 528 | about spawning; cannot move |
| **`wac/backings_test.wac`** | **7 201** | 946 scripts × 3 backings — **6 s of it is the compile** |
| **`wac/fuzz_test.wac`** | **6 878** | 120 replays — 6 s of it is the compile |
| **`wac/corpus_test.wac`** | **6 702** | 301 replays — 6 s of it is the compile |
| **`wac/inprocess_test.wac`** | **6 101** | 3 assertions — 6 s of it is the compile |
| the other 19 Deno files | 500–5 200 each | one cached build and a Deno start |

**Step 2 — "move the ~60 tests with no external oracle in-process" — is now blocked by `0192`, and the
arithmetic says so plainly.** A `*_test.wac` that imports box's world costs about **6 s of compile**,
every run, because `wac test` compiles each file's import graph from scratch. The Deno files it would
replace cost **0.5–5 s each**. `pipeUngranted.test.ts` is 514 ms; moving it to wac would make it 6 s.

### That diagnosis is now out of date, and the blocker moved — 2026-08-18 (agent-c)

`0192` landed: `wac test` builds **one aggregate per directory**, so a test file's import graph is
compiled once for the whole directory rather than once per file. The paragraph above priced the
conversion at a per-file compile that no longer exists.

So I wrote the conversion to find out what it costs now — `pipeungranted_test.wac`, the same two
pipelines through `wac build` with no grant flags — and measured it three ways:

| | measured |
| --- | --- |
| `pipeUngranted.test.ts`, warm | **375 ms** (not 514 ms) |
| the wac version, run on its own | 2 317 ms |
| the wac version's *marginal* cost inside `packages/box/test/wac` | **+2.1 s** (11.2 s → 13.3 s over 17 files) |

The aggregate does not help, because the cost is not the test file's own graph: the test **shells out to
`wac build`** to produce an ungranted shell, and that build recompiles `boxsh` from scratch every run.
The TypeScript version costs 375 ms for the same work because `buildApp` keys the artefact on the
content of everything it read and reuses it — `harness/buildCache.ts`.

**So the blocker for every build-and-run test in this issue is `issues/system/0204`, not `0192`.** Until
`wac build` has the cache the Deno side has had for months, converting a file that builds an application
trades 375 ms for 2.1 s, and no amount of aggregate sharing changes it. The conversion is written and
was reverted for that reason alone; the numbers above are what to re-check after `0204`.

**One thing did move, and it cost nothing.** Writing the wac version made the vacuity obvious: the whole
file asserts that a refusal did *not* happen, which passes for free if the build quietly had the grant
after all. `pipeUngranted.test.ts` now ends with a grant canary — `cat /etc/hostname` through the same
binary and the same build **must** be refused — and it was proved in both directions by granting `read`
and watching it fail. That belongs in every "no refusal happened" test in this package.

So the conversions that paid are the ones where spawning dominated — `backings` (29.8 s → 1.5 s + a
7.2 s wac file that also does 24× more work) and `fuzz` (38 s → 20.6 s + 6.9 s). What is left is either
about processes on purpose (`sealed`, `sealing`, `shell`, `routes`, `node_shell`, `rasterterm_live`,
and the 120 spawns `0195` forces) or already at the floor.

**The floor is the work now**, and it is the same shape in both lanes: a per-file cost paid to ask a
handful of questions. `0192` on the wac side is worth more than every remaining conversion in this issue
put together — 205 wac test files at ~6 s of compile each — and it is what would make the other ~60
assertions nearly free to move.

## What stays out of pure wac, written down before the sweep — 2026-08-18

The sweep's target is that `packages/box` asserts in wac, in process, against expectations captured once.
This is the list of what is *not* that, and why — so the exceptions are a decision rather than whatever
happens to be left when the sweep runs out of energy. Everything not on this list should end up a
`*_test.wac` with no build and no spawn.

**1. Standard input that is open and silent** — `issues/system/0195`. A `Frame`'s stdin is a `u8[]`, so
empty means end of input, and the difference between "no input" and "a terminal that has not typed yet"
has no spelling. That difference *is* wac-mono 0113: a pipeline whose first stage produced no bytes hung
only under the held shape. Needs a real process until a frame can express it. Should be a targeted set of
pipeline-shaped scripts, not the whole generated corpus.

**2. An image outliving its process** — `backingsprocess_test.wac`. What makes an image an image is that a
*second* process finds what the first wrote, and what makes a sealed session sealed is that it does not.
Both claims are about process boundaries and neither can be asked inside one. This is also the canary that
stops the whole three-backing differential being vacuous, so it earns its spawns.

**3. Capabilities, as the built artefact enforces them** — `sealing.test.ts`, `sealed.test.ts`,
`bin/`'s per-applet grants, `pipeUngranted.test.ts`. A refusal is a property of the manifest baked into a
module and of the host that reads it. In process, the test's own grants are ambient and a refusal test
would be asserting against a world it is standing in — the opposite of what it claims. These build a
program with a stated grant set and run it. See [[no-ambient-capabilities]]: a program gets what it
declared, and only the boundary can say so.

**4. A host that is not this one** — `node_shell.test.ts` (the point is Node), `rasterterm_live.test.ts`
(a real browser, real pixels, real keystrokes). Neither is expressible from inside a wac test, because the
claim is about the runtime the artefact lands in.

**5. That the two routes are genuinely two** — `routes.test.ts`. The in-process route is only worth
running if it is the same program as the spawned one, and that agreement goes vacuous the moment
`boxsh` starts spawning. One spawned comparison keeps the rest honest. Two cases, not eighty-three.

**6. One build-and-spawn smoke test per area.** The whole point of moving in process is that the
in-process route and the shipped artefact are one program; something has to keep saying so.

**7. Live canaries.** Each captured-vector file keeps a handful of cases asked of the real tool every run,
so a changed environment is noticed on the day rather than at the next capture. Deliberate, small, and
named as canaries where they sit.

**8. Tests about the Deno artefact itself** — what `buildApp` writes into a shebang, and which grants
appear there. That is a claim about a TypeScript-generated file and belongs in TypeScript.

Everything else — every applet differential, every operand and flag refusal, every shell behaviour, the
`ENOTDIR` sweep, the three backings — is expectations that do not change between runs, and belongs in
`*_test.wac` replaying captured vectors in process.

**The number this predicts**: on the order of 100 spawns for the package, against 1 701 today.

## What `box.test.ts` has left, and what each one needs — 2026-08-18

Twenty tests, from twenty-six. Six moved into `test/wac/applets_test.wac` and `test/wac/readme_test.wac`.
The rest, with the reason each is still there:

| test | why |
|---|---|
| the main applet differential (514 lines) | bespoke assertions interleaved — `chmod 0500` removals, `urlencode` against fixed answers, `seq` at the i32 bounds. Converts test by test, not swept |
| `wc -w` and the code points that are not spaces | **needs the ambient locale.** `tools/wac/appletvectors.wac` pins `LC_ALL=C`, and `issues/system/0143` is a gap that survived exactly because a `wc -w` differential asked a C-locale question on a `C.UTF-8` machine. Also wants ~40 generated fixtures — one per code point per shape, plus four that break a multi-byte sequence across a 64 KiB chunk boundary — and a decision about the `spec/tour.wac` case, whose expectation would churn every time that file is edited |
| `gzip`/`gunzip` | the valuable half is the *cross*-check: ours reading the system gzip's output and the system gunzip reading ours. The second direction depends on what our gzip emits today, so it cannot be captured |
| `diff` | fourteen cases, each needing its own generated pair of files. The capture takes one fixture set per suite; this wants per-case fixtures |
| `cp` streams / the write-path applets | ~~blocked on `issues/system/0166`~~ — fixed 2026-08-18, so these can move |
| the grant tests, the streaming-memory test | on the keep list: a grant is a property of the built program, and holding a chunk is measured in resident bytes |
| TCP, TLS, `tar`, `httpd`, `nc`, `split`+`wget` | real sockets, a real TLS server, GNU `tar` reading what we wrote |

**The locale is the one to be careful of.** It is the difference between a captured expectation and a
captured mistake, and nothing about the vectors would show which you had.


## The build half is no longer the blocker — agent-a, 2026-08-24

`wac build` has an artefact cache since 2026-08-24 (`issues/system/0204`), and `packages/box/src/box.wac`
now builds in **245 ms warm against 4 192 ms cold**. The trade this issue and `issues/system/0161`
recorded — 375 ms of TypeScript for ~2 s of `wac build`, seventeen files, about 30 s a run — is now
375 ms for 245 ms. Whoever owns these tests can convert them without paying for it; the measurement and
its caveats are in `0204`. The *spawn* half of this issue is untouched.

## Where the four changes stand — agent-c, 2026-08-25

Checked rather than assumed, after finding next door that a claimed issue can describe work that has
since landed (`issues/system/0183`).

    1. freeze the differentials into vectors   `tools/shVectors.ts` does not exist — not started
    2. move the oracle-less tests in-process   `packages/box/test/wac/inprocess_test.wac` exists,
                                               3 tests. The keystone landed; the ~60 it was to carry
                                               did not follow it
    3. grants as a manifest rewrite            not checked here
    4. `fuzz.test.ts` drops our binary         not checked here

`packages/box` now holds **20** `*_test.wac` files beside **17** `.test.ts`, so the package is midway
through `issues/system/0161` as well, and that migration moves tests without making them cheaper: a
`*_test.wac` that still calls `buildApp` and spawns pays the same 132 ms per assertion. The two are
independent and it is worth not reading progress on one as progress on the other.

No estimate revised, no measurement redone — this is only a note that the first change is untouched
and the second stopped at its keystone, so whoever picks this up starts from that rather than from the
plan.

