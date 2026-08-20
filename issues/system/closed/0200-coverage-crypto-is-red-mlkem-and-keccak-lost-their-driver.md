# 0200 — `coverage:crypto` is red: 127 points uncovered, 48 of them in `mlkem.wac`

- **Status:** closed
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

## Green — 2026-08-18, and two of the four reasons were not what this issue said

`deno task coverage:crypto` exits 0. It had been red on every gate run for days, printing "pushing
anyway, and this is not fine", which is the state that makes a check worthless. What it took, and the
corrections matter more than the result:

**1. mlkem's 48 points were the measurement gap this issue describes, and are now measured rather than
excused.** The driver carried a `MEASURED_BY_THE_BINARY` entry that *ran* `wac test --coverage` on
`mlkem_test.wac` — 0.9s — and required 125 of 132. Fifty `UNREACHED` entries would have been the wrong
fix: that list means "no test reaches this", and the tests exist, pass and reach almost all of it. The
floor worked in both directions, so a rise failed with the number to raise it to; a ratchet that only
loosens is a ledger.

> **The mechanism is gone as of 2026-08-20, and the number is better than it was asserting.**
> `issues/system/0222` moved this driver to wac. `wac covdump` runs the ordinary program path, so the
> exercise's `main` has a real `Core` and `Cli` and calls mlkem's five tests directly —
> `packages/crypto/src/mlkem.wac` reads **131 of 132** in the same counter array as everything else,
> because the shared paths are covered by the rest of the run too. There is no subprocess, no remembered
> figure and no `measuredElsewhere` exclusion. What this entry was working around was one sentence in
> `harness/wacCoverage.ts`: `runTestExports` skips any test whose `fn.length > 0`, because `instrument`
> cannot supply a capability. Sixty-four of the package's 152 returning tests were behind that.

**2. keccak's five remaining points are *not* a measurement gap, and this issue said they were.** It
claimed they were "reached only by the two tests that compare against the host". Measured:
`wac test --coverage` on `keccak_test.wac`, which runs all nine tests with a host, reads **32 of 37** —
exactly what the Deno driver reads. So the host was never the reason.

Three of the five were `Sha3_256.clone`, which **no test in this package called**. It is not dead code:
`packages/tor/src/relay.wac` takes a trial digest with `hop.backwardDigest3.clone()` on every cell it
tries to recognise, and `peek` spells its own copy out inline rather than calling it (the checker rule
`sha1.wac:145` records), so nine tests over the file left it at zero. There is a test now, and the
canary is a shallow clone — which fails it on the *second* direction only: writing into the clone
advances a shared `pending` past the original's `pendingLen`, so the original's digest does not move,
and only writing into the original afterwards clobbers what the clone had. One direction would have
passed a broken copy.

The other two are guards, with entries and arguments: `rotl`'s zero side is unreachable because the
function is private and every call site is a literal offset in 1..62, and `sponge`'s rate guard is
unreachable because all five callers pass a constant.

**3. rsa's six points were the signing half, which the package that owns it never ran.** Every rsa test
here verifies; none signed, because signing needs a private exponent and the openssl-driven tests
generate their keys inside the oracle. So `rsaSignPss` — what `packages/tls/src/server.wac` and
`packages/quic/src/server.wac` sign handshakes with — and the success path of `rsaRecoverPkcs1` — what
`packages/tor/src/consensus.wac` reads descriptors with — were reached by nothing. Three tests now sign:
a 1024-bit key generated once with `openssl genrsa` and written into the file, because a key is the one
input those paths cannot be given any other way, and 15ms of `modPow` for the pair of them. Each carries
its own canary: a wrong message, a flipped bit, a corrupted block.

**What is left is the seven points in `mlkem.wac` that the binary also does not reach**, which is
ordinary coverage debt and now the only kind here.

The larger question this issue asks — whether the ratchets should take their numbers from
`wac test --coverage` generally — is still open, and the answer got cheaper: `prog.cov` already holds the
per-point table, and `native/v8/src/main.rs` reads it out of a temp directory that the run then deletes.
A flag that wrote it out would let any driver *union* the binary's measurement with its own instead of
choosing between them, which is what a whole-package answer needs — on `rsa.wac` the Deno driver reaches
125 where the binary's own run of `rsa_test.wac` reaches 115, so neither is a superset.

## Closed — 2026-08-20, and the open question dissolved rather than being answered

`packages/crypto`'s driver moved to wac with `issues/system/0222`. The three files this issue named
now read, with every uncovered point carrying a written reason in
`packages/crypto/test/cov_ledger.wac`:

| file | then | now | left |
|---|---|---|---|
| `mlkem.wac` | 48 uncovered | **131 of 132** | 1, pinned: rejection sampling reading past its XOF stream |
| `keccak.wac` | 16 uncovered | **35 of 37** | 2, pinned: `rotl(x, 0)` and a rate no caller passes |
| `rsa.wac` | 6 uncovered | **125 of 128** | 3, pinned: an overflow guard, and both halves of `unusedBits > 0` |

That is 127 points down to 6, and the 6 are ledger entries rather than silence.

**The larger question — "whether the ratchets should take their numbers from `wac test --coverage`
generally" — did not need answering.** The proposed answer was a flag that wrote `prog.cov` out so a
driver could *union* the binary's measurement with its own, on the evidence that neither is a superset:
"on `rsa.wac` the Deno driver reaches 125 where the binary's own run of `rsa_test.wac` reaches 115".

There is nothing to union. Both numbers came from the same instrument being asked twice because
`harness/wacCoverage.ts`'s `runTestExports` skips any test taking an argument — `instrument` cannot
supply a capability, so the driver ran none of the tests that need one, and the binary ran only that
file's. `wac covdump` runs the ordinary program path (`issues/system/0221`), so a wac exercise's `main`
has a real `Core` and `Cli` and calls every test itself: one run, one counter array, and the union is
what the array already is. `MEASURED_BY_THE_BINARY` — the mechanism this issue's "Green" section
describes as the honest workaround — is deleted with it.

`issues/system/0205` keeps the part that is still a decision: whether the sixteen drivers that only
report should hold floors.
