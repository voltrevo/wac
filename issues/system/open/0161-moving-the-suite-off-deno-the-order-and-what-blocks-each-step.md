
### `ssz` — 2026-08-17, and the shared fixture loader

Seventeen packages have no `.test.ts` left; the native lane is **152 files, 142 ok, 10 needing a host
oracle**. `ssz` is the first fixture-driven package to go over, and what it needed was
`harness/fixtures.ts` in wac.

**`packages/wactest/src/fixtures.wac`** is that loader, and it keeps the contract the TypeScript one
states verbatim — *a fixture that cannot be produced is an error, never a skip*. It reads
`.cache/fixtures/<pkg>-<name>-<sha16>.json`, verifies the full SHA-256 with `packages/crypto`, and
otherwise runs `python3 packages/<pkg>/tools/vendor.py` through `Cli.exec` and re-verifies before
writing the cache. The generator stays python for the reason the oracle scripts stay: it is the thing
that knows how to fetch and decompress a consensus-spec release.

The hash moving from Web Crypto to `packages/crypto` is a real change and the issue is worth naming:
the cache-integrity check is now made by code this repository also tests. It is not weaker for what
it guards — a truncated download or a substituted file does not survive any hash — and
`packages/crypto/test` compares that implementation against published vectors before anything here
runs. It **was** canaried: editing the manifest's sha256 produced a rebuild and then a refusal naming
both hashes.

Three accessors came with it — `member`, `memberText`, `memberI32`, `memberArray` — because every
fixture test reads the same three shapes out of a `JsonValue`, and `T.eqBool` was added for the
tables where `want` varies per row (`isTrue(got == want, …)` can only say "expected true").

**48 MB of JSON parses in about a second.** `ssz_generic_valid` is 1,217 cases and the whole
`merkle_test.wac` run — parse, hash-verify, merkleize 754 cases — is 1.5s wall including compilation.
That was the risk in this package and it did not materialise.

### What the branch tests had to become, and the operation `hashpair` cannot do

Three of `ssz`'s files verified merkle branches against a tree the **host** built with Web Crypto,
deliberately: folding with `packages/ssz` and then verifying with `packages/ssz` is a symmetric
oracle. Under the send-the-answers shape the tree cannot be fetched, so it is sent —
`packages/ssz/test/oracle.ts` recomputes and reports disagreements.

The first version sent `hashpair <a> <b> <claimed>` per internal node, which certifies the *digest*
and nothing else. **A fold with the side bits reversed sends its operands in the order it used, and
`sha256(a ‖ b)` agrees with it.** So `fold <leaf> <gindex> <branch> <claimed-root>` exists as well:
the oracle walks the branch itself and decides which side each sibling goes on. Reversing the
side-bit rule in `proof_test.wac`'s fold was watched to fail against it, and the per-node check alone
would have passed.

That is the general lesson for this tier, and it is the same one as `DONE <n>`: **a batched oracle
checks exactly the decision the line format makes it re-take.** Ask what the caller decided that the
line does not carry, and carry it.
