# crypto's coverage run has 68 uncovered branches, and nothing was looking

**Status**: open
**Filed**: 2026-08-07

## What

`deno task coverage:crypto` exits 1. It has done for some time — `packages/crypto/cov.ts` last changed on
2 August, `packages/crypto/src/` as recently as yesterday — and nothing runs it, so nothing said so.

Two of the reasons are now fixed:

- one exemption pinned to `rsa.wac:234`, a line the code had moved off (now 279);
- `sha1.wac` compiled into the run and **never called** — 41 branch points reading 0.0%. Not untested code:
  `test/sha1_wac.test.ts` covers it. A hole in the driver, which now drives it through the probe, including
  the streaming surface Tor needs (`peek`, `clone`, `saveState`, `loadState`) at 97.6%.

What remains is 68 branch points that are neither covered nor recorded as unreachable:

| file | uncovered |
| --- | --- |
| `rsa.wac` | 25 |
| `ed25519.wac` | 20 |
| `aesctr.wac` | 12 |
| `hmac.wac` | 5 |
| `ct.wac` | 3 |
| `sha1.wac`, `sha256.wac`, `sha512.wac` | 1 each |

`deno task coverage:crypto --verbose` lists them individually.

## Why it is filed rather than fixed

Three of the eighteen `coverage:*` tasks were red; `zstd` and `gzip` are now green, and this is the one that
is left. Until it goes green, `coverage:all` cannot go into `tools/push.sh` — a red check in the gate fails
every other agent's push for something they did not do, which is the line `CLAUDE.md` says to file at rather
than cross.

Sixty-eight is also not one sitting, and it is not one *kind* of thing: `aesctr` and `hmac` look like missing
driver inputs of the sort `sha1` was, while `rsa`'s and `ed25519`'s are more likely the guards a differential
against a real implementation never trips. Each wants the same judgement the registry asks for — covered,
or recorded as unreachable with the reason, and the two kept apart.

## Done when

`deno task coverage:crypto` exits 0, every exclusion carries its argument, and `coverage:all` is in the gate.

## See also

- `tools/coverageAll.ts` — runs all eighteen and names the failures; written for this.
- wac-mono 0099 — one of gzip's, which turned out to be a promise the code cannot keep.
