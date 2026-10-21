# 0394a — When the engine rejects a built module, `wac` says `wac build … -o out` keeps it, and no file is written

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-21
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
// Any program whose emitted module the engine refuses — e.g. one that hits a swallowed decline (fixed in
// 9580a3798, so this now needs another invalid-wasm bug to show).
```

Expected: the module on disk at `out.wasm`, so the rejection can be inspected.
Actual: the message promises it; nothing is written.

## Notes

Found while bisecting the seed failure during the 2026-10-21 bug hunt. The message is in `packages/wac/src`.
