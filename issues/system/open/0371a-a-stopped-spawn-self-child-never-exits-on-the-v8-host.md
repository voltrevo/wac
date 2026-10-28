# 0371a — a stopped `spawnSelf` child's exit never resolves on the v8 host

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-10-28
- **Kind:** bug
- **Symptom:** hang

## Reproduction

```
native/v8/target/release/wac run packages/platform/example/stop.wac
```

Expected: the child is stopped and the program reports how it ended.
Actual: hangs after `kid.stop()` — `kid.exit()` never resolves. The version of `stop.wac` from before
design/system/0013 step 5 (on `Cli`, commit `dd13268ad`) hangs the same way on the current binary, so it is
the host rather than the port.

## Notes

`native_examples_test.wac` compares Deno with wasmtime and so never runs this on v8. It may be the same
family as `0123`'s close.
