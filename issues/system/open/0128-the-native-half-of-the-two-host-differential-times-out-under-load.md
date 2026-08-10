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
`native_examples` and `arrival`. Two things:

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

So a script that this test bounds at ten seconds spent 1.7 of them before running a byte, on an idle
machine. At three times the core count that is most of the bound, and the test then reports the two
hosts disagreeing — which is what this issue was filed about.

**Fixed by not compiling twenty times.** `compiled()` in `native/src/main.rs` caches the serialized
module beside the `.wasm`, keyed by a hash of the wasm and the wasmtime it was built against, written
to a temporary name and renamed because the suite runs two of these at once. First run 1751 ms, every
run after it **15 ms**.

    native_shell.test.ts    1m38s  ->  17s
    the four native files    ~3m   ->  34s

Left open deliberately, because the bound is still a bound: nothing here proves a loaded machine
cannot push a 15 ms start past ten seconds, and the `hangReport` from `harness/bounded.ts` is what
will say so if it does. What has changed is that the headroom is now three orders of magnitude rather
than six times.
