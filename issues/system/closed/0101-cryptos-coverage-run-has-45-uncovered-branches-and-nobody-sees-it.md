# 0101 — crypto's coverage run has 45 uncovered branches, and nothing was looking

- **Status:** closed — 2026-08-12, agent-a
- **Date:** 2026-08-07

## What

`deno task coverage:crypto` exits 1. It had done for some time — `packages/crypto/cov.ts` last changed on
2 August, `packages/crypto/src/` as recently as yesterday — and nothing runs it, so nothing said so.

Two of the reasons are now fixed:

- one exemption pinned to `rsa.wac:234`, a line the code had moved off (now 279);
- `sha1.wac` compiled into the run and **never called** — 41 branch points reading 0.0%. Not untested code:
  `test/sha1_wac.test.ts` covers it. A hole in the driver, which now drives it through the probe, including
  the streaming surface Tor needs (`peek`, `clone`, `saveState`, `loadState`) at 97.6%.

`sha1` turned out not to be the only one. Three more modules were compiled in and never called:
`CtrStream` — the whole of Tor's resumable keystream, twelve of `aesctr.wac`'s twenty-six points —
`hmacSha1`, and `ctEqual` itself, the constant-time comparison every tag check in the package rests on.
Plus the partial-block arm of each streaming hash, which a one-shot caller cannot take because it hands
over the whole message at once. All now driven:

| file | was | now |
| --- | --- | --- |
| `sha1.wac` | 0.0% | **100%** |
| `sha256.wac`, `sha512.wac` | 95.8%, 96.7% | **100%** |
| `hmac.wac` | 72.2% | **100%** |
| `aesctr.wac` | 43.5% | **95.7%** |
| `ct.wac` | 62.5% | 87.5% |
| package | — | **90.8%** |

What remains is 45 branch points, and they are all in two files:

| file | uncovered | coverage |
| --- | --- | --- |
| `rsa.wac` | 25 | 60.0% |
| `ed25519.wac` | 20 | 79.4% |

`deno task coverage:crypto --verbose` lists them individually. These are the harder half — not missing
driver inputs but, most likely, the guards a differential against a real implementation never trips,
which each want the covered-or-argued judgement rather than more inputs.

## Since then — 2026-08-12, measured

45 uncovered points has become **57**, and the two-file table above is no longer the shape of it:

| file | uncovered | coverage |
| --- | --- | --- |
| `rsa.wac` | 43 | 52.7% |
| `ed25519.wac` | 20 | 79.4% |
| `weierstrass.wac` | 13 | 86.3% |
| `fieldp.wac` | 5 | 93.0% |
| `field25519.wac` | 2 | 97.1% |
| `aesctr.wac`, `ct.wac` | 1 each | |
| `test/wac/rsa_probe.wac` | 1 | 75.0% |

`rsa.wac` went 25 → 43 because it **grew**: `rsaSignPss` and the PSS direction arrived on
2026-08-11 for the Tor work, and new code arrives with its branches unmeasured because this task is
not in the gate. That is not a regression in anybody's work — it is the thing this issue is about,
happening again while the issue that describes it is open. `weierstrass.wac` is new here too.

The reading to take from it: the number in a filed issue is a measurement with a date on it, and the
half of this issue that is "drive the missing inputs" refills itself between visits. The half that
does not is the judgement half below.

The sentence below about being "the one that is left" is true again as of today, and by a wider
margin than when it was written: there are nineteen per-package tasks now rather than eighteen,
`fs` and `gzip` both went green on 2026-08-12, and `crypto` is the only red one. `gzip`'s was one
point — `inflateAt`, an entry point the suite tests and that package's own coverage workload did
not call, which is the same shape as `sha1` above and not a missing test.

## Why it is filed rather than fixed

Three of the eighteen `coverage:*` tasks were red; `zstd` and `gzip` are now green, and this is the one that
is left. Until it goes green, `coverage:all` cannot go into `tools/push.sh` — a red check in the gate fails
every other agent's push for something they did not do, which is the line `CLAUDE.md` says to file at rather
than cross.

The missing-driver half is done. What is left wants the judgement the registry asks for — covered, or
recorded as unreachable with the reason, and the two kept apart — one branch at a time, which is not one
sitting.

## Done when

`deno task coverage:crypto` exits 0, every exclusion carries its argument, and `coverage:all` is in the gate.

## See also

- `tools/coverageAll.ts` — runs all eighteen and names the failures; written for this.
- wac-mono 0102 — one of gzip's, which turned out to be a promise the code cannot keep.

## Closed 2026-08-12 — green, and in the gate

```
$ deno task coverage:crypto        EXIT=0     97.1% over 874 branch points
$ deno task coverage:all           19/19 passed in 38s
```

The 57 uncovered points came apart into four kinds, and only the last was what this issue expected.

**Thirty-six were the driver, not the code.** `rsa.wac`'s signing half was exercised by
`test/wac/rsa_test.wac` against `node:crypto` in both directions the whole time. `cov.ts` instruments
`rsa_probe.wac`, which only verifies, so the signing functions were compiled into the coverage build
and never called — the same shape as `sha1.wac` above, one file over. Fixed by instrumenting the test
file and running its tests, which beats calling the functions from the driver: it reaches the
branches with the assertions attached. node's signer moved to `test/rsaOracle.ts` for the second
caller.

**And then the count did not move**, which found a bug in this file. `missed` was computed one
instrumentation unit at a time, adding every point that unit had not reached — so a point covered by
another unit was still reported uncovered. Invisible while the four units held disjoint files;
`rsa_test.wac` was the first to compile a file another unit already had, and the driver reported 57
uncovered while its own per-file table read 81.3%. The table was right.

**Fourteen were rejection guards no differential can reach**: a modulus too small for PKCS#1's eleven
bytes of padding, a zero modulus, a padded block at or above the modulus, a recovered block that is
not type 1, padding with no terminator or a stray byte in the run, fewer than eight padding bytes.
node will not hold a three-byte key to compare against, so these needed a test written against the
contract rather than against an oracle. It asserts the weakest true thing — the answer is empty, not
short — because asserting a particular block would assert this implementation's choice of how to fail.

**Twenty were `packages/tor`'s tests covering `packages/crypto`'s exports.** The expanded-key surface —
`ed25519ExpandedSecret`, `ed25519SignExpanded`, the prop228 conversion — is what a relay needs, and
crypto had no test of its own for any of it. That is the wrong way round: crypto breaking its own
export should fail crypto's suite, not surface later as a Tor descriptor that will not parse. The
oracle is the seed-taking API beside it, which RFC 8032's vectors pin; **Ed25519 is deterministic**,
so "expand then sign" must produce the very same bytes as "sign", and two wrong halves cannot agree
on them. Five of the twenty trap rather than answering, so no wac test can reach them — a trap there
is a failed run, not a value — and they are asserted from the host, where a trap is catchable.

Two `UNREACHED` entries then had to be dropped, which is the registry working in the direction nobody
plans for. `rsa.wac:67` argued that `bitAt` never reads past the top limb because `modPow` bounds its
loop by `bitLen(exp)`. True of `modPow`. `modPowSecret` takes its bit count from the *modulus*, so a
shorter exponent reaches it exactly as the guard intends, and the exemption had been reasoning about
the wrong caller.

`coverage:all` runs in `tools/push.sh` now, after the suite and before the push: 38 seconds against
the suite's four hundred. The half of this issue that "refills itself between visits" — `rsa.wac`
grew eighteen unmeasured branch points while this issue describing that was open — is what the gate
is for.
