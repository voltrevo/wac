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
