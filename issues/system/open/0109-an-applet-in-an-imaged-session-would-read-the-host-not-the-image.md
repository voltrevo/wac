# 0109 — an applet in an imaged session would read the host, not the image

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-07
- **Kind:** bug
- **Symptom:** wrong answer

## What

Two filesystems would be reachable from one session, and nothing would say so.

- `packages/sh`'s shell holds its filesystem as a **value**: `Shell.fs`, a `packages/fs` `Fs` that may be
  an in-memory image with nothing of the host in it. Its builtins — `ls`, `mkdir`, `rm`, `cd`, `chmod`,
  `chown` — go through it, and since design/0001 step 4 that is also where permissions are enforced.
- `packages/box`'s applets take a **`Cli`**: `cat`, `grep`, `sort` and the other 58 read `cli.readFile`,
  which is the *host's* filesystem and nobody's user.

Today nothing composes the two: `packages/box/src/bin/sh.wac` builds its shell with `Shell.create`, which
is the host, so both halves agree. The moment an imaged shell is given the applets — which is the last
step of wac-mono 0103, and what `sshd -i` will want — `ls /` would list the image and `cat /etc/passwd`
would read the real machine's.

`shrun.wac` already says isolation is not faithful, and means something narrower by it: the applet runs
in the same wasm instance with the same authority. This is a different and sharper claim — the applet
does not merely have too much authority, it is looking at **a different filesystem** from the shell that
invoked it.

## Why it is filed rather than fixed

It is a seam, not a bug in a function, and the three ways out are not equivalent:

1. **Applets take an `Fs`.** Honest and mechanical, and it is 61 files plus every applet test. It also
   makes `packages/box` depend on `packages/fs`, which it does not today.
2. **A `Cli` backed by the shell's `Fs`.** Nothing changes in the applets. wac has no closures, so this
   cannot be built in wac — it wants the `pushChild`/`popChild` shape `platform` already uses for
   standard streams, extended to the file operations.
3. **Spawn applets as real children against the image**, which is design/0001 D4's kernel: a session gets
   a `Cli` whose capabilities are synthesised. That is the end state and it is steps away.

(2) is probably the near-term answer and (3) is where it wants to end up, but the decision affects
`platform`'s capability shape, which is not mine to change alone.

## Not this

Wiring the applets in and leaving it. A session that lists one filesystem and reads another is the exact
failure design/0001 D1 exists to prevent — and it would look like it worked, because most commands do not
touch a path.
