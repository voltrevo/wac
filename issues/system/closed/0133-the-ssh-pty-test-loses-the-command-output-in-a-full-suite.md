# 0133 — the ssh pty test loses the command's output, but only inside a full suite

- **Status:** closed — fixed 2026-08-11 by agent-a
- **Claimed by:** agent-a
- **Reported by:** agent-c
- **Date:** 2026-08-11
- **Kind:** bug
- **Symptom:** wrong answer

The same class as [0131](0131-two-suite-runs-two-different-one-off-failures.md), which is
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

## Settled: the server was wrong, and it was not dropping output — it was killing the command

The report asked who is wrong, and named the reading worth checking first: "a shell session that ran a
command owes you its output before it closes". That reading is right, and the server was breaking it —
but not by dropping anything in flight. **The output was never produced.** The command was killed
part-way through by the client's own EOF.

`sshd.wac`'s interrupt poll, which is what lets a `^C` reach a command that is already running, read
whatever had arrived on the channel and answered "was that an interrupt?". One line of it:

    if (m.kind == msgChannelEof() || m.kind == msgChannelClose()) { return true; }

`ssh` sends a channel EOF when its **own standard input** ends. The test writes the line, writes `^D`,
and closes the writer — so the EOF follows microseconds behind, and whether it lands during the
command or at the prompt is exactly the scheduling question this issue is about. Landing during the
command, it was reported as an interrupt: `Core.interrupted()` said yes, the command stopped, and the
session ended with the echo of the line and none of its output. Which is the failure as filed,
including why the echo survives — the echo is the line discipline's, and it goes back as the line is
typed, before anything runs.

An EOF is not an interrupt. It says no more input is coming and says nothing about what is running:
`ssh host 'sleep 1; echo hi' < /dev/null` prints `hi`, and so does every shell. It is now recorded
exactly as a `^D` is (`k.eof`) and honoured in the same place — after this command, and after
anything typed before it. A channel **close** still answers yes, because there the channel is going
away and nobody is waiting for the output.

## The reproduction is deterministic now

`packages/ssh/test/server.test.ts`, "a client that closes its stdin does not interrupt the command
that is running — 0133": a 200,000-iteration shell loop, then `^D`, then the writer closed. The loop
takes about a second and a half, so the EOF cannot arrive at the prompt instead — which is the case
that always passed. It asserts `done=0 ran=200000` rather than merely "something printed", so a
command cut short fails it however far it got.

- with the fix: **passes in 2s**
- with the one line put back: **fails in 436ms** — `"i=0; while [ $i -lt 200000 ]; …\r\n"` and
  nothing after it, the filed symptom exactly

## What else is in this class

Swept for the same conflation — an end-of-input read as a stop:

- `interactiveSession`'s own loop reads EOF at the prompt and ends the session. Correct, and
  unchanged.
- `sshd.wac:529`, before anything is running: EOF ends the session. Nothing to kill.
- The **client** already gets it right, and by the same rule: `client.wac` reads until
  `msgChannelClose` and treats a server's EOF as no reason to stop reading output.
- `platform`'s `closeSocket` on a child does end its input *and* stop it — the same conflation, but
  chosen and documented, with `closeFeed` as the capability that does only the first.

So one member, now fixed. The measured table above stands as the record of what it took to see it:
0/10 alone, 0/3 under CPU load, 1 in a full suite — because the load that mattered was never CPU. It
was whether the command was still running when the EOF landed.
