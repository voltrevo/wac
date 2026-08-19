# 0128 — the native half of the two-host differential times out under load

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-08-09
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

Under a full suite on a loaded machine, `packages/platform/test/native_shell.test.ts`:

```
the same sealed system answers the same on a JavaScript host and one that is not
  "seq 1 5 | head -n -0"
  deno   "1\n2\n3\n4\n5\n" (0)
  native "" (124)
```

124 is `timeout`'s. Run on its own the same test passes in 2m10s, every time.

## Notes

**Not slowness alone.** The script is five lines through two stages; nothing about it takes twenty
seconds. Either the native side hangs and the timeout is what ends it, or the machine was so loaded
that a spawn-heavy script missed the bound — and those are different bugs, which is why this is filed
rather than retried until green.

**What changed nearby, and by how much.** `native/` gained `epoch_interruption` on 2026-08-09 (issue
0123), which puts a check on every loop back-edge. Measured with two binaries alternated run by run —
because measuring them one after the other on a shared machine reads the load rather than the change,
which is how the first attempt got 34% — it costs about **10%** on `seq 1 200000 | wc -l` through the
shell. A tenth is not twenty seconds, so this is not an explanation; it is the thing to rule out
first, and the number is here so nobody has to guess it.

**Where to start.** `head -n -0` has to read to the end of its input before writing anything, so a
stage that never sees its input end waits for ever. That is a hang shape rather than a slow shape,
and it is the one this repository has met before (wac-mono 0110, and 0115 for the write side). The
question worth answering first is whether the native run *finished* and was killed, or was parked —
`timeout` cannot tell you, and a stack would.

Related: **0036** (a hung test, and how the gate reports one), **0106** and **0107** (real races that
only a busy shared machine schedules).

## Answered — 2026-08-10

**Five cores, load average 9.5.** `/proc/loadavg` read `9.53 12.82 16.59` on a five-core box with
several agents running suites at once, and the two-host tests run both halves *synchronously* inside
a `--parallel` suite with a **ten-second** bound on scripts that take under one second idle. Three
times oversubscribed is enough.

Ruled out, in this order, because each was cheaper than the next:

- **The epoch check** (0123). Measured at about 10% with two binaries alternated run by run. Not
  twenty seconds.
- **Concurrency in the native runtime.** 48 native runs at once, 24 at a time, both with the epoch
  flag and without: 0 wrong out of 48 each way.
- **The change under test.** The first gate that failed this way was on a commit that changed one
  markdown file.

## What changed

`harness/bounded.ts`, and the four two-host differentials use it: `native_shell`, `native_hostfs`,
`native_examples` and `arrival`. (`native_hostfs` moved to wac on 2026-08-19 and now carries the
same two rules in `packages/platform/test/wac/hostfs.wac`; the argument is unchanged, the code is a
second copy in a second language.) Two things:

1. **A bound that fired is reported as a bound.** `timeout` answers 124, which no program chose, so a
   run that never finished was printed as a host that disagreed — `native "" (124)` — and read as a
   conformance failure. `hangReport` says which side did not finish and in how long, and the
   comparison is skipped rather than made against nothing.
2. **The bounds are generous.** 60s rather than 10s or 20s, following what `harness/deadline.ts`
   already says: "the job is converting *infinite* into *finite*, not policing latency". A bound
   exists to turn a hang into a readable failure; every second it spends waiting for a loaded machine
   costs nothing when nothing is hanging.

**All fourteen copies are gone**, not only the four that were failing: `routes`, `notdir`,
`backings`, `init`, `sealing` (three), `unnameable`, `stdin_open`, `sealed` and `native_hostfs`'s
fed-input helper use the same function now. The last two are the interesting ones — their *subject*
is a hang (`stdin_open` and `sealed` were written for bugs whose shape was 124), and they now read
`hung` as a field rather than recognising a status the program never chose.

Left open deliberately: **whether anything actually hangs.** The evidence says the bound fired on a
busy machine, and a 60s bound will say so much less often — but if it fires again, the message will
now name it as a hang rather than as a difference, which is the thing that made this take three
runs to understand. Every test that bounds a run now says so in the same way.

## 2026-08-11: the cause was ours, and it was 1.7 seconds of compiling

The load was real and it was not the whole story. Measured, on an idle machine:

    wacsh -c true, Deno host        116 ms
    wacsh -c true, wasmtime host   1721 ms
    bash -c true                    0.7 ms

And it tracks the module rather than the work — 582 KB of wasm takes 1721 ms, 94 KB takes 213 ms,
which is the same 3 ms per KB. `Module::from_file` compiles with cranelift on **every run**, and
`native_shell` runs twenty-odd scripts through it, each paying the compile again.

So each of those scripts spent 1.7 seconds before running a byte, on an idle machine, and the file
spent half a minute of its 1m38s doing nothing but compiling the same module twenty times. The bound
each script runs under is `DEFAULT_SECONDS`, sixty — not ten, which is `tools/shellFuzz.ts` and a
different harness. Sixty is a lot of headroom for 1.7 seconds; it is much less for 1.7 seconds
multiplied by whatever the machine is doing at three times the core count, which is the condition
this issue was filed under.

**Fixed by not compiling twenty times.** `compiled()` in `native/src/main.rs` caches the serialized
module beside the `.wasm`, keyed by a hash of the wasm and the wasmtime it was built against, written
to a temporary name and renamed because the suite runs two of these at once. First run 1751 ms, every
run after it **15 ms**.

    native_shell.test.ts    1m38s  ->  17s
    the four native files    ~3m   ->  34s

Left open deliberately, because the bound is still a bound: nothing here proves a loaded machine
cannot push a 15 ms start past sixty seconds, and the `hangReport` from `harness/bounded.ts` is what
will say so if it does. What has changed is that the start is a hundredth of what it was, so a load
spike now has to be a hundred times worse to do the same damage.

## 2026-08-11: two more members, and the shape that answers them

The gate refused my push twice this evening. The second time was this class, in a different file:

```
packages/box/test/wac/corpus_test.wac
2 of 286 scripts differ from bash:
  "printf 'a\nb\na|b\na+b\naab\n' | grep -c 'a\+'"   bash finished; ours did not, in 20s
  "printf 'a\nb\na|b\na+b\naab\n' | grep -c 'a?'"     bash finished; ours did not, in 20s
```

The same file had passed 3082/0 eight minutes earlier in the same gate run, and passes alone in 19s
— the whole file, 286 scripts. Each of those two takes about 40ms. What was different was the
machine: load 15, four cases in flight, inside a suite that is itself parallel.

**A fixed wall-clock bound cannot tell a hang from starvation, so it should ask again.** Both gate
members now do:

- `packages/box/test/wac/corpus_test.wac` — a case that hits the 20s bound is re-run **alone, in a fresh
  directory, with 60s**, once. If it hangs again the report carries both attempts and bash's own
  elapsed time; if it finishes, its answer is compared like any other and a line on stderr says the
  load and that this was the machine.
- `packages/sh/test/stderr.test.ts` — the same, and it needed it for a subtler reason: its message
  already said "a hang or a machine under load", which is two answers with no way to pick. Now it
  picks, by asking again at 60s.

Canaried by bounding *our* side at 0.05s so every case hits it: all 286 retried, all finished
(~200ms each), the suite stayed green, and the stderr line named the load each time. A case that
genuinely hangs fails both bounds and is reported with both.

**Left alone:** `tools/corpusStderr.ts`, `corpusRoutes.ts`, `corpusHosts.ts` and `corpusBackings.ts`
carry the same fixed 10s bound. They are `deno task` tools rather than gate tests, so a starved run
costs the person who ran it and nobody else — the same treatment would suit them and is not urgent.

None of this touches **this** issue's own case: the native half still times out under load, and
whether that is a hang or starvation is exactly what the retry shape above would settle. Whoever
takes it has two working examples to copy now.

## 2026-08-12: the four native files ask again too

The shape the two gate members got on 2026-08-11 is now in `harness/bounded.ts` as `boundedAgain`
and `boundedInputAgain`, and the four two-host differentials use it: `native_shell`,
`native_hostfs`, `native_examples` and `arrival`. A run that does not finish within the bound is
asked once more at **three times** the bound, with a line on stderr naming the load; if it finishes,
its answer is compared like any other, and if it does not, `hangReport` now says it was asked twice
— *"a second failure to finish, not a first"* — and carries the load.

That is the distinction this issue was filed to make. "Did not finish in 60s" on a machine at three
times its core count is a fact about the machine. "Did not finish in 60s and did not finish in 180s
when asked again" is a fact about the program.

Canaried directly rather than through the tests, because a starved run is not something a test can
arrange: `boundedAgain(1, "sh", ["-c", "sleep 2; echo done"])` reports the first bound firing,
answers `done` with `retried` set, and `sleep 30` fails both bounds and produces the two-attempt
sentence. The fed variant does the same.

**Not folded into `bounded` itself**, deliberately: `stdin_open` and `sealed` are tests whose
*subject* is a hang, and for them a second attempt is the same measurement twice at three times the
cost.

What is still left is what was left before — nothing here proves anything hangs. The difference is
that the report can now tell you which question you are looking at.

## 2026-08-12: the four `corpus:*` tools, checked rather than assumed

The note above left them alone with "the same treatment would suit them", which reads as though they
carry the same defect. Read: they do not. `corpusStderr`, `corpusRoutes`, `corpusHosts` and
`corpusBackings` each detect 124, **skip that script and count it separately**, and print the count
in the summary — so a loaded machine costs a comparison rather than inventing a difference, which is
the half that matters and the half that cost a push.

What is left there is narrower: a starved script goes *uncompared*, visibly. Three full sweeps this
morning — routes 829/829, stderr 810/829 with its nineteen pinned differences, backings across 145
sampled scripts — skipped none, so the loss is real and rare, and a retry would recover it rather
than fix anything.

**`tools/shellFuzz.ts` was the one that had the defect**, and it is fixed: it recorded "a bound
fired, so there is no answer here to compare" and then printed the two answers *without that
sentence*, so a script that finishes instantly by hand read as a disagreement. It asks again at
three times the bound now, the same shape `harness/bounded.ts` gives the two-host differentials.

## 2026-08-12, agent-b: the same shape, one test over

`packages/platform/test/browser_live.test.ts` behaves identically and belongs in this issue rather
than in one of its own:

    alone                                  ok (17s)
    beside compiler/ (1,442 tests)         FAILED (3m1s) — its own deadline, twice in a row
    beside packages/platform alone         ok

17 seconds against a three-minute bound is not a test that is close to its limit; it is a test that
gets no CPU for most of three minutes. Three agents share five cores, so what changes between the two
runs is how much of the machine a headless browser can have while 1,400 other tests are running.

Worth stating for whoever takes this: the bound to change is not obviously the timeout. A deadline
sized for a loaded machine cannot also catch a hang, and both of these tests are testing something
that either works in seconds or is broken.

## 2026-08-15: this test no longer runs on a push, which changes what this issue is

`packages/platform/test/native_shell.test.ts` declared itself **heavy** — 989 MB and 66s, and it
builds the Rust host with cargo before it builds a shell on both. So `deno task test` skips it, and
this issue can no longer redden anybody's push. It still runs in `deno task test:heavy`, whenever a
target names it, and via `test:changed` when `packages/platform` changed.

That is worth stating because it is a change in kind rather than degree. This was filed as a flake
that cost pushes; it is now a differential that is *not* watched continuously. Both facts matter to
whoever picks it up, and the second one makes "is it still happening" a question somebody has to ask
on purpose.

## What was ruled out on 2026-08-15, and what would answer it

Neither host reproduces the script on a quiet machine, which this issue already said. Confirmed
again from both directions, since the V8 host can now run box's shell at all (`0148`, `0157`):

```
$ wacland sealedsh.json                     <<< 'seq 1 5 | head -n -0'      # wasmtime
1 2 3 4 5
$ wac boxsh.wasm -c 'seq 1 5 | head -n -0'                                  # V8
1 2 3 4 5
```

**The open question is still the one above: parked, or merely slow.** Two ways of answering it were
tried and rejected, so nobody repeats them:

- `/usr/bin/time -f '%U %S'` around the bound would say whether CPU was burned. **It is not
  installed here**, and adding a system package for a diagnostic is how a guard becomes inert on the
  next container.
- `harness/bounded.ts` runs the command with `outputSync`, so there is no pid to sample while it
  runs. Sampling means spawning asynchronously, and that function is synchronous because *every*
  caller is — its own comment says so.

So answering this means making `bounded` asynchronous for the sampling case and threading it through
its callers, which is a real change rather than a diagnostic tweak. The measurement it should take
is CPU time against wall time for the whole process tree: flat CPU across a fired bound is parked,
and CPU that tracks wall is slow. `tools/jobsSweep.sh` samples `/proc` and `/sys/fs/cgroup` the same
way if a shape is wanted.

**Partial output cannot substitute for it**, and that is why this script was chosen: `head -n -0`
must read to the end of its input before writing anything, so an empty stdout is what both a parked
run and a working one produce. The `native ""` in the report above is not evidence either way.

## A second symptom in the same family — 2026-08-18, agent-c

One gate run in about fifteen failed `native_examples` with a *compile* error rather than a bound:

```
the capability examples answer the same on both hosts => packages/platform/test/native_examples.test.ts
error: Error: packages/platform/example/inside.wac did not compile:
  packages/platform/src/platform.wac:287:34 expected ')', found 'id'
  … eight more, all at 287
```

Line 287 is `Pending<T>.then`'s lambda. Reading it as "the reference was asked to compile the app" is the
obvious guess and it is not supported: `WAC_APP_FROM` was not set, `wac build` of that same example
succeeds (259 KB), and the message comes from `harness/waccBuild.ts`'s `api.diagnoseGraph` — where `api`
is wacc, bound through `waccApi()`. So a **wacc** reported parse errors on a file wacc parses.

Passed on retry, in 13s, and has not recurred. Recorded rather than filed on its own because it is this
test family and this issue is what a reader reaches for when one of them fails. Two things worth knowing
if it comes back:

- `waccApi()` builds wacc with the reference and pins `from: "reference"` **as arguments**, because the
  env-var version was read by every other bind in the same process; its comment records that afternoon.
  A leak of that shape would produce exactly this message, so it is where to look first.
- The run happened minutes after `deno task seed`, so every content-keyed artefact cache — `waccApi`'s
  included — was cold and several workers were filling it at once. A cold cache with parallel writers is
  the other candidate, and the cheap experiment is to reseed and gate immediately, twice.
