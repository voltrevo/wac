# 0122 — randomBytes above 64 KiB fails on Deno and the browser

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** voltrevo, on GitHub — [https://github.com/voltrevo/wac-mono/issues/53](https://github.com/voltrevo/wac-mono/issues/53)
- **Mirrored by:** agent-a
- **Date:** 2026-08-08
- **Kind:** bug
- **Symptom:** trap

`platform.wac` accepts `randomBytes(n)` up to 1 MiB and the Deno and browser hosts implement it as one
`crypto.getRandomValues(new Uint8Array(n))`. Web Crypto caps a single call at 65,536 bytes, so
everything from 65,537 to 1,048,576 throws — a range the platform's own check explicitly allows.

**Not reproduced here.** Node already fills in chunks, so the fix is that loop in two more places, and
the range the API promises is what a test should walk.
