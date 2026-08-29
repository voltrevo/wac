# 0285 — a spawned applet copies nothing when the shell's script came from standard input

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-29
- **Kind:** bug
- **Symptom:** wrong answer — an empty file and an exit status of 0

## Reproduction

One shell, one script, one directory. The difference is the V8 host against the Deno host.

```
$ printf 'cp MERGE.md copied.txt\nwc -c copied.txt\n' | ./spawnsh-deno
6667 copied.txt

$ printf 'cp MERGE.md copied.txt\nwc -c copied.txt\n' | wac ./spawnsh.wasm
0 copied.txt
```

`cp` reports nothing wrong and the shell carries on. The file is created and left **empty**.

**It depends on where the script came from.** The same script through `-c` is right on both:

```
$ wac ./spawnsh.wasm -c 'cp MERGE.md copied.txt
wc -c copied.txt'
6667 copied.txt
```

So: the shell reading its script from **standard input**, on the V8 host, spawning an applet that
reads a file and writes through `openOutput`.

## What it looks like

`packages/box/src/bin/sh.wac` runs applets as real children through `spawnSelf`. A child inherits
standard input unless told otherwise — and when the shell's own script is on standard input, what the
child inherits is the *unread remainder of the script*.

`cp` reading its source from the inherited stream rather than from the file it was given would
produce exactly this: an empty destination, no error, and a shell that goes on to the next line
because the script was consumed by something else.

That is a guess from the symptom rather than a reading of the code, and it is written as one. What is
measured is the difference between the two hosts and the dependence on `-c` against standard input.

## Why nothing caught it

The Deno-against-V8 comparison, `packages/platform/test/wac/v8host_test.wac`, drives its spawning
shell **on standard input** — which is the failing route — but no script in it copied a file or
redirected anything. Its other script runs `packages/box/example/boxsh.wac`, whose applets run
in-process through `pushChild` and never spawn.

Adding one `cp` to the spawning script surfaced this immediately, which is `issues/system/0279c`'s
point exactly: the comparison that includes the shipped host had no breadth, and the comparison with
breadth — `native_hostfs_test.wac` — does not include it.

## Notes

Tenth host divergence found on 2026-08-29, and the first found by a *test* rather than by hand.
