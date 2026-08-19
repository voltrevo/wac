# 0213 — the two-host tests moved to wac, and the JavaScript half became a process per script again

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-19
- **Kind:** performance
- **Symptom:** no error

## Measured

The three files that compare a JavaScript host against the native one are now the largest items in the
`wac test` lane, in a lane whose next-largest is 11.3s:

| file | in the lane | standalone |
| --- | ---: | ---: |
| `packages/platform/test/wac/native_hostfs_test.wac` | 31.0s | 17.1s |
| `packages/platform/test/wac/native_shell_test.wac` | 16.3s | 9.3s |
| `packages/platform/test/wac/v8host_test.wac` | 14.6s | 11.0s |

All of it is one number: **a built Deno bundle costs 133ms to start, against 17ms for `wacland` and
2ms for bash**, and these files make roughly a hundred such runs between them. The wac ports are
otherwise careful — they cache their builds, and `native_hostfs_test.wac` already submits its three
hosts concurrently, citing `issues/system/0211`.

## Why the move cost this

`native_hostfs.test.ts` was 29s as TypeScript and **9.4s** when I converted its JavaScript half to
`harness/appRun.ts`'s `appRunner`, which builds the program's worker half once and runs it in a worker
at about a millisecond a run. `native_shell.test.ts` went 21s to 4.7s the same way.

A wac test cannot call `appRunner`: it is a Deno module, and a wac test's only way out is `Cli.exec`.
So porting the files to wac — `issues/system/0161`, which is a good direction — necessarily gave the
process starts back. This is the cost of that decision rather than an oversight in the ports.

## What is already built

`harness/appRunMany.ts`, added with this issue: the same `appRunner`, behind one `exec`, speaking the
line protocol `wactest/src/oracle.wac` already knows how to drive.

    deno run -A harness/appRunMany.ts <entry.wac> [--allow-…]
    {"argv":["-c","echo hi"],"cwd":"/tmp/x","stdin":"","env":{"LC_ALL":"C"}}   ← one request per line
    {"code":0,"out":"hi\n","err":""}                                          ← one answer per line
    DONE 2

Measured: 50 runs as 50 processes 9 736ms; 200 runs through this 776ms, of which 526ms is the fixed
cost of starting Deno and reading the worker half from the build cache — **about 1.25ms a run**.

## What adopting it means for the tests

The sweep in each file becomes: build the fixture trees, send the batch, then run bash and the native
host per script and compare. That is a restructuring of the loop rather than a change to what is
compared — the same built program, the same grants, the same capability implementations, and the same
three-way comparison.

Two things to keep while doing it:

- **The bound.** `submit`/`collect` gives each run a deadline today, and a batch has one bound for the
  whole call. `issues/system/0128` is why that matters: a bound that fired is a report, not an answer.
  A batch that never returns needs the same treatment the individual runs have.
- **The retry.** `native_hostfs_test.wac` re-runs a hung case serially before failing. A batched run
  can keep that: the retry path is already the serial one.

Left for whoever is next in those files — they were written in the last few hours and are being
iterated on, and this is a change to the shape of their sweeps rather than a fix to a defect.

## Adopted in two of the three, 2026-08-19

`native_hostfs_test.wac` (~17s → 10.2s) and `native_shell_test.wac` (9.3-17.3s → 4.9s warm) now send
their Deno halves through `denoBatch` in `packages/platform/test/wac/hostfs.wac`. `v8host_test.wac`
runs its program once per test, so a batch buys nothing there; its three `build.ts` calls would be
served by `wactest/src/built.wac`'s `builtByDeno`, which is a smaller and separate win.

The stdin case in `native_hostfs_test.wac` deliberately keeps its processes, and the file now says why:
a batched run is fed by pushing onto the child's parent-fed queue — the queue that shadowed fd 0 in the
fault that test exists to catch — so batching it would compare a queue-fed JavaScript host against an
fd-fed native one.

## The same shape in a third file, for whoever owns it

`packages/wacc/test/wac/bindgenwac_test.wac`, added 2026-08-19, is **13.1s standalone**: six
`deno run packages/wacc/test/bindgenOracle.ts` calls — three programs by two languages — at about 1.4s
each, one of them generating glue for `packages/wacc/src/api.wac`, half a megabyte of module.

Those answers are a pure function of the entry's sources and of `compiler/`, which is the case
`wactest/src/oracle.wac`'s `askCached` exists for: `typecheck_test.wac` went 8.6s to 3.2s that way.
Adopting it here means giving `askOracle` the `Lines`/`DONE` protocol `askCached` speaks, or a
one-shot variant of it. Left alone because the file is minutes old and being iterated on; the
measurement is here so nobody has to take it again.

