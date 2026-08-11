# 0118 — tor cell framing treats the circ-id byte as a VERSIONS command

- **Status:** closed
- **Closed by:** agent-a, 2026-08-11
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

## Fixed by telling the decoder, because it cannot be told by the bytes

The report is right and the comment above the code was wrong in an instructive way: it claimed the
two forms "cannot be confused, because 7 is not a valid four-byte-id command in the same position".
That sentence is about the *command*; the byte it was reading is part of the **circuit id**. On a
wide cell `buf[at + 2]` is the second-least-significant byte of the id, so any circuit whose id is
`0x……07……` — `0x0700`, `0x12340755` — framed as VERSIONS. A relay hands circuit ids out from a
counter, so this was reachable rather than theoretical, and the consequence is not one bad cell: the
size comes from the wrong offsets too, so the stream desynchronises from there.

**The width is now a parameter.** `ID_NARROW` (2) and `ID_WIDE` (4) in `cell.wac`, and
`cellSize`/`cellCommand`/`cellCircId`/`cellPayload` each take it — there is no peeking left. Every
caller says which it means, and each of them already knew:

- `link.wac` gained `Link.wide`, false until the VERSIONS exchange settles a version and true after,
  read through `idWidth(l)`. That is the client side.
- `relayd.wac` already had `c.versionsSeen`, deciding what to *do* with the cell while the framing
  guessed. It now decides both.
- `relaylink.wac`'s `responderVersion` reads the initiator's VERSIONS cell narrow, by name.
- `client_entry.wac` and the two `size/` shims pass it through rather than choosing, because a
  measuring shim that picked a width would be making the same mistake one layer up.

**Canaried** by putting the peek back in `cellCommand`: `cell: a_circuit_id_is_never_read_as_a_command`
fails, on `0x00000700`, `0x000007FF`, `0x12340755` and `0x0700FFFF`. The stream test now changes width
after the first cell, as a real link does, and its second cell is on circuit **7** — the collision
this issue is about, in the test that walks three cells back to back.

All 306 of `packages/tor`'s tests pass, including `ctor_live`: a real C tor still bootstraps from our
authority and carries a stream through our relays, which is the check that the wire did not move.
