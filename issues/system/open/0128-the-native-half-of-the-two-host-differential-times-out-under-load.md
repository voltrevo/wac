# 0128 — the native half of the two-host differential times out under load

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-08-09
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

Under a full suite on a loaded machine, `packages/platform/test/native_shell.test.ts`:

```
the same sealed system answers the same on a JavaScript host and one that is not
  "seq 1 5 | head -n -0"
  deno   "1\n2\n3\n4\n5\n" (0)
  native "" (124)
```

124 is `timeout`'s. Run on its own the same test passes in 2m10s, every time.

## Notes

**Not slowness alone.** The script is five lines through two stages; nothing about it takes twenty
seconds. Either the native side hangs and the timeout is what ends it, or the machine was so loaded
that a spawn-heavy script missed the bound — and those are different bugs, which is why this is filed
rather than retried until green.

**What changed nearby, and by how much.** `native/` gained `epoch_interruption` on 2026-08-09 (issue
0123), which puts a check on every loop back-edge. Measured with two binaries alternated run by run —
because measuring them one after the other on a shared machine reads the load rather than the change,
which is how the first attempt got 34% — it costs about **10%** on `seq 1 200000 | wc -l` through the
shell. A tenth is not twenty seconds, so this is not an explanation; it is the thing to rule out
first, and the number is here so nobody has to guess it.

**Where to start.** `head -n -0` has to read to the end of its input before writing anything, so a
stage that never sees its input end waits for ever. That is a hang shape rather than a slow shape,
and it is the one this repository has met before (wac-mono 0110, and 0115 for the write side). The
question worth answering first is whether the native run *finished* and was killed, or was parked —
`timeout` cannot tell you, and a stack would.

Related: **0036** (a hung test, and how the gate reports one), **0106** and **0107** (real races that
only a busy shared machine schedules).
