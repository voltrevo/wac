# 0119 — ethrpc pads odd-length hex where its own comment says it refuses

- **Status:** closed
- **Closed by:** agent-a, 2026-08-11
- **Reported by:** voltrevo, on GitHub — [https://github.com/voltrevo/wac-mono/issues/50](https://github.com/voltrevo/wac-mono/issues/50)
- **Mirrored by:** agent-a
- **Date:** 2026-08-07
- **Kind:** bug
- **Symptom:** wrong answer

`packages/ethrpc/src/jsonhex.wac` says an odd number of digits "is a node bug and is refused rather
than padded: guessing means a nibble-shifted" value — and then `fromHex` prepends a `0` and decodes it.

**Reproduced here:** the comment is at `jsonhex.wac:58` and the padding at `:69`–`:72`, eleven lines
apart. A code-against-its-comment case, which makes the intended behaviour unambiguous.

## Both halves of that comment were right, about different things

The comment describes **DATA** and the code implements **QUANTITY**, and the Ethereum JSON-RPC spec
has both: a QUANTITY is a number written minimally, so `0x1a2` is legal and means 418; DATA is a byte
string — a hash, an address, a storage key, a proof node — and cannot have half a byte in it. One
function served both and padded, so a `stateRoot` a node got wrong became a nibble-shifted root that
verifies against nothing, which is exactly what the comment warned about. Refusing odd everywhere
would have been the same mistake pointing the other way: `eth_blockNumber` answers `0x1a2`.

So the caller says which it is asking for — `fromHexData` and `fromHexQuantity`, `memberData` and
`memberQuantity`. `header.wac` already knew: it has an `isQuantity` table for the RLP encoding, and
that knowledge simply had nowhere to go. It now picks the decoder as well as the encoder, on the same
call. `hexArray` is DATA every time, because it reads proof nodes; `getproof.wac`'s storage keys are
DATA too.

`fromHex` is gone rather than kept as an alias — a name that means "whichever" is how this happened.

**Canaried** by making `fromHexData` fall back to the quantity path on odd input, which is the old
behaviour exactly: `jsonhex: data_refuses_an_odd_number_of_digits` fails. The new tests are in
`packages/ethrpc/test/wac/jsonhex_test.wac`, which is the package's first wac test — everything here
had been driven through a live node until now, and a live node never sends the malformed field.
