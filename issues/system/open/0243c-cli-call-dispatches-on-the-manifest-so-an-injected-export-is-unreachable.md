# 0243c — `Cli.call` dispatches on the manifest, so an injected export is unreachable

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-24
- **Kind:** missing feature
- **Symptom:** wrong answer

`Cli.load`/`Cli.call` were added so that four native-only commands could move into the wac program
(`issues/system/0240c`). Three of them — `covdump`, `tracestat`, `ctcompare` — and `wac test
--coverage` all read the counters through `__cov_init`, `__cov_len` and `__cov_get`.

**Those exports are injected by the instrumentation. No source names them, so no manifest lists them.**
`Cli.call` looks an export up in the manifest to find its signature, so it answers `status == 2`, "no
export named `__cov_len`", for a function the module plainly exports.

## Reproduction

    $ wac build --allow-read --coverage src/mixed_test.wac -o cov
    $ # the manifest lists 2 exports, and no __cov_*

    $ wac test --allow-read --coverage src/mixed_test.wac        # the native binary
    2 passed, 0 failed

    branch coverage: 6 of 270 points (2%)
          3 / 4     src/mixed_test.wac
          3 / 266   std/platform.wac

    $ ./wac-deno test --allow-read --coverage src/mixed_test.wac  # before this was refused
    2 passed, 0 failed

    branch coverage: 0 of 270 points (0%)
          0 / 4     src/mixed_test.wac
          0 / 266   std/platform.wac

**The table and the totals were right and every counter read zero.** That is the shape worth noticing:
the part that came from the manifest was correct, so the report looked like a real measurement of a
program that had run nothing.

`wac test --coverage` refuses on the JavaScript hosts now and names this issue. A wrong number is the
worst of the three available answers; refusing is the middle one; making it work is the point.

## Why the native host does not have it

`run_tests` calls `get_export(scope, exports, "__cov_init")` — the module's own export table, not the
manifest. It never needed a signature, because it knows these three by name and by shape.

## What would fix it, and the choice inside that

- **The manifest lists them.** Truest to what a manifest is for: it claims to describe the module's
  callable surface and does not. The generator has the module's bytes — `bindExportsOf` already walks
  its export section — but not the *types* of an injected function, which would have to come from the
  wasm type section or from the instrumentation that added them.
- **`call` falls back to the module's export table** when the manifest is silent, reading the signature
  from the module. Available on both native hosts (`Func::ty`); **not available from JavaScript**,
  where `WebAssembly.Module.exports` gives a kind and no signature. So this fixes two hosts of four,
  which is the split `0240c` existed to close.
- **`call` knows the three by name**, as the native host does. Smallest, and the honest objection is
  that it puts a compiler-internal name in the platform boundary.

The first is the one to want. The third is what an afternoon would buy.

## Not urgent, and worth saying why

`--coverage` has one consumer here: `tools/runTests.wac` runs the suite through the *native* binary, so
nothing in this repository is blocked. What is blocked is `covdump`, `tracestat` and `ctcompare` moving
out of the host — three of the four commands `0240c` was filed to unblock, so this is that issue's
remaining half rather than a new subject.
