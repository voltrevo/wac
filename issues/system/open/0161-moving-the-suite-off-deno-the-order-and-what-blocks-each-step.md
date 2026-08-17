
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

### `lightclient`, `mpt`, `raster`, `server` — 2026-08-17, and three canaries that did not fire

Twenty-two packages have no `.test.ts`. Three of these ports found something the host-side version
had claimed and did not have, and all three were found the same way: by mutating the thing the file
said it was checking and watching the test stay green.

**`packages/lightclient`: the sync-committee bit selection was never exercised.** Every one of the
sixteen `LightClientUpdate`s in Ethereum's sync vectors has `sync_committee_bits` of `ffffffff`, so
`participants` returns all 32 keys under any bit-order convention — and `FastAggregateVerify`
aggregates, so the order is unobservable too. Reversing the mask to `1 << (7 - i % 8)` changed
nothing. Not fixable with this corpus: a subset signature has to come from a beacon node. The file
now says so and names what *is* pinned instead.

**`packages/raster`: a one-column shift in the text blit passed 25 tests.** The file said "a shift
by one column would keep the count and move the pixels, so both are asserted"; only the first half
was true, because the rightmost column of `w`, `a` and `c` is blank in unscii, so the shift had
nothing to push past the stray-pixel boundary. Fixed by asking the same oracle a question about
*position* — `leftmostBit`/`rightmostBit` from the `.hex`, compared against the surface's own first
and last inked columns.

**`packages/wactest`: `Answers.find` matched on a prefix.** New code rather than an inherited claim,
but the same shape: `find("proof", "dogs 646f")` returned the line for key `646f67`, and the proof
that came back *verified* — against a key it was not asked about. Whole-word matching now.

### `ask` — the read-the-output half of the batching convention

`check` covers the usual direction: the test computes the answers and the oracle reports what it
rejects. Some oracles are the other way round, and `packages/mpt` is the clearest case — a Merkle
proof has to be produced by an implementation that is not the one verifying it. So
`packages/wactest/src/oracle.wac` grew `Answers`, `ask`, `askDeno` and `word`, with both of `check`'s
guards intact: a `FAIL` line fails the test, and `DONE <n>` is compared against what was sent.

`packages/mpt/test/oracle.ts` is a trie **service** rather than a fixed corpus — `trie <id> <pairs>`,
`proof <id> <key>`, `hash <hex>` — so what to prove stays in the test that cares. The second file's
subject is composition, which is a statement about which tries exist and what they carry; a corpus
would have moved that decision into TypeScript.

It also stopped borrowing keccak256 from wac. `proof_wac.test.ts` had said the two halves share it
and "could not be otherwise, since a trie root *is* a keccak256" — true of a builder running
in-process, false of one that is a subprocess and can carry forty lines of permutation.
`test/keccak.ts` does, and `proof_test.wac` pins it against two published digests *and* against
`packages/crypto`'s answer for the same inputs.

### What stays, restated

`packages/raster/test/{hosts,live}.test.ts` and `packages/server/test/live.test.ts` join
`packages/stream/test/stream.test.ts` in the list. Each has a **host** for a subject: two hosts
compared byte for byte, pixels read back out of chromium, three independent HTTP clients against a
real socket. Moving any of them would mean not testing the thing they exist for.

### `packages/http` — 2026-08-17, and what two of its files are blocked on

Six of eight moved. `nodeoracle.wac` and `responseoracle.wac` drive `oracle_node.mjs` and
`response_oracle.mjs`, which needed almost no rethinking: both were *already* one subprocess for a
whole batch — JSON of base64 cases in, JSON of outcomes out — arrived at independently and for the
same reason as `packages/wactest/src/oracle.wac`. `oracle_node.mjs` opens a socket per case, and one
process per case on top of that would have been unusable.

**Two oracles, two files, and not a preference.** An enum's variant names live in the file's scope,
so a second `Ok`/`Refused`/`Incomplete`/`Broken` cannot sit beside the first. `response_test.wac`
needs both and imports two names.

**`Cli.exec` passes no environment**, which is a deliberate limit — an inherited environment is a
capability nobody declared — so `oracle_node.mjs` grew `--nudge-ms=` beside
`WAC_HTTP_ORACLE_NUDGE_MS`. That flag was canaried before being trusted: a patient run that is
secretly the hurried run passes `oracle_test.wac` for nothing.

**What is left, and why.** `interop.test.ts` is the 2×2 — wac client against a Node server, `fetch`
against the wac server — and its diagonal is the whole point. It is blocked on the same gap as
`packages/ethrpc`: `issues/system/0165`'s **start a process and leave it running**. `Cli.exec` waits
for exit, and a server that has exited is not one a client can talk to. `tunnel.test.ts` builds
`example/tunnel.wac` and runs it against this container's Squid; that one is only blocked on wanting
a build step, and is smaller.
