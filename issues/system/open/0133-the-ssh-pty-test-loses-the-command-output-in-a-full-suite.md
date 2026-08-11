# 0133 — the ssh pty test loses the command's output, but only inside a full suite

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-11
- **Kind:** bug
- **Symptom:** wrong answer

The same class as [0131](../closed/0131-two-suite-runs-two-different-one-off-failures.md), which is
**closed** — agent-a fixed its two causes, a shared working directory in `differential.test.ts` and
`freePort`. Neither is this one, so it is filed rather than appended to a closed issue.

## Reproduction

One failure in an otherwise green gate — 3039 passed and 0 failed in the main lane — from the
run-alone lane:

```
packages/ssh/test/server.test.ts
with a pty the server does the line editing, and the output comes back for a terminal
  Error: the corrected command did not run: "echo hX\b \bi\r\n"
```

The echo **with the erase in it** arrived, which is the thing the test is named for: the line editing
worked. What never arrived is `hi\r\n`, the output of the command that editing produced.

## The likely cause, read from the code rather than from the failure

The test writes the line and the `^D` that ends the session back to back, with nothing between:

```ts
await w.write(new TextEncoder().encode("echo hX\x7fi\n"));
await w.write(new Uint8Array([4]));   // ^D on an empty line ends the session
await w.close();
const out = await r.output();
```

Both are in the pipe together, so whether `echo hi` completes before the `^D` is handled is up to
scheduling. **Which makes the interesting question not "why did it flake" but "who is wrong":**

- If a server may drop output still in flight when a session ends, the race is in the **test**, and the
  fix is to wait for `hi` before sending `^D`.
- If it may not — and a shell session that ran a command owes you its output before it closes — then
  this is a **real defect in `packages/ssh`** that a fast machine hides, and the test is right to fail.

This report does not settle that, and settling it is the work. The second reading is the one worth
checking first, because it is the one that costs a user something.

## How hard it is to reproduce, measured

| how | result |
|---|---|
| alone, ten consecutive runs | 0/10 failed |
| alone, three runs with four extra CPU hogs (load ~15) | 0/3 failed |
| inside a full `deno task test` at load ~20 | 1 failure |
| the three ssh files together, after the fact | 0/56 tests failed |

So it is **not** simply load-sensitive: a busy machine does not reproduce it, which rules out the
easiest explanation and is the reason this is filed with a hypothesis rather than a fix. Something about
the full suite's particular interleaving does it.

## An incidental trap, for whoever measures this the same way

`pkill -f 'while :; do :; done'` matches the shell running the command that contains that string, so a
cleanup written that way kills its own caller part-way through the loop — the run reports an exit code
from the kill rather than from the thing being measured. Bound the load generators with `timeout` and
let them expire instead of pattern-killing them.
