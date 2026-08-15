# 0157 — the V8 native host serves no parent filesystem, so a spawned applet cannot see an image

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-15
- **Kind:** missing feature
- **Symptom:** wrong answer

Split out of `0148`, which is closed. That issue was two bugs in this host's spawn path and both are
fixed; this is the capability underneath them that was never implemented at all, and it is what stops
`design/system/0001`'s image story working on the native host.

`spawn` and `spawnSelf` take a final `serveFs` argument — whether the parent will answer its child's
filesystem requests. This host reads the first four arguments and **ignores that one**. It has no
parent-filesystem channel, so `PARENT_FS` is answered "ended" unconditionally: correct for a program
with no parent, wrong for a child whose parent has an image mounted.

## Reproduction

```
$ deno task app:native packages/box/src/bin/imaged.wac \
    --allow-read --allow-write --allow-net --allow-env -o imaged
$ wac imaged.wasm h1.wacimg -c 'mkdir /data; seq 1 5 > /data/n'
$ ls -l h1.wacimg
-rw-rw-rw- 1 claude claude 118 h1.wacimg           # written, and the same 118 bytes Deno writes
$ wac imaged.wasm h1.wacimg -c 'cat /data/n | sort -nr | head -1'
cat: /data/n: Not granted to this application
```

Expected: `5`, which is what every JavaScript host answers —

```
$ deno task app:build packages/box/src/bin/imaged.wac \
    --allow-read --allow-write --allow-net --allow-env -o imaged-deno
$ ./imaged-deno j1.wacimg -c 'mkdir /data; seq 1 5 > /data/n'
$ ./imaged-deno j1.wacimg -c 'cat /data/n | sort -nr | head -1'
5
```

**The write half already works**, which is the useful half of the bisection: the parent has the image
and can put files in it. Only the *child* is blind, because `cat` is a spawned applet and asks its
parent for the filesystem it should be reading.

## Where it is

`packages/box/src/shrun.wac`'s `boxApplet` calls `Fs.fromParentOrHost(cli, 0)`, which opens
`Chan.of(cli, PARENT_FS)` and asks who the parent is. `packages/fs/src/fs.wac` reads a null back as
"there is no parent, use the host" — so a child that should have been served an image silently gets
the machine's own filesystem instead, and then the grant check refuses the path. Nothing reports a
missing capability, because from wac's side "absent" is a legitimate answer.

`packages/platform/host/children.ts` is the shape to match. It calls the same number `n_HANDLE`, and
`browser.ts` checks `h === n_HANDLE && opts.n !== undefined` before its socket table: the parent
holds a request/reply queue pair per child, and serves it while the child runs.

## What "done" would mean

1. `wac imaged.wasm img -c 'cat /data/n | sort -nr | head -1'` answers `5` after a previous process
   wrote into the same image — the JS transcript above, on the native host.
2. `serveFs` is honoured rather than dropped: a child spawned with it false must **not** be served,
   which is the sealing property `packages/box/src/bin/sealedsh.wac` depends on and the reason this
   is a flag rather than always-on.
3. A case in `packages/platform/test/v8host.test.ts` beside *"the spawning shell answers the same on
   Deno and on the Rust host"*, comparing an image round-trip across the two hosts.

## Notes

Not a regression: this host has never served a parent filesystem. It only became visible once 0148's
two faults were fixed, because before them no spawned applet ran far enough to ask.

`recv` on `PARENT_FS` currently answers `ReadAnswer::End` from the not-found branch, which is a
deliberate placeholder for exactly this — whoever implements the channel should serve it from the
table *before* that branch, the way the JS host does.
