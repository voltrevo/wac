# 0153 — a build cost two emits and five front ends; what is left after fixing that

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** performance
- **Symptom:** no error — `wac build` was 2.7× slower than the work it does

## Where this started

The website's bootstrap page compiles wacc with wacc in the reader's browser and prints the time. On
2026-08-18 it read:

    the reference compiler → stage A   389,417 bytes, 499 ms
    stage A compiles wacc → stage B    444,332 bytes, 707 ms
    stage B compiles wacc → stage C    444,332 bytes, 461 ms

while `wac build` on the same compiler took **4 736 ms** locally, and on `packages/box/src/bin/sh.wac`
**5 994 ms**. A tenfold gap on what looked like the same job.

## What it was not

Each of these was measured and none of them is the cause. They are recorded so nobody spends the day
again:

* **Not the sources.** `packages/wacc/src` was 1 352 555 bytes at the revision the deployed site was
  built from and 1 370 047 today — 1.3% apart. Same compiler, same input.
* **Not box being larger than wacc.** By bytes they are within 17%: wacc is 24 files / 1.47 MB of source
  producing 777 KB of wasm, box's shell 180 files / 1.72 MB producing 910 KB. Build time tracks *output*
  size at ~6 ms/KB either way, and the file count barely registers.
* **Not the embedding.** Under Deno, `emitFiles` on wacc's 16 files takes 483–491 ms and produces the
  same 444 516 bytes the browser produces in 461–707 ms. The hosts agree.
* **Not wasm tiering.** `--liftoff-only` makes it 5 882 ms against 2 496 baseline, so V8 is tiering the
  compiler up. `--no-liftoff` is *slower* (3 978 ms): compiling 777 KB with TurboFan up front costs more
  than it saves in a two-second run. Heap sizing (`--max-semi-space-size`, `--max-old-space-size`) and the
  platform thread pool changed nothing.
* **Not wacc's own codegen.** Under one host, wacc built by the reference and wacc built by wacc emit in
  567/536/485 ms and 605/498/496 ms — the same.

## What it was

**The bootstrap page calls `emitFiles` and nothing else**: one front end and an emit. A `wac build` does
five whole-graph walks and two emits' worth of work.

1. **`wacc.wac` did not use `buildFiles`.** The CLI called `diagnoseGraph`, then `blockedFiles`, then
   `emitFiles`, then `manifestFiles` — which derives `bindTypesLinked` *and* `exportSigsLinked` inside
   itself. Each takes `(paths, sources, entry)` and builds its own front end, because this compiler does
   no I/O and holds nothing between calls. `buildFiles` has existed for exactly this since
   `issues/lang/0129`; the CLI was the caller that never adopted it. `manifestWire` was added beside the
   existing `bindgenWire` so the manifest is built from metadata already in hand.

2. **`blockedOf` was a dry run of the emit, on every build.** It asks `canEmit` of every function and
   every method — a walk of every body — so it costs about what emitting costs and, on a program that
   compiles, returns the empty string. On box's shell that was **1 480 ms against 712 ms for the emit
   itself**. Nothing needs asking in advance: `declineFor` records `env.full` and `env.fullWhy` as the
   emit happens, which is what `emitDeclineLinked` already reads. `buildLinked` now emits and runs the
   speculative walk only when a decline actually happened — where its message earns the second front end,
   since `fullWhy` names the seventh call in a chain and `blockedOf` names the declaration
   (`issues/lang/0106`).

3. **`checkFilesWith` re-lexed and re-parsed its entry.** `issues/lang/0133` stopped the *import* loop
   re-reading each file once per importer and left the entry parsing itself on every call. In
   `diagnoseGraph`, where all 180 files take a turn as the entry, that is a second whole-graph parse.
   Worth ~5%, so the smallest of the three.

## The result

    wac build   packages/box/src/bin/sh.wac    5 994 → 2 245 ms    2.7×
    wac build   packages/wacc/example/wacc.wac 4 736 → 1 509 ms    3.1×

Byte-identical modules and manifests from the old and new compilers on `sh`, `sealedsh` and `wacc`; the
seed is a fixed point after one round; `packages/wacc` is 188 Deno tests and 24 wac files green.

It lands on every `wac build`, `wac run` and `wac test`, and on the Deno harness as well, since
`waccArtifacts` builds through `buildFiles`.

## Why a build is still ~4× the browser's number, and how much of that is real

For box's shell, 2 245 ms breaks down as:

| | |
|---|---:|
| `diagnoseGraph` | ~880 ms |
| front end | ~720 ms |
| emit | ~880 ms |

The browser's 461 ms is the front end and the emit for **wacc's 16 files**, and nothing else. Against the
same entry the comparison is Deno's `emitFiles` at 1 597 ms versus `wac build` at 2 245 ms — and the
difference is `diagnoseGraph`, the manifest and writing two files, none of which the demo does.

**`diagnoseGraph` is not waste.** `checkFiles` walks only the entry's bodies, so a type error in an
imported file was silent and the emitter turned it into a wasm validation failure with no source line —
`issues/lang/0118`. It checks every file *as an entry* to prevent that. Measured, it is 130 ms of shared
whole-graph parse plus **180 checks at about 5 ms each**, and the per-file cost does not scale with
closure size: `diagnoseFiles` costs 158 ms for a file with a closure of 1 and 117 ms for one with a
closure of 180. So the overlapping closures are *not* where the time goes, and there is no redundancy
left to remove there.

## What is left to try

* **Skip checking files that have not changed.** The compiler is pure — paths and sources in, a string
  out — so a diagnosis is cacheable by content hash. Nothing in the CLI or the host caches anything today.
* **Make the checker itself faster**, which needs profiling inside `C` rather than around it.
* The front end at ~720 ms for 180 files is ~4 ms a file and has not been looked at at all.

## What the front end's ~720 ms is made of — 2026-08-21, agent-a

There is still no profiler, but a *pure* function's whole cost can be priced by wrapping it so its body
runs twice and subtracting. On `describewac_test` (14.1 s, four front ends over closures up to 182 files):

| | |
|---|---:|
| `lex` | 2.5% |
| `parseProgram` | 18% |
| everything after — check, settle, emit | ~80% |

So the bullet above is right about where to look, and it is the *semantic* phases rather than the
front end in the narrow sense.

**One candidate inside them is now ruled out.** `C.findName` is a linear scan of the names table run
once per name resolved, which is the shape that had just been worth indexing twice elsewhere in a day
(`edgesOfIn`'s path lookup, and `isBuiltinSpec`). Priced the same way it is **51 ms of 14 150 ms —
0.4%**, so a hash index there buys nothing. Recorded because the scan is conspicuous and looks like
the answer.

**What the technique cannot price.** Doubling a *call site* prices that site, not the callee — it
undercounted `isBuiltinSpec` by more than half, because the loop doubled was one of several callers.
Body-doubling prices the callee but only where the function is pure: `lex` and `parseProgram` qualify
(the latter if the wrapper builds a second `P` from `p.src`/`p.toks`/`p.tokCount`), while `checkModule`
and `settleEmittable` mutate pre-populated state, so a second run does *less* work and the subtraction
means nothing. That is why the 80% is one row rather than three — pricing inside it needs either a real
profiler or a pure seam that does not exist yet.

## Inside the 80%, with the profiler this issue said did not exist — agent-b, 2026-08-29

The section above stops at *"pricing inside it needs either a real profiler or a pure seam that does
not exist yet"*. There is an instrument: `wac build --coverage` counts every branch point, and
nobody had pointed it at the compiler itself. `tools/wac/waccprofile.wac` is a driver that calls
`emitFiles` on this issue's own entry — `packages/box/src/bin/sh.wac`, 1,122 files offered, 777,864
bytes emitted — built with `--coverage` and read with `wac covdump`.

**A count is not a time.** It ranks how often a line runs, not what it costs, so nothing below is a
share of the clock; it is where the iterations are. Price anything it turns up by this page's
doubling method before believing a number.

    1,932,304,577 executions, 4,997 of 16,845 points reached

    96.0%  emit.wac          1,855,315,176
     2.6%  lex.wac              49,753,541
     1.1%  parse.wac            20,891,223
     0.3%  kinds.wac             5,082,697

**Four linear scans are about a fifth of every iteration the compiler makes**, and the two that can
be named cheaply are these:

    Env.funcAt(name)    81,111 calls   97,412,789 iterations   1,201 string compares per call
    Env.sigType(t)      35,594 calls   72,332,068 iterations   2,032 string compares per call

Both are `for (i = 0; i < count; i++) if (table[i] == name) return i` over a table that grows with
the program, so the cost is quadratic in it. The two hottest points of all are the same shape in the
name resolver at `emit.wac:2813` and `:2819` — 122.6M and 63.6M iterations — scanning `declNames`
by name and file.

**This does not contradict the `C.findName` measurement above; it is the counterpart to it.** That
scan was priced at 0.4% and a hash index there buys nothing. These are a different table in a
different phase, and they are three orders of magnitude more traffic. The lesson is that "the scan is
conspicuous" is not evidence either way — the difference between 0.4% and this is a measurement.

**And the next step said to price one by doubling before indexing anything, because 1,201 compares of
a short string may be cheaper than the count suggests. It was. See below — do not index these on the
strength of the counts.**

### Reproducing it

    wac build --coverage --allow-read -o /tmp/waccprof tools/wac/waccprofile.wac
    wac covdump /tmp/waccprof.wasm > /tmp/counts.tsv
    # join on the index with /tmp/waccprof.cov, whose rows are `index<TAB>line<TAB>col<TAB>kind<TAB>file`

Sixty seconds to build, six to run. The driver prints its byte count, because a run that failed to
find the entry still fills a counter table and would profile the failure path convincingly.

### `funcAt` doubled costs nothing measurable — so the counts are not the answer

Body-doubling `Env.funcAt`, so every lookup scans twice, and building `packages/box/src/bin/sh.wac`
three times each way:

    doubled          5134 ms   6085 ms   6523 ms
    reverted         5219 ms   5918 ms   6239 ms

Indistinguishable — and **the honest reading is a bound, not a zero**. The spread within each set is
about 1,400 ms, so what this measurement supports is "one `funcAt` pass costs less than roughly
700 ms of a 5,000 ms build", not "it costs nothing". 97 million extra string comparisons are
somewhere under a seventh of the build and the machine cannot say where. Anyone wanting the real
number needs a quiet machine and more repetitions taking minima; three runs each way while another
agent's suite is on the other four cores is not it.

What it does rule out is the reading that sent me here: the counts do not translate into anything
like a proportional share of the clock, so **a hash index on `funcs` is not justified by 97 million
iterations alone**, and neither is one on any other table ranked that way.

**I nearly reported the opposite.** An earlier baseline, taken twenty minutes before on a quiet
machine, was 4477/4587/4514 ms, and against the doubled figures that reads as a 650 ms difference —
14% of a build, which is exactly the sort of number that gets a hash index written. It is entirely
contention: three agents share five cores here, and the load moved between the two measurements. The
*reverted* build re-measured under the same load as the doubled one is what settles it, and the
lesson is the one this page already had about `C.findName`, arriving from the other side: a
conspicuous scan is not evidence, and neither is a large count.

**One more thing the counts rule out.** `B.byte`, the emitter's byte buffer, is 2.59 million calls
and its doubling-grow loop 3.2 million iterations — 0.13% of the total. Building the 777 KB module a
byte at a time is not the cost either, which is worth knowing because it is the other obvious
candidate and it is three orders of magnitude below the scans.

**What that leaves.** The 96% figure for `emit.wac` still holds and is still where the work is — but
it is 96% of *iterations*, and the phase-level split at the top of this section (`lex` 2.5%,
`parseProgram` 18%, everything after ~80%) remains the only measurement here that is about time. The
profiler is worth keeping for what it is good at: showing which code runs at all, and which of two
candidate lines runs a thousand times more often than the other. It is not a way to choose what to
optimise.


## What is left is mostly *emitting* the platform, not checking it — agent-b, 2026-08-29

Four builds on the native host, `--no-cache`, three runs each, medians:

    build  export i32 main() { return 7; }                 53 ms      2.6 KB out
    build  the same plus `import … from "std/platform.wac"`  1 100 ms    241.3 KB out
    check  the trivial one                                  40 ms
    check  the one importing the platform                  190 ms

**One import costs a second, and about 150 ms of that is the front end.** So of the ~1 050 ms a
platform import adds, roughly one seventh is lex, parse and check, and the rest happens after.

**It is not proportional to what comes out, and I said it was.** The paragraph above first attributed
the rest to emitting 238 KB and called it agreement with this issue's `~6 ms/KB` model. Two more
measurements say otherwise:

    build  no imports                                        53 ms      2.6 KB out
    build  `import { Option } from "core/option.wac"`       ~100 ms      7.4 KB out
    build  std/platform imported, `main()`, nothing used    ~890 ms     44.9 KB out
    build  std/platform, `main(Core core)`                 1 113 ms     77.0 KB out
    build  std/platform, `main(Core core, Cli cli)`        1 100 ms    241.3 KB out

The last two are the same source but for the capability `main` names, and the emitted module differs
threefold — `Cli`'s surface is most of it, which is `issues/system/0129`'s "one number only across
programs that name the same capabilities", visible from the compiler's side. **The time does not
move.** So the second is spent over the whole closure regardless of how much of it survives into the
module, and the ms/KB model does not describe this range; it was fitted to programs several times
larger, where it may well still hold.

**The third row is where the cost actually starts.** A program that *imports* `std/platform.wac`,
declares no capability and uses nothing from it already pays ~890 ms of the second — 80% of it —
while emitting 44.9 KB. Declaring `Core` adds 32 KB and about 200 ms; adding `Cli` adds 164 KB more
and no time at all. So what costs is having the 107 KB of source in the graph, not what the program
asks of it.

That 44.9 KB is worth `issues/system/0129`'s attention on its own: an import nobody uses is 45 KB in
the module, and this repository has 603 imports of that one file.

`core/option.wac` costing ~100 ms is the other end of the same point: a built-in import is cheap, so
this is `std/platform.wac` specifically — 107 KB of source, reconstructed from literals in
`coretext.wac` on every build.

**Where the split falls, from the other side.** The same program with one undefined name in it —
so the build stops at diagnostics and never emits — costs **~300 ms**. That agrees with `wac check`
at ~190-230 ms, allowing for what `build` does before it, and puts the after-check work at about
800 ms. It is that 800 ms which does not move between the 77 KB and 241 KB modules.

**That reframes "skip checking files that have not changed"**, which is the first entry under *What
is left to try*. It is worth having, and it is bounded by the 150 ms: checking is not where the time
went. What repeats across builds is the *emitted code* for a closure that is byte-identical every
time — a hello-world gets 241 KB because the whole platform is compiled into it.

**Which makes this the same phenomenon as `issues/system/0129`**, from the other end. That issue
measures the floor in bytes — every executable carrying ~350 KiB it did not ask for — and treats it
as a size question with an open bundling decision. It is also a *time* question: the floor is emitted
from source on every build, so 0129's bundling question and this issue's remaining cost are one
question, and answering it once answers both.

**And it is why `issues/system/0275b`'s item 1 is what it is.** `commandparity_test.wac` makes 34
invocations across three hosts, and the entries those rows name import the platform. At roughly a
second of emit apiece that is most of its 71.7s — so the largest chunk in the suite is the executable
floor, arriving as wall-clock in the gate rather than as bytes on disk.

Not decomposed further here: whether the 900 ms is the emitter's own work or the cost of writing and
validating a 241 KB module. `wac check` stops before emit, which is what separates the two numbers
above, but nothing here separates emit from output.
