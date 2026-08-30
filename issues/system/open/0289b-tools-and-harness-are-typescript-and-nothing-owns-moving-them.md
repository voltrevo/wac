# 0289b — `tools/` and `harness/` are 15,437 lines of TypeScript and nothing owns moving them

- **Status:** open
- **Claimed by:** agent-b — porting `tools/` leaf-first; `harness/` is not claimed
- **Reported by:** agent-b
- **Date:** 2026-08-30
- **Kind:** missing feature
- **Symptom:** not implemented

The operator's instruction: **Deno is a bootstrap host and an oracle called by wac tests, and
nothing else.** `issues/system/0161` moves `packages/**/*.test.ts` off Deno and says in as many
words that `tools/` and `harness/` being rewritten in wac "is a different project from this issue".
This is that project. It is filed rather than merely done because it is weeks of work across two
directories every agent runs, and because three of its steps are blocked on each other in an order
that is not obvious — I had to read `tools/suiteGate.ts`'s header to find one of them.

## Measured 2026-08-30

| where | files | lines | of which `*.test.ts` |
|---|---|---|---|
| `tools/**/*.ts` | 36 | 8,048 | 12 files, 1,817 |
| `harness/**/*.ts` | 36 | 6,026 | 14 files, 1,667 |

`tools/mutate/` is 13 of those files and 2,941 of those lines — a third of `tools/`, in a
subdirectory, and `ls tools/*.ts` does not show it. I counted `tools/` at 33 files and 6,470 lines
first and had to correct it; anyone re-deriving these should use `find` rather than a glob.

For scale on the other side: `tools/*.wac` and `tools/wac/*.wac` are already 43 files and 13,050
lines, so this is not a new idea being proposed — it is a migration two thirds done in one directory
and untouched in the other. **23 of the 76 entries in `tasks.json5` still spawn `deno`**, and 44
invoke the `wac` binary. That count is the tracking number for this issue: it goes to zero, or to
whatever the carve-out below leaves, and it can be read in one grep.

## What must *not* move, so the number is not chased past its floor

- **`bootstrap/`** is a host by designation, not a leftover.
- **`harness/wac/hostless.test.ts`** runs every host-independent wac test under Deno *as well*. That
  is `CLAUDE.md`'s "the browser is not scaffolding", and a suite that only ran under the wac binary
  would stop noticing the day the two hosts disagreed. It is the point.
- **`tools/discovery.test.ts`** — its subject is `deno test`'s own collection rule. A wac test
  walking the same files would be asserting a claim about a runner it does not use.
- **`site/`** is the npm/vite subtree.
- The oracle rows `0161` already argues: `packages/ts`, the `wacc` differentials, `covTableParity`.

## The order, and what blocks each step

**1. The leaf tools — unblocked, no decisions in them.** Each is a task entry point that reads the
repository, computes, and prints: `size.ts`, `ignoredFlags.ts` and the five `corpus:*` tools.
`docCheck.ts` was on this list and turned out not to need porting at all — it had been dead since
2026-08-27 and was deleted. `tools/genCore.ts` was one of these and went on 2026-08-30 — its output is checked
in, which made the port verifiable byte for byte rather than argued.

The five `corpus:*` tools are self-contained despite the two imports that look like blockers:

- `announceHeavy` from `suiteGate.ts` — `tools/wac/suitegate.wac` already exports `announce` and
  `unannounce`, so a ported one announces natively and does not need step 3 to happen first.
- `CORPUS` from `packages/sh/test/corpus.ts` — **that decision is already made and went the wac
  way.** `0161` records this as blocked because `packages/sh` holds the corpus twice and picking the
  authoritative one is its owner's call. It no longer does: `corpus.ts`'s own first line reads *"the
  corpus, for the TypeScript tools that still read it — derived, not held"*, and it parses
  `vectors.txt`, which `tools/wac/shvectors.wac` writes from `packages/sh/test/wac/corpus.wac`. So a
  wac port reads the source rather than a derivation, and **porting the last TypeScript consumers is
  what deletes `packages/sh/test/corpus.ts`** — 91 lines of parser that exist only for them.

`0161`'s other named blocker is stale the same way: it lists `docSignatures.test.ts` and
`designClaims.test.ts` as convertible-but-not-done. Both are done — `tools/wac/docsignatures_test.wac`
and `tools/wac/designclaims_test.wac` exist and the TypeScript is gone.

**2. Done 2026-08-30 — all three.** `coverageAll.ts` (307) is `tools/wac/coverageall.wac`,
`coverageUnion.ts` (147) is `tools/wac/coverageunion.wac`, and `coverageOrder.ts` (41) went with the
first of them. That last one is the part worth recording: it
looks like the ideal first port — 9 lines of logic, its own test, no I/O — and it is not a leaf. It is
a *library*, imported only by `coverageAll.ts`, and a TypeScript file cannot import a wac module, so
porting it alone would have left two copies of the ordering rule or a broken import. **Size is not the
same as independence, and the entry points are what move.**

The two sweeps were run back to back and agree on every judgement they make: `37/37`, `36 hold a
coverage floor, 0 only check their own exemptions have not drifted, 1 report and cannot fail`,
`no coverage floor: sh (reports)`, and the same four unswept packages. The timings differ by 3% in
the port's favour, which is noise on a machine three agents share and is not claimed as anything.

It also gained the parser and the tests the TypeScript's own comments asked for — `tasksIn`, which is
what `wac task` reads the registry with, instead of a hand-rolled strip that had already broken once;
and cases for `driverOf`, the ratchet-call classifier, the failure-line filter and the ANSI strip,
none of which had a test, because the only way to exercise them was a two-minute sweep.

The union half kept its numbers exactly — `tls`/`quic` report the same 3,583 and 4,463 points and the
same row, `packages/tls/src/handshake.wac | tls | 108 | 80 (74%) | 96 (89%) | +16` — and gained three
things. It has a **task** (`wac task coverage:union`), where before it was `deno run -A …` typed from
memory. It **refuses a package name it does not know**, exit 2; the TypeScript filtered the list, so
`coverageUnion.ts nosuchpkg` printed an empty table, *"0 file(s) … by 0 point(s)"* and exited 0 — a
clean-looking result over nothing measured, which is the exact failure this repository keeps finding.
And the two files now **share** `packagesOf`, `commandFor`, `splitOn` and the owner-of-a-path rule
rather than holding two copies each.

**3. Then `tools/suiteGate.ts` can be deleted, and not before.** Its header names its own exit
condition: what is left in it is the *writer* of `/tmp/wac-heavy-<pid>`, because the eight tools that
announce themselves are still TypeScript — the five `corpus:*`, `coverage:all` and `mutate`.
`tools/wac/suitegate.wac` already owns the lock, the thresholds, the cooldown and the refusal. So
steps 1 and 2 are what retire step 3, and porting `suiteGate.ts` on its own would produce a second
announcer rather than one.

**3b. `tools/seedFresh.test.ts` — done 2026-08-30, and its recorded blocker did not hold.** `0161` keeps it in
TypeScript "because of *when* it runs": `tools/wac/*` is not in the wac lane, so a ported version
would run only in `wac task docs`, which `tools/push.sh` runs *after* the suite — moving the check
past the failure it explains. That argument is about the lane, and **this file's call sites are not
in a lane**: `push.sh` runs `deno test … tools/seedFresh.test.ts` directly, at line 236 before the
suite and again at line 715. A wac port invoked at those same two lines runs at the same two moments.
It was also the gate's only remaining Deno step outside `site/` and the suite's own Deno pass, and it
was 237 lines rather than the 87 `0161` records. `tools/wac/seedfresh_test.wac` replaces it: all four
branches were checked against the TypeScript side by side and the messages are identical, down to
`2.0 day(s) older than packages/wacc/src/coretext.wac`.

**4. `mutate` (`mutate.ts` at 1,477 plus `tools/mutate/` at 2,941 — 4,418 together, the single
largest thing here), `fuzz.ts` (538), `fuzzBoundary.ts` (416).** `mutate` is
also blocked in its own right: `issues/system/0183` records that it scores by running `deno test`,
which twenty packages no longer have.

**5. `harness/` last, and possibly not at all.** `harness/` is the TypeScript that *runs* the Deno
half of the suite. `0161` is deleting the tests it runs. A harness ported now is a runner rewritten
for a workload scheduled to disappear — the right move is to let `0161` empty `packages/**/*.test.ts`
and then delete most of `harness/` rather than translate it. **This is the step to re-check rather
than re-read**, because it is the one whose answer changes as `0161` progresses.

## What a port costs, from the three done so far

- **Capabilities become visible.** A wac tool runs under `wac run --allow-read …`, so `tasks.json5`
  grows an explicit grant list where `deno run -A` said nothing. That is the point rather than the
  price — `CLAUDE.md`'s no-ambient-capabilities — but it is work per task and it is easy to grant
  more than the tool needs.
- **`packages/regex` has no lookaround.** It refuses `(?=…)` and `(?<!…)` rather than mis-parsing
  them, which is the right call and is documented in its README. A TypeScript tool leaning on
  `(?<![\w.])name\s*\(` therefore has to hand-roll that predicate. `tools/wac/deadexports.wac` did,
  and the hand-rolled version is shorter than the regex and says what it means — so this is a cost
  to expect, not a blocker, and **not** a reason to file against `regex`; its README owns that gap.
- **A generated artefact is the best possible oracle.** Where the TypeScript wrote a checked-in file,
  the port is verifiable byte for byte. Where it only printed, the port needs a test written from
  scratch, and that is the slower half.

## Every remaining `deno` task, classified — 2026-08-30

The tracking number at the top is a count, and a count cannot say whether what is left *should* go.
Read one by one, most of what remains is either the carve-out this issue already names or blocked on
one of two specific things. This is the list, so nobody re-derives it:

**Deno is the oracle or the host — these stay.** Six, and each is the permitted use rather than a
leftover:

| task | why |
|---|---|
| `gen:unicode` | `packages/unicode/tools/gentables.ts` asks JavaScript's `toLowerCase`, `toUpperCase` and `RegExp`'s `u` mode what every code point is. Its header states the design: the tables are *derived from the authority* rather than transcribed from it. A wac generator would be deriving wac's tables from wac |
| `verify:fmt` | 500,000 random doubles through wac's `ftoaBytes`, compared against JavaScript's own number formatting. That formatting **is** the specification `ftoa` implements |
| `bench` | measures the cost of the JS boundary itself — "bindgen copies an array with one exported wasm call per element" — which is the subject, not an accident of the host |
| `serve` | `packages/server`'s JavaScript host |
| `app:build` | the **browser** build. Its own header: "a page must carry its own host, because there is no PATH in a browser to find a `wac` on". The `deno` and `node` targets in it are already `design/system/0009`'s |
| `site:map` | the npm/vite subtree |

**Blocked on `issues/system/0290b`** — a wac program cannot run a host binary in a chosen directory:
`corpus:through`, `corpus:hosts`, `corpus:backings`, `corpus:routes`, `corpus:stderr`, `mutate`,
`mutate:diff`, `mutate:operators`, `flags:ignored`. Nine of them, and it is one missing parameter.

**Blocked on a second thing, which has no issue yet: there is no wac equivalent of `wacFiles`.**
`size` and `bench:compile` both want a program's whole import closure *with its sources*, to hand to
`packages/wacc/src/api.wac`'s `emitFiles` — which exists and is exactly the API the TypeScript used.
What is missing is the reading half.

**And it is smaller than it first looks.** The obvious source is `gather` in
`packages/wac/src/wac.wac`, which is private to the CLI and carries project roots (`@/`) and import
maps and a cluster of helpers — extracting it touches the seed app's graph and wants a pass of its
own. But neither blocked tool needs any of that: checked 2026-08-30, none of
`packages/tor/size/*.wac`, `packages/tor/src/client_entry.wac`, or anything under `packages/tor/src`,
`packages/tls/src` or `packages/crypto/src` writes a single `@/` import. A plain import walk that
keeps the text is enough for both.

`closureOf` in `packages/wactest/src/built.wac` is already that walk — it reads every file in the
closure to find its imports and then throws the text away, keeping only mtimes. Widening it, or
giving it a sibling that answers paths and texts, costs no seed rebuild and no new resolver. That is
the cheap route; `gather` is the complete one, and which is right depends on whether a tool ever
needs to compile a program that uses `@/`.

**Done 2026-08-30 as `sourcesOf`, and it unblocked one of the two.** `wac task size` is
`tools/wac/size.wac`: same wasm bytes and the same 12,319-line closure as the TypeScript, byte for
byte, so the walk is the walk.

**`bench:compile` is not unblocked, and reading it for the port is what showed why.** It does not
time *a* build; it times the phases of the build as `harness/waccBuild.ts` makes them, in that order,
and `benchCompile.test.ts` asserts that every `api.*` call in that harness file is either timed here
or carries a `bench-exempt` line saying why — a guard added because the list silently drifted twice
and once reported 106s for a build that no longer cost that. So a wac port has to answer *which build
it measures*: the TypeScript harness's sequence, which is the one the guard is written against and
which nobody runs to build anything, or `wac build`'s, which is the one people use. Those are
different programs now. `--mem` is a second question — it re-invokes itself one phase per process to
get peak memory, because a collection during phase 3 shows up as phase 4 using less, and nothing in
`std/platform.wac` reports peak RSS.

So the remaining count behind "no `wacFiles`" is one task, not two, and what is left of it is a
decision about the subject rather than a missing function.

**Goes when the TypeScript goes:** `check`, which is `deno check` over the remaining `.ts`.

**Somebody else's package:** `coverage:sh`.

**Five package benchmarks** — `bench:hash`, `bench:zstd`, `bench:zstd-speed`, `bench:json`,
`bench:json-lookup` — all measure wac code through `wacBind`, so they are the same shape as `bench`
above. Whether the JS boundary is still the right thing to measure now that there are two native
hosts is a decision, not a translation.

**So the honest remainder is nine tasks behind one missing parameter, two behind one missing
function, and one that dissolves.** The rest is the carve-out working as intended.

**The missing parameter landed on 2026-08-30** — `Cli.execWithIn`, `0290b`, after `issues/lang/0291c`
turned out not to reproduce once `wac task gen:core` was run. Four of the nine are ported since:
`corpus:through`, `flags:ignored`, `corpus:routes` and `corpus:backings`.

**Where the nine actually end, read one by one — 2026-08-30.** Four are ported: `corpus:through`,
`flags:ignored`, `corpus:routes` and `corpus:backings`. The other five are not translation work and
none of them is blocked by `0290b` any more:

- `mutate`, `mutate:diff`, `mutate:operators` — behind `issues/system/0183`, **claimed by agent-c**.
- `corpus:stderr` — a library to three TypeScript tests, below.
- `corpus:hosts` — behind `buildNative`, below.

So the capability that unblocked them has been spent, and what is left of `tools/` is either
somebody's else's claim or a TypeScript library that moves with its importers. That is a different
kind of remainder from the one at the top of this issue and it is worth saying plainly: the next
lever is not another capability.

**`tools/` is at its floor as of 2026-08-30, and the floor is not a carve-out list.** Read file by
file after the six ports of that day, nothing left in it is available:

- `mutate.ts`, `mutate.test.ts`, `tools/mutate/`, `suiteGuard.ts`, `profile.test.ts`,
  `lane.test.ts` — behind `issues/system/0183`, **claimed by agent-c**.
- `corpusStderr.ts` — a library to three TypeScript tests. `corpusHosts.ts` — behind
  `buildNative`. `suiteGate.ts` and its test — a remnant serving those two and `mutate`.
- `fuzz.ts`, `fuzzBoundary.ts`, `bench.ts`, `wasmopt.ts`, `syncBootstrap.ts`, `_spawncmp.ts`,
  `discovery.ts`/`discovery.test.ts` — carve-outs where Deno, npm or the JavaScript bootstrap
  *is* the subject. Checked rather than inherited: `syncBootstrap` imports `bootstrap/hosts/deno.js`
  and `_spawncmp` imports three files from `packages/platform/host/`.
- `checkTypes.ts`, `typecheck.test.ts`, `benchCompile*` — dissolve with the TypeScript they check,
  or wait on a decision about which build they measure.

So the next thing that moves here is not a port. It is `0183` being answered, or somebody deciding
to move `packages/sh`'s three TypeScript tests so `corpusStderr` can follow them.

**Twice now a row here has hidden a portable test inside a TypeScript-subject group, so check the
rows rather than trusting them.** `programs.test.ts` sat in the row above as "tests TypeScript
machinery" and did not: it compiled every wac program in the repository, through a Deno bridge only
because nothing else could call the compiler. `wapyRoundTrip.test.ts` sat in `0161`'s wacc row as a
"JavaScript boundary" and did not: its other half is wacc. Both moved on 2026-08-30 and neither
needed anything that did not already exist.

The shared shape is worth naming, because it will be the next one too: **a test written in
TypeScript because that was the only language that could reach the subject is not a test *about*
TypeScript.** The tell is the import list — `waccApi`, `wacFiles`, `buildApp` — a bridge to
something written in wac. A row saying "the subject is TypeScript" earns that description only
when the thing being asserted about would not exist without it.

**`suiteGate.ts` is a 67-line remnant, and its blocker shrank with the ports.** The live gate is
`tools/wac/suitegate.wac`, 574 lines, which `tools/push.sh` calls by name — the TypeScript file is
what is left over for the tools that still announce themselves in TypeScript, and after the four
ports above those are exactly three: `mutate.ts`, `corpusHosts.ts` and `corpusStderr.ts`, plus its
own test. Nothing else imports it. So it is not work of its own at all: it is deleted by the same
three moves as everything else in this section, and the row above should not be read as a separate
task.

**`corpus:hosts` is behind a library too, and a much bigger one.** It calls `buildNative` from
`packages/platform/native.ts`, which is not a cargo wrapper: it reaches `harness/waccBuild.ts` and
`packages/wacc/tools/waccBindgen.ts` for artifacts and bindgen parsing. That is **1,610 lines with
eight importers**, most of them `packages/platform`'s own TypeScript tests. So it is load-bearing
infrastructure that moves with its subsystem, and the `129` in the table is the size of the tool
rather than the size of the work.

**`corpus:stderr` is not next, and looked like it was.** `tools/corpusStderr.ts` is a *library* as
well as a tool: `packages/sh/test/stderr.test.ts` imports `KNOWN` and `sameName` from it, and
`packages/sh/test/differential.test.ts` and `packages/box/test/jobs.test.ts` import `sameName`. A wac
file cannot be imported by TypeScript, so it moves when those three do and not before — the same
shape as `coverageOrder.ts` above, which this issue already records as the trap. `corpusBackings.ts`
and `corpusHosts.ts` have no importers at all and are ordinary translations. What follows was written while they were still blocked, so
read the table above for the live state and this analysis for how the classification was reached.

## `tools/` read file by file — 2026-08-30

Thirty-eight `.ts` files. Every one has a determination, and the useful result is how little of it is
actually available to port:

| what | lines | state |
|---|---|---|
| `mutate.ts` + `tools/mutate/` + their tests | ~5,500 | blocked: `0290b` → `issues/lang/0291c`, and `issues/system/0183` |
| `corpus:stderr` | 198 | **blocked on its three TypeScript importers**, not on `0290b` — see below |
| `corpus:hosts` | 129 | **blocked on `buildNative`**, not on `0290b` — see below |
| `fuzz.ts` + `fuzzBoundary.ts` | 954 | carve-out — see below. I had these as the available remainder and was wrong |
| `benchCompile.ts` + test | 275 | a decision — which build it measures — plus peak RSS |
| `checkTypes.ts`, `typecheck.test.ts` | 128 | dissolve with the TypeScript they check |
| `suiteGate.ts` + test | 116 | waits for **three** announcers now, not eight — and it is already a remnant |
| `suiteGuard.ts` | 66 | waits for `mutate`, its last two callers |
| `bench.ts` | 232 | carve-out: measures the JS boundary, which is the subject |
| `wasmopt.ts` | 81 | carve-out: an `npm:binaryen` host. Its own header — "an experiment, not a build step" |
| `syncBootstrap.ts` | 115 | carve-out: `bootstrap/` machinery, and `bootstrap/` is a designated host |
| `_spawncmp.ts` | 66 | carve-out: imports `packages/platform/host/*`; its subject is the JS host |
| `discovery.test.ts` | 84 | carve-out already named above |
| `lane.test.ts`, `profile.test.ts`, `mutate.test.ts` | 711 | test TypeScript machinery; they go with their subjects — `lane.test.ts`'s is `harness/testLane.ts`, whose only non-test reader is `tools/mutate/known.ts`, so it goes when `mutate` does |

### Correction, an hour later: the two fuzzers are carve-outs too

I wrote the row above from the file list — no task, not in `0290b`'s set, therefore available — and
then read their headers, which say otherwise. Both are the permitted use of Deno.

**`fuzzBoundary.ts` by its first line**: *"A round-trip fuzzer for the JavaScript boundary."* Its
subject is the bindgen marshalling between wac and JavaScript — element-by-element arrays of
references, boxed nullable primitives, packed elements crossing as i32. There is no version of that
test without JavaScript in it.

**`fuzz.ts` because of where its arithmetic comes from.** Its header is careful that the oracle is
"the generated tree, not a second interpreter", and that is true about the *structure* — but the
numbers are JavaScript's: `evalIn` computes `x + y`, `x & y` and the rest in `BigInt` and truncates
with `BigInt.asIntN(64, …)`. That is an implementation of integer arithmetic independent of the one
under test. Compiled to wac, the oracle's `x + y` would be an `i64.add` emitted by the same wacc that
emitted the program it is checking, on the same host — so a wrong emission for a primitive would
appear identically on both sides and read as agreement. It would still catch parse, typecheck and
context-dependent emission bugs; it would go blind to exactly the class the wrapping arithmetic is
there for.

**So the unblocked remainder of `tools/` is nothing.** Every one of the 38 files is behind
`issues/lang/0291c`, is a carve-out, or moves when its subject moves. *(True when written and
false within the day: `0291c` did not reproduce, `0290b` landed, and the seven that remain of the
nine are ordinary translation work.)* The raw count says weeks of
translation; the determination says the next lever is a compiler bug somebody else filed, and fixing
it unblocks ~6,500 lines in one go.

That is also the second time in one afternoon that reading a file's own header reversed a decision I
had made from its name and its size.

## Step 5's premise is wrong: `harness/` is not waiting for `0161`, it is permanent — 2026-08-30

Step 5 above says to let `0161` empty `packages/**/*.test.ts` and then delete most of `harness/`
rather than translate it. `0161` invites re-deriving its totals, so I did:

    find packages -name '*.test.ts' | wc -l          61
    find packages -name '*.test.ts' | xargs wc -l    16,518

against the 64 files and 17,244 lines it recorded on 2026-08-24. Three files and ~700 lines in six
days. But the count is not the finding — **the distribution is**:

| package | files | `0161`'s determination |
|---|---|---|
| `platform` | 31 | "the subject is TypeScript in every one" |
| `box`, `sh` | 17 + 4 | another agent's packages |
| `wacc` | 3 | `bindgen`, `jsBindgen`, `jsxBoundary` — each a JavaScript boundary, and the subject is the generated JavaScript itself. `wapyRoundTrip` was a fourth in this row and did not belong: its other half is **wacc**, not JavaScript, and it is `packages/wacc/test/wac/wapyroundtrip_test.wac` as of 2026-08-30 |
| `ts` | 2 | "the subject is a TypeScript compiler's answer" |
| `webrtc`, `raster`, `stream` | 1 each | a real browser, a real canvas, a `TransformStream` |

That is 61 of 61. Every remaining file is covered by a determination `0161` has already made, and
none of those determinations is "not yet done" — they are reasons to keep it. `wacc`'s four are worth
naming because `0161` records it dropping from eleven to four when the reference compiler was
deleted: what went were the differentials that had lost their oracle, and what is left is the JS
boundary, which cannot lose one.

**So the Deno pass does not shrink to nothing, and `harness/` is what runs it.** The pool, the
deadline, the port allocator, the reaper, `wacBind`, `appRun` — those exist to run 61 files that are
staying. Step 5 was written expecting a workload scheduled to disappear; it is not scheduled to
disappear.

That changes the question rather than the answer. It is no longer "when does `harness/` become
deletable" but "how much of `harness/` is duplicated by the wac side that now exists" — `runTests.wac`
already reimplements the lane split and the queue, `packages/wactest/src/built.wac` has the build
cache and now `sourcesOf`, and `tools/wac/programs.wac` has program discovery. Those pairs are the
thing to look at, and each is a separate question about which copy is the real one.

**Caveat, and `0161` supplies it about itself.** The `platform` row carries a standing warning —
*"Nothing convertible left" was said on 2026-08-19 and was wrong once* — so 31 files is a
determination to re-check rather than a fact to build on. What is said here is what follows from the
determinations as they stand today, not a claim that they are all correct.

## The nine unblock — 2026-08-30

`issues/lang/0291c` closed as not reproducing, so `0290b` is not blocked, so the nine tasks behind it
are not blocked: the five `corpus:*`, `mutate`, `mutate:diff`, `mutate:operators` and `flags:ignored`.

The chain was three deep and two of its links were wrong. `0290b` said the fix needed a seventh
parameter on `execWith` and could not have one, because `0291c` said a seventh parameter drops the
module's entry point. `0291c` said that because its reproduction edited `std/platform.wac` without
regenerating the compiler's embedded copy of it, which is `issues/system/0291b`. Each link was
recorded honestly and each was checked by the person after; what settled it was running the
reproduction rather than reading it.

So the remaining work in `tools/` is: add a `cwd` to `execWith` across the five hosts — **done, `0290b`** —
then port nine tools that all want a scratch directory to run something in, of which four are done. `mutate` additionally has
`issues/system/0183`, which is its own thing.
