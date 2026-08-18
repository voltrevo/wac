# 0200 — `coverage:crypto` is red: 127 points uncovered, 48 of them in `mlkem.wac`

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-08-18
- **Kind:** bug
- **Symptom:** wrong answer

`deno task coverage:crypto` exits 1. It is the only red entry in `deno task coverage:all`
(18 of 19 pass), and it has been red across at least three gate runs, where `push.sh` prints
*"the coverage ratchets are red — pushing anyway, and this is not fine"* and pushes.

## Reproduction

```sh
deno task coverage:crypto        # exit 1
```

```
127 branch point(s) uncovered:
  packages/crypto/src/mlkem.wac    48
  packages/crypto/src/keccak.wac   16
  packages/crypto/src/rsa.wac       6
  … and the rest in test files
```

Expected: exit 0, as it did before `rsa_test.wac` moved to `(Core, Cli)`.
Actual: 127 points with no `UNREACHED` entry, so `cov.ts` fails.

## What is *not* the cause, because it was, and is fixed

Until this commit the task did not report this at all — it **threw**:

```
TypeError: Cannot read properties of undefined (reading '$ref')
    at Module.test_a_forged_block_that_is_wrong_in_one_place_is_refused
```

`cov.ts` called every `test_` export in `rsa_test.wac` with one argument, a TypeScript reference
oracle. Ten of that file's twelve tests now take `(Core core, Cli cli)` — they drive openssl through
`Cli.exec` instead of being handed an implementation — so `cli` was undefined and the failure came
out of generated glue with the coverage task's name on it. `packages/fmt` had the same shape and the
same red.

`harness/wacCoverage.ts`'s `runTestExports` is the fix: it runs the exports that take nothing, and
**names the ones it cannot call** rather than dropping them. `fmt` is green again and `crypto` now
reports instead of crashing. Eight `cov.ts` files had that loop copied; all eight use the helper now.

## What is left, and why this is filed rather than fixed

The 127 are a real gap, and they are in somebody's in-flight migration:

- **`mlkem.wac`, 48 points.** `issues/system/0161` records that ML-KEM is the one oracle Deno is
  still right for — node 22's WebCrypto refuses `encapsulateBits` and the OpenSSL here is 3.0. So
  whatever drives mlkem's coverage is host-side, and it is either no longer running or no longer
  reaching these.
- **`keccak.wac`, 16 points.**
- **`rsa.wac`, 6 points** — plausibly the ten tests that moved to `wac test`, whose lines are now
  reached by that lane rather than by this driver.

Each wants a decision from whoever is moving crypto: drive the unit from `cov.ts` again, record an
`UNREACHED` entry with a reason, or accept that a capability-taking test's coverage lives in
`wac test --coverage` and teach this report to read it. That last one is `issues/system/0176`.

## Notes

**A coverage driver that calls test exports blindly breaks whenever a test gains a capability**, and
the ports in 0161 are steadily giving tests capabilities. The helper above makes that a printed line
rather than a crash, but it converts the failure into *silently less coverage*, which is worse if
nobody reads the line. The line is why it prints.

`push.sh` does not block on `coverage:all` — it says so and pushes — pending `issues/lang/0111`. So
this stays red without stopping anybody, which is how it survived three gate runs.

## 127 was mostly not the package — 2026-08-18, agent-c

The number this issue quotes was measured by a loop in `packages/crypto/cov.ts` that filtered on the
package prefix alone, while the table beside it — `report()` in `harness/wacCoverage.ts` — excludes test
files, "because a coverage report is about the package". So the two disagreed, and the list was the one
that was wrong:

    before   127 points: 57 in `rsa_test.wac`, 48 in `mlkem.wac`, 16 in `keccak.wac`, 6 in `rsa.wac`
    after     59 points: 48 in `mlkem.wac`,     6 in `rsa.wac`,    5 in `keccak.wac`

Three things came out of it:

- **57 of the 127 were lines in a test file**, uncovered because ten of `rsa_test.wac`'s tests need a host
  this driver cannot build. Counting them punished instrumenting a test file, since each one brings its own
  unreachable lines — and the ledger already carried two `UNREACHED` entries paying that tax, whose own
  reason said so: "a test file in the denominator brings its own detectors with it". Both are gone.
- **`keccak.wac` was 51.4% because its tests were not in the run**, not because it is untested.
  `keccak_test.wac` has nine, seven of which need nothing from a host. Instrumented and run, the file reads
  **86.5%**, and the five points left are reached only by the two that compare against the host.
- **`cov.ts` keeps two run lists** — one for `report`, one for its own accumulation — and adding a unit to
  only the first is silent: the table read 86.5% while the list underneath still called sixteen of that
  file's lines uncovered. They are the same list now, and the comment says why there is a trap there.

**What is left is 48 points in `mlkem.wac`, and this driver cannot reach them.** All five of
`mlkem_test.wac`'s tests take `(Core core, Cli cli)` — they read their KAT vectors — and neither
`wacCoverage`'s `instrument` nor `wacBind` can supply a capability, which is why the Deno-side registrar is
called *hostless*. So mlkem's coverage needs the measurement to move to `wac test --coverage`, which does
build a host. That is the shape of the answer; it is not a matter of writing more tests.

## mlkem is covered; the driver cannot see it — measured 2026-08-18

    wac test --coverage --allow-read --allow-write --allow-run packages/crypto/test/wac/mlkem_test.wac
    5 passed, 0 failed
        125 / 132   packages/crypto/src/mlkem.wac

**94.7%, against the 62.1% this driver reports** for the same file. The five tests exist, pass, and reach
almost all of it; what the Deno-side driver cannot do is give them the `(Core core, Cli cli)` they take to
read their vectors, so it measures the file as though nothing tested it and calls 48 points uncovered.

So the 48 are a measurement gap, not coverage debt, and the remaining question is not "write more mlkem
tests" — it is whether these ratchets should take their numbers from `wac test --coverage`, which builds a
host, instead of from a driver that cannot. The same question decides `rsa_test.wac`'s ten host-needing
tests and every other package's.

Two things to know before attempting it. `wac test --coverage` prints a per-file table of reached points
over the *whole closure*, so a ratchet consuming it has to select the package's own files — the run above
also reports `packages/fmt/src/ftoa.wac` at 0/91, which says nothing about `fmt`. And `--coverage` keeps the
per-file build path rather than the shared one (`issues/system/0192`), because counters are per module, so
measuring this way costs a build per test file.
