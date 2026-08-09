# 0108 — a session's writes can be lost if the server is stopped straight after

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
