# crypto's coverage run has 45 uncovered branches, and nothing was looking

**Status**: open
**Filed**: 2026-08-07

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
