# 0119 — ethrpc pads odd-length hex where its own comment says it refuses

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** voltrevo, on GitHub — [https://github.com/voltrevo/wac-mono/issues/50](https://github.com/voltrevo/wac-mono/issues/50)
- **Mirrored by:** agent-a
- **Date:** 2026-08-07
- **Kind:** bug
- **Symptom:** wrong answer

`packages/ethrpc/src/jsonhex.wac` says an odd number of digits "is a node bug and is refused rather
than padded: guessing means a nibble-shifted" value — and then `fromHex` prepends a `0` and decodes it.

**Reproduced here:** the comment is at `jsonhex.wac:58` and the padding at `:69`–`:72`, eleven lines
apart. A code-against-its-comment case, which makes the intended behaviour unambiguous.
