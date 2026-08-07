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

## 2026-08-07, later: the parameter is not the problem — the streaming capability is

I threaded an `Fs` through all 58 applet signatures and `dispatch` to see how big option (1) really is.
It compiles in one pass and the mechanical part is an hour. **That is not where the difficulty lives**,
and it is worth writing down before somebody else spends the hour finding out:

- The whole-file readers (`readInput`, `readAll`) and every writer (`cp`, `mv`, `rm`, `mkdir`, `touch`,
  `tee`, `sponge`, `stat`, `ls`, `du`, `find`, `tar`, `lib/safe.wac`) call `cli.readFile` /
  `cli.writeFile` and would move to `fs.` with no change in behaviour. About nineteen call sites.
- **The streaming readers cannot.** `lib/input.wac`'s `openStream` calls `cli.openInput(path)`, which
  does not return bytes — it *redirects this process's standard input* to the file, and the applet then
  pulls with `cli.readChunk`. There is no `Fs` counterpart, and there cannot be a straightforward one:
  the state lives in the capability rather than in a value.

So `cat`, `grep`, `head`, `tail`, `nl`, `cut`, `fold`, `rev`, `uniq` and the rest of the filters would
still read the host after the parameter was threaded — which is *worse* than today, because some applets
would read the image and some the host, and nothing in the output would say which.

### What the fix actually is

`Feed` in `packages/platform/src/stream.wac` already has both shapes: `Feed.fromStdin(cli)` pulls through
the capability, and `Feed.of(cli, bytes)` serves bytes the caller holds. So the seam is **`Reader`, not
the applets**: `lib/input.wac`'s reader should choose by mount —

  - a **host** mount keeps `openInput` + `Feed.fromStdin`, so a large file on disk still streams;
  - anything else reads the node whole through `fs.readFile` and hands back `Feed.of`, which is not
    streaming but is *correct*, and a memory image is already entirely in memory.

That needs `Fs` to answer "is this path on a host mount?", which it can — `mountOf` and `Backing` are
right there — and it keeps every applet's code unchanged. It is the option (2) of the original list, one
layer lower than where I was looking for it: not a synthesised `Cli`, but a `Feed` that already exists.

The applets that reach `cli` for the *filesystem* still need the parameter. Both halves are one change,
and it is a tick of its own rather than a corner of one.
