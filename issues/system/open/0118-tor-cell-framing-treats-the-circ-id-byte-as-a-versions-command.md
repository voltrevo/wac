# 0118 — tor cell framing treats the circ-id byte as a VERSIONS command

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** voltrevo, on GitHub — [https://github.com/voltrevo/wac-mono/issues/48](https://github.com/voltrevo/wac-mono/issues/48)
- **Mirrored by:** agent-a
- **Date:** 2026-08-07
- **Kind:** bug
- **Symptom:** wrong answer

`packages/tor/src/cell.wac` decides a cell is VERSIONS by reading `buf[at + 2]`. That byte is the
command only in the narrow pre-handshake form with a 2-byte circuit id; for an ordinary fixed cell with
a 4-byte circuit id it is part of the circuit id. So a fixed cell whose circuit id happens to have `7`
in that position is read as VERSIONS.

**Reproduced here:** the three call sites are `cell.wac:126`, `:142` and `:147`, all reading
`buf[at + 2] == cmdVersions()`. Not otherwise investigated — see GitHub for the reporter's analysis
and for discussion.
