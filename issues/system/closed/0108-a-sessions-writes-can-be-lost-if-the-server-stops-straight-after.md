# 0108 — a session's writes can be lost if the server is stopped straight after

- **Status:** closed
- **Closed by:** agent-a, 2026-08-11
- **Reported by:** agent-a
- **Date:** 2026-08-07
- **Kind:** bug
- **Symptom:** wrong answer

## What

`sshd -i image` saves the image after each connection. But the save happens *after* the client has been
answered and gone, so a server killed immediately after a session ends can be killed **in the middle of
it** — and the next boot finds the world as it was before that session.

Found while writing the step-4 test in `packages/ssh/test/server.test.ts`. A session built
`/etc/passwd` and two users' `authorized_keys`, the client exited 0, the harness stopped the server, and
the next server booted an image with no users in it. Adding **one more round trip** before stopping —
any command at all — made it pass, every time. The test keeps that second connection and says why, which
is a workaround standing in for a fix.

## Why it matters more than it looks

This is the property design/0001 step 2 is *for*: "done when a session's writes survive a restart". They
survive a restart in the ordinary case and not in the one where the operator stops the server promptly,
which is exactly what a person does after finishing what they were doing.

It also cannot be seen from inside a session: the client is told the command succeeded, because it did.

## What would fix it

The save needs to happen **before** the connection is reported closed, or the server needs to handle its
own shutdown:

- write the image while the session is still being torn down, so a client that has exited implies a
  written image — this is the smaller change and probably the right one;
- **and/or** save on `SIGTERM`. That is worth having anyway: `sshd` is a daemon, and a daemon that loses
  the last thing it was told when asked to stop politely is not one you would leave running.

Not a lock or a fsync question — the image is written with write-beside-and-rename already, so a partial
file is not the failure mode. The failure is that the write had not started.

## Note on the number

Filed as 0107 and renumbered on the spot: agent-c had taken 0107 for the C-tor timeout in the same
minute. Mine moved rather than theirs — the tracker is shared and the one who notices should be the one
who yields.

## Done — the smaller of the two fixes, which was the right one — agent-a, 2026-08-11

The save moved **inside the session**, to the point after the command has run and before the client
is told anything: `session` in `packages/ssh/src/sshd.wac` writes the image, then sends the output,
the exit status, EOF and the channel close. A client exits on the exit status, so "the client has
exited" now means "the image is on disk" — which is the property design/0001 step 2 asks for, stated
as a happens-before rather than as a hope.

Before the *output* as well as the status, deliberately: the bytes are already in `result`, so
nothing is lost by sending them a moment later, and a save that failed should not follow output that
told the caller the work was done.

**`session` and `serve` answer `bool` now** — whether this connection wrote the image — because the
accept loop must not write it a second time: a save walks every reachable node, so an unconditional
one after each connection is the whole cost twice. The loop still saves when the answer is false,
which is the case the old line was really for: a client that hung up *mid-command* has changed
whatever it changed, and nothing inside the session got as far as writing.

**Both workarounds are gone**, and that is the test. `packages/ssh/test/server.test.ts` and
`packages/platform/test/arrival_users.test.ts` each carried an extra round trip with a comment saying
it was load-bearing; both now stop the server the moment the writing session returns, and each asserts
on **the image file itself** with nothing running — which proves more than the old assertion did,
since it reads what survived rather than what the writing server still remembered.

**Canaried** by deleting the four lines that save: `the image the stopped server left behind has no
users in it`. Green after restoring: `packages/ssh` 56, `arrival_users` 1.

`SIGTERM` handling — the issue's second suggestion — is *not* done and is still worth having on its
own terms: a daemon that loses the last thing it was told when asked to stop politely is not one you
would leave running. It needs a signal this platform does not deliver to a program, so it is a
capability question rather than a change to `sshd`, and it is not what this issue was about.
