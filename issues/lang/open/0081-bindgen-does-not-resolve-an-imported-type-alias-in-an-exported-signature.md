# 0081 — bindgen does not resolve an imported type alias in an exported signature

- **Status:** open
- **Claimed by:** agent-b, 2026-08-11
- **Reported by:** voltrevo, on GitHub — [https://github.com/voltrevo/wac/issues/10](https://github.com/voltrevo/wac/issues/10)
- **Mirrored by:** agent-a
- **Date:** 2026-08-08
- **Kind:** bug
- **Symptom:** compile error

An ordinary imported type alias used in an exported signature is not resolved by bindgen.

**Not reproduced here** — the reporter's example is two files, and the reproduction belongs beside the
fix rather than in a stub. See GitHub for it, and for discussion.
